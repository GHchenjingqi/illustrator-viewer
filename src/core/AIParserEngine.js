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
import { extractNativeArtboards } from './AIArtboardExtractor.js'
import { extractGradientDefinitions } from './AIGradientExtractor.js'
import { buildScene } from '../scene/SceneBuilder.js'
import { WasmBridge } from '../wasm/WasmBridge.js'
import { buildCompatibilityReport } from '../engine/CompatibilityEngine.js'
import {
  DiagnosticSeverity,
  createDiagnostic,
  isAbortError,
  toDiagnosticError,
} from '../utils/errors.js'
import { decodeLatin1 } from '../utils/encoding.js'

const now = () => globalThis.performance?.now?.() ?? Date.now()

export const ENGINE_STAGE = 7
export const ENGINE_VERSION = '0.8.0'

const MAX_GRAPHICS_TEXT_BYTES = 16 * 1024 * 1024
const POSTSCRIPT_BODY_MARKERS = ['%%EndSetup', '%%EndProlog', '%AI5_BeginLayer', '%%BeginScript']

function findDrawingStart(text) {
  const layer = text.indexOf('%AI5_BeginLayer')
  if (layer >= 0) return layer

  let start = -1
  for (const marker of ['%%EndSetup', '%%EndProlog', '%%BeginScript']) {
    const index = text.lastIndexOf(marker)
    if (index > start) start = index
  }
  return start >= 0 ? start : 0
}

/**
 * 决定从哪一段文本执行基础绘图解析。
 * - 私有数据已解码：从 %AI5_BeginLayer 开始解析，跳过 prolog / 渐变定义中的非 PostScript 数组
 * - EPS / PostScript：解析 %%EndSetup 之后的绘图段
 * - PDF 且无私有数据：跳过（阶段 2 不解析 PDF 内容流）
 */
function resolveGraphicsSource(bytes, report) {
  const decodedText = report.privateData?.text
  if (typeof decodedText === 'string' && decodedText.length > 0) {
    const start = findDrawingStart(decodedText)
    return {
      text: decodedText.slice(start),
      mode: 'ai-private',
      source: 'private-data',
      truncated: false,
      drawingStart: start,
      fullTextLength: decodedText.length,
      nativeArtboards: extractNativeArtboards(decodedText),
      gradients: extractGradientDefinitions(decodedText),
    }
  }

  const container = report.detection.container
  if (container === 'postscript' || container === 'eps') {
    const limit = Math.min(bytes.byteLength, MAX_GRAPHICS_TEXT_BYTES)
    let text = decodeLatin1(bytes.subarray(0, limit))

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

/**
 * 当 PDF 页面带有比 MediaBox 更小的 ArtBox 时，把它作为可见内容范围。
 * 某些 AI 私有数据会包含隐藏副本/参考稿；ArtBox 与专业软件的实际输出一致。
 * 这不是完整的原生可见性语义，报告中必须明确标记来源。
 */
function computeArtBoxVisibility(report) {
  const hints = report.structure?.pageBoxHints ?? []
  const artBox = hints.find((hint) => hint.kind === 'art-box')
  const mediaBox = hints.find((hint) => hint.kind === 'media-box')
  const artboards = report.graphics?.artboards ?? []
  if (!artBox || !mediaBox || artboards.length !== 1) return null

  const artboard = artboards[0].rect
  const [ax0, ay0, ax1, ay1] = artBox.values
  const [mx0, my0, mx1, my1] = mediaBox.values
  const width = Math.abs(ax1 - ax0)
  const height = Math.abs(ay1 - ay0)
  const mediaWidth = Math.abs(mx1 - mx0)
  const mediaHeight = Math.abs(my1 - my0)
  if (!(width > 0) || !(height > 0)) return null
  if (width >= mediaWidth * 0.98 && height >= mediaHeight * 0.98) return null

  const rect = {
    x: artboard.x + (Math.min(ax0, ax1) - mx0),
    y: artboard.y + (Math.min(ay0, ay1) - my0),
    width,
    height,
  }

  const intersectsArtboard =
    rect.x + rect.width > artboard.x &&
    rect.x < artboard.x + artboard.width &&
    rect.y + rect.height > artboard.y &&
    rect.y < artboard.y + artboard.height
  if (!intersectsArtboard) return null

  return {
    rect,
    source: 'pdf-artbox',
    artBox: [...artBox.values],
    mediaBox: [...mediaBox.values],
  }
}

export class AIParserEngine {
  /**
   * @param {{ maxFileSize?: number, chunkSize?: number, hash?: boolean, wasm?: boolean, wasmBytes?: ArrayBuffer | Uint8Array, wasmUrl?: string }} [options]
   */
  constructor(options = {}) {
    this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE
    this.reader = new AIFileReader({
      maxFileSize: this.maxFileSize,
      chunkSize: options.chunkSize,
      hash: options.hash ?? true,
    })
    this.wasm = new WasmBridge({
      enabled: options.wasm !== false,
      bytes: options.wasmBytes,
      url: options.wasmUrl,
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

      const wasmReady = await this.wasm.init()
      if (!wasmReady && this.wasm.enabled) {
        // 加载失败不阻断解析，记录诊断即可
      }

      const report = await detectStructure(file.bytes, {
        fileName: file.name ?? options.fileName ?? null,
        sha256: file.sha256,
        signal: options.signal,
        decodePrivateData: options.decodePrivateData ?? true,
        wasm: wasmReady ? this.wasm : null,
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

      if (!wasmReady) {
        report.diagnostics.push(
          createDiagnostic(
            'WASM_FALLBACK',
            `WASM 未启用或加载失败，使用 JavaScript 路径：${this.wasm.error ?? '未知原因'}`,
            DiagnosticSeverity.INFO,
          ),
        )
      }

      emit({ phase: 'graphics', ratio: 0.8, message: '提取基础矢量对象…' })

      let graphics
      let gradients = new Map()
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
          gradients = graphicsSource.gradients ?? new Map()
          try {
            graphics = parsePostScript(graphicsSource.text, {
              mode: graphicsSource.mode,
              source: graphicsSource.source,
              artboardHints: report.structure.pageBoxHints,
              container: report.detection.container,
            })
            graphics.textLength = graphicsSource.text.length
            graphics.drawingStart = graphicsSource.drawingStart ?? 0
            graphics.fullTextLength = graphicsSource.fullTextLength ?? graphicsSource.text.length
            if (graphicsSource.nativeArtboards?.length) {
              graphics.artboards = graphicsSource.nativeArtboards
              graphics.artboardSource = 'native-artboard'
              report.diagnostics.push(
                createDiagnostic(
                  'NATIVE_ARTBOARD_DATA',
                  `从 AI DocumentData 解析到 ${graphics.artboards.length} 个原生画板`,
                  DiagnosticSeverity.INFO,
                ),
              )
            } else {
              graphics.artboardSource = graphics.artboards.length > 0 ? 'page-box-hints' : 'none'
            }
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

      const visibility = graphics.status === 'parsed' ? computeArtBoxVisibility(report) : null
      if (visibility) {
        graphics.visibilityBounds = visibility.rect
        graphics.visibilitySource = visibility.source
        graphics.artBox = visibility.artBox
        graphics.mediaBox = visibility.mediaBox
      }

      report.capabilities.postScriptParsing = graphics.status === 'parsed'
      report.capabilities.vectorExtraction = graphics.vectorCount > 0
      report.capabilities.artboardDetection = graphics.artboards.length > 0
      report.capabilities.sceneGraph = graphics.status === 'parsed'
      report.capabilities.canvasRendering = graphics.status === 'parsed'
      report.scene =
        graphics.status === 'parsed'
          ? buildScene(report, { gradients, visibilityBounds: visibility?.rect })
          : null

      if (report.scene && visibility) {
        graphics.visibleVectorCount = report.scene.stats.visibleVectors
        graphics.filteredOutShapes = report.scene.stats.filteredOutVectors
        report.diagnostics.push(
          createDiagnostic(
            'PDF_ARTBOX_VISIBILITY',
            `使用 PDF ArtBox 限定可见内容：${report.scene.stats.vectors} 个解析图形中保留 ${report.scene.stats.visibleVectors} 个，过滤 ${report.scene.stats.filteredOutVectors} 个隐藏/参考副本`,
            DiagnosticSeverity.INFO,
            {
              artBox: visibility.artBox,
              mediaBox: visibility.mediaBox,
              visibilityBounds: visibility.rect,
            },
          ),
        )
      }

      report.compatibility = buildCompatibilityReport(report)
      report.stage = ENGINE_STAGE
      if (report.scene) report.scene.compatibility = report.compatibility
      const wasmUsed = report.scan?.backend === 'wasm'
      report.engine = {
        version: ENGINE_VERSION,
        stage: ENGINE_STAGE,
        javascriptOnly: !wasmUsed,
        wasmUsed,
        wasmAvailable: wasmReady,
        wasmStatus: this.wasm.getStatus(),
        scanBackend: report.scan?.backend ?? 'js',
        boundsBackend: graphics.stats?.boundsBackend ?? 'js',
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
