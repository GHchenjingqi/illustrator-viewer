/**
 * AIWorkerClient
 * ----------------
 * 主线程 Worker 客户端：
 * - 任务 ID 防止旧任务覆盖新任务
 * - 进度回调
 * - 取消
 * - Worker 不可用时回退主线程引擎
 */

import { AIParserEngine } from '../core/AIParserEngine.js'
import AIWorker from './AIWorker.js?worker&inline'

export class AIWorkerClient {
  /**
   * @param {{ workerFactory?: () => Worker, fallbackEngine?: AIParserEngine, wasm?: boolean }} [options]
   */
  constructor(options = {}) {
    this.workerFactory = options.workerFactory ?? null
    this.fallbackEngine = options.fallbackEngine ?? new AIParserEngine()
    this.wasm = options.wasm ?? true
    this.wasmUrl = options.wasmUrl ?? null
    this.worker = null
    this.sequence = 0
    this.activeTaskId = null
    this.listeners = new Map()
    this.workerFailed = false
    this.lastError = null
  }

  ensureWorker() {
    if (this.worker) return this.worker
    if (this.workerFailed) return null

    try {
      this.worker =
        this.workerFactory?.() ??
        new AIWorker()
      this.worker.addEventListener('message', (event) => {
        const message = event.data ?? {}
        const listener = this.listeners.get(message.taskId)
        if (!listener) return
        listener(message)
      })
      this.worker.addEventListener('error', (event) => {
        this.lastError = event?.message ?? 'Worker 运行错误'
        this.workerFailed = true
        for (const listener of this.listeners.values()) {
          listener({
            type: 'PARSE_ERROR',
            error: { code: 'WORKER_FAILED', message: this.lastError, details: {} },
            aborted: false,
          })
        }
        this.listeners.clear()
      })
      return this.worker
    } catch (error) {
      this.workerFailed = true
      this.lastError = error instanceof Error ? error.message : String(error)
      return null
    }
  }

  /**
   * @param {File | Blob | ArrayBuffer} source
   * @param {{ signal?: AbortSignal, onProgress?: Function, maxFileSize?: number }} [options]
   */
  async parse(source, options = {}) {
    const worker = this.ensureWorker()
    if (!worker) {
      this.lastTransport = 'main'
      return this.fallbackEngine.parse(source, options)
    }

    this.lastTransport = 'worker'
    if (this.activeTaskId) {
      this.worker?.postMessage({ type: 'PARSE_CANCEL', taskId: this.activeTaskId })
    }
    const taskId = `task-${++this.sequence}`
    this.activeTaskId = taskId

    return new Promise((resolve) => {
      let settled = false

      const finish = (result) => {
        if (settled) return
        settled = true
        this.listeners.delete(taskId)
        if (this.activeTaskId === taskId) this.activeTaskId = null
        options.signal?.removeEventListener('abort', onAbort)
        resolve(result)
      }

      const onAbort = () => {
        worker.postMessage({ type: 'PARSE_CANCEL', taskId })
        finish({
          ok: false,
          aborted: true,
          error: { code: 'ABORTED', message: '解析任务已取消', details: {} },
        })
      }

      this.listeners.set(taskId, (message) => {
        if (message.taskId !== taskId) return
        if (message.type === 'PARSE_PROGRESS') {
          try {
            options.onProgress?.(message.progress)
          } catch {
            // UI 回调异常不影响解析
          }
          return
        }
        if (message.type === 'WASM_READY') {
          this.wasmReady = Boolean(message.ready)
          this.scanBackend = message.backend
          return
        }
        if (message.type === 'PARSE_RESULT') {
          finish({ ok: true, report: message.report, aborted: false })
          return
        }
        if (message.type === 'PARSE_ERROR') {
          finish({
            ok: false,
            aborted: Boolean(message.aborted),
            error: message.error ?? { code: 'UNKNOWN', message: 'Worker 解析失败', details: {} },
          })
        }
      })

      if (options.signal?.aborted) {
        onAbort()
        return
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })

      worker.postMessage({
        type: 'PARSE_START',
        taskId,
        source,
        options: {
          maxFileSize: options.maxFileSize,
          decodePrivateData: options.decodePrivateData ?? true,
          parseGraphics: options.parseGraphics ?? true,
          wasm: options.wasm ?? this.wasm,
          wasmUrl: options.wasmUrl ?? this.wasmUrl ?? undefined,
        },
      })
    })
  }

  cancel() {
    if (!this.worker || !this.activeTaskId) return
    this.worker.postMessage({ type: 'PARSE_CANCEL', taskId: this.activeTaskId })
  }

  terminate() {
    this.worker?.terminate()
    this.worker = null
    this.listeners.clear()
    this.activeTaskId = null
  }
}
