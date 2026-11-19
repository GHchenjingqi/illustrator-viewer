/**
 * AIParserEngine
 * ----------------
 * 统一解析入口。阶段 2 调度：
 * AIFileReader → AIFileDetector → PostScriptParser → CompatibilityEngine
 *
 * Vue 组件只调用本入口，不直接触碰解析逻辑。
 * 阶段 3 将在此接入 Scene Graph，阶段 4 接入 Canvas Renderer。
 */

import { AIFileReader, DEFAULT_MAX_FILE_SIZE } from './AIFileReader.js'
import { detectStructure } from './AIFileDetector.js'
import { parsePostScript } from './PostScriptParser.js'
import { buildCompatibilityReport } from '../engine/CompatibilityEngine.js'
import {
  DiagnosticSeverity,
  createDiagnostic,
  isAbortError,
  toDiagnosticError,
} from '../utils/errors.js'

const now = () => globalThis.performance?.now?.() ?? Date.now()

export const ENGINE_STAGE = 2
export const ENGINE_VERSION = '0.2.0'

const MAX_GRAPHICS_TEXT_BYTES = 16 * 1024 * 1024
const POSTSCRIPT_BODY_MARKERS = ['%%EndSetup', '%%EndProlog', '%AI5_BeginLayer', '%%BeginScript']

/**
 * 决定从哪一段文本执行基础绘图解析。
 * - 私有数据已解码：直接解析私有数据
 * - EPS / PostScript：解析 %%EndSetup 之后的绘图段
 * - PDF 且无私有数据：跳过（阶段 2 不解析 PDF 内容流）
 */
function resolveGraphicsSource(bytes, report) {
  const decodedText = report.privateData?.text
  if (typeof decodedText === 'string' && decodedText.length > 0) {
    return {
      text: decodedText,
      mode: 'ai-private',
      source: 'private-data',
      truncated: false,
    }
  }

  const container = report.detection.container
  if (container === 'postscript' || container === 'eps') {
    const limit = Math.min(bytes.byteLength, MAX_GRAPHICS_TEXT_BYTES)
    let text = new TextDecoder('latin1').decode(bytes.subarray(0, limit))

    let start = -1
    for (const marker of POSTSCRIPT_BODY_MARKERS) {
      const index = text.indexOf(marker)
      if (index > start) start = index
    }
    if (start >= 0) text = text.slice(start)

    return {
      text,
      mode: 'postscript',
      source: 'postscript-body',
      truncated: bytes.byteLength > limit,
    }
  }

  return null
}

function createEmptyGraphics(status, reason, source = null) {
  const graphics = parsePostScript('', { mode: 'none', source })
  graphics.status = status
  graphics.reason = reason
  return graphics
}

export class AIParserEngine {
  /**
   * @param {{ maxFileSize?: number, chunkSize?: number, hash?: boolean }} [options]
   */
  constructor(options = {}) {
    this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE
    this.reader = new AIFileReader({
      maxFileSize: this.maxFileSize,
      chunkSize: options.chunkSize,
      hash: options.hash ?? true,
    })
  }

  /**
   * @param {File | Blob | ArrayBuffer | ArrayBufferView} source
   * @param {{
   *   signal?: AbortSignal,
   *   fileName?: string | null,
   *   decodePrivateData?: boolean,
   *   parseGraphics?: boolean,
   *   onProgress?: (event: { phase: string, ratio: number | null, message: string, loaded?: number, total?: number }) => void
   * }} [options]
   */
  async parse(source, options = {}) {
    const started = now()
    const emit = (event) => {
      try {
        options.onProgress?.(event)
      } catch {
        // UI 进度回调异常不应中断解析
      }
    }

    try {
      emit({ phase: 'read', ratio: 0, message: '读取文件…' })

      const file = await this.reader.read(source, {
        signal: options.signal,
        onProgress: (event) => {
          emit({
            phase: 'read',
            ratio: event.ratio === null ? 0 : event.ratio * 0.5,
            message: '读取文件…',
            loaded: event.loaded,
            total: event.total,
          })
        },
      })

      emit({ phase: 'detect', ratio: 0.6, message: '识别文件结构与版本…' })

      const report = await detectStructure(file.bytes, {
        fileName: file.name ?? options.fileName ?? null,
        sha256: file.sha256,
        signal: options.signal,
        decodePrivateData: options.decodePrivateData ?? true,
      })

      if (file.hashError) {
        report.file.hashError = file.hashError
        report.diagnostics.push(
          createDiagnostic(
            'HASH_UNAVAILABLE',
            `SHA-256 计算失败：${file.hashError}`,
            DiagnosticSeverity.INFO,
          ),
        )
      }

      emit({ phase: 'graphics', ratio: 0.8, message: '提取基础矢量对象…' })

      let graphics
      if (options.parseGraphics === false) {
        graphics = createEmptyGraphics('skipped', 'graphics-disabled')
      } else {
        const graphicsSource = resolveGraphicsSource(file.bytes, report)
        if (!graphicsSource) {
          graphics = createEmptyGraphics('skipped', 'no-private-data')
          report.diagnostics.push(
            createDiagnostic(
              'GRAPHICS_SOURCE_UNAVAILABLE',
              '未找到可解析的 AI 私有数据；阶段 2 不解析 PDF 内容流，因此不提取图形',
              DiagnosticSeverity.WARNING,
            ),
          )
        } else {
          try {
            graphics = parsePostScript(graphicsSource.text, {
              mode: graphicsSource.mode,
              source: graphicsSource.source,
              artboardHints: report.structure.pageBoxHints,
            })
            graphics.textLength = graphicsSource.text.length
            if (graphicsSource.truncated) {
              graphics.truncated = true
              graphics.truncatedReason = graphics.truncatedReason ?? 'text-size-limit'
              report.diagnostics.push(
                createDiagnostic(
                  'GRAPHICS_TEXT_TRUNCATED',
                  `绘图文本超过 ${MAX_GRAPHICS_TEXT_BYTES} 字节上限，仅解析前部内容`,
                  DiagnosticSeverity.WARNING,
                ),
              )
            }
            if (graphics.unknownOperators.length > 0) {
              report.diagnostics.push(
                createDiagnostic(
                  'GRAPHICS_UNKNOWN_OPERATORS',
                  `存在 ${graphics.unknownOperators.length} 种未识别操作符，相关图形效果未还原`,
                  DiagnosticSeverity.WARNING,
                  { operators: graphics.unknownOperators.slice(0, 12).map((item) => item.operator) },
                ),
              )
            }
            if (graphics.vectorCount === 0) {
              report.diagnostics.push(
                createDiagnostic(
                  'GRAPHICS_NO_VECTORS',
                  '解析执行完成，但未产生可绘制的矢量对象（可能只包含文字、图片或未识别操作符）',
                  DiagnosticSeverity.INFO,
                ),
              )
            }
            if (graphics.artboards.length === 0) {
              report.diagnostics.push(
                createDiagnostic(
                  'ARTBOARD_HINTS_NOT_FOUND',
                  '未找到画板边界提示（BoundingBox / MediaBox），阶段 2 无法确定画板尺寸',
                  DiagnosticSeverity.INFO,
                ),
              )
            }
          } catch (error) {
            graphics = createEmptyGraphics('failed', 'parser-error', graphicsSource.source)
            report.diagnostics.push(
              createDiagnostic(
                'GRAPHICS_PARSE_FAILED',
                `基础绘图解析失败：${error instanceof Error ? error.message : String(error)}`,
                DiagnosticSeverity.ERROR,
              ),
            )
          }
        }
      }

      report.graphics = graphics
      report.privateData.text = undefined
      delete report.privateData.text

      report.capabilities.postScriptParsing = graphics.status === 'parsed'
      report.capabilities.vectorExtraction = graphics.vectorCount > 0
      report.capabilities.artboardDetection = graphics.artboards.length > 0

      report.compatibility = buildCompatibilityReport(report)
      report.engine = {
        version: ENGINE_VERSION,
        stage: ENGINE_STAGE,
        javascriptOnly: true,
        wasmUsed: false,
      }
      report.durationMs = Number((now() - started).toFixed(2))

      emit({ phase: 'done', ratio: 1, message: '解析完成' })
      return { ok: true, stage: ENGINE_STAGE, report, aborted: false }
    } catch (error) {
      if (isAbortError(error)) {
        return {
          ok: false,
          stage: ENGINE_STAGE,
          aborted: true,
          error: { code: 'ABORTED', message: '解析任务已取消', details: {} },
        }
      }
      return {
        ok: false,
        stage: ENGINE_STAGE,
        aborted: false,
        error: toDiagnosticError(error),
      }
    }
  }
}
