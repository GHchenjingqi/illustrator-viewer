/**
 * AIParserEngine
 * ----------------
 * 统一解析入口。阶段 1 只调度：
 * AIFileReader → AIFileDetector → CompatibilityEngine
 *
 * 后续阶段将在此接入 PGF / PostScript / VectorParser / Scene Graph，
 * Vue 组件只调用本入口，不直接触碰解析逻辑。
 */

import { AIFileReader, DEFAULT_MAX_FILE_SIZE } from './AIFileReader.js'
import { detectStructure } from './AIFileDetector.js'
import { buildCompatibilityReport } from '../engine/CompatibilityEngine.js'
import {
  DiagnosticSeverity,
  createDiagnostic,
  isAbortError,
  toDiagnosticError,
} from '../utils/errors.js'

const now = () => globalThis.performance?.now?.() ?? Date.now()

export const ENGINE_STAGE = 1
export const ENGINE_VERSION = '0.1.0'

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
            ratio: event.ratio === null ? 0 : event.ratio * 0.6,
            message: '读取文件…',
            loaded: event.loaded,
            total: event.total,
          })
        },
      })

      emit({ phase: 'detect', ratio: 0.7, message: '识别文件结构与版本…' })

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

      report.compatibility = buildCompatibilityReport(report)
      report.engine = {
        version: ENGINE_VERSION,
        stage: ENGINE_STAGE,
        javascriptOnly: true,
        wasmUsed: false,
      }
      report.durationMs = Number((now() - started).toFixed(2))

      emit({ phase: 'done', ratio: 1, message: '结构检测完成' })
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
