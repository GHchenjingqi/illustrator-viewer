/**
 * AIWorker
 * ----------------
 * 后台解析线程。主线程只发送文件与任务 ID，不在主线程执行大文件解析。
 *
 * 协议：
 *   PARSE_START / PARSE_PROGRESS / PARSE_RESULT / PARSE_ERROR / PARSE_CANCEL / WASM_READY
 */

import { AIParserEngine } from '../core/AIParserEngine.js'

let currentTaskId = null
let controller = null

function post(type, payload) {
  self.postMessage({ type, ...payload })
}

function wasmUrl() {
  const base = import.meta.env.BASE_URL || '/'
  return new URL(`${base}wasm/ai_viewer_wasm.wasm`, self.location.origin).href
}

self.onmessage = async (event) => {
  const message = event.data ?? {}

  if (message.type === 'PARSE_CANCEL') {
    if (message.taskId && message.taskId !== currentTaskId) return
    controller?.abort()
    return
  }

  if (message.type !== 'PARSE_START') return

  const { taskId, source, options = {} } = message
  if (!taskId || !source) {
    post('PARSE_ERROR', {
      taskId: taskId ?? null,
      aborted: false,
      error: { code: 'INVALID_TASK', message: 'PARSE_START 缺少 taskId 或文件', details: {} },
    })
    return
  }

  currentTaskId = taskId
  controller?.abort()
  controller = new AbortController()
  const engine = new AIParserEngine({
    maxFileSize: options.maxFileSize,
    hash: options.hash ?? true,
    wasm: options.wasm ?? true,
    wasmUrl: wasmUrl(),
  })

  try {
    const result = await engine.parse(source, {
      signal: controller.signal,
      decodePrivateData: options.decodePrivateData ?? true,
      parseGraphics: options.parseGraphics ?? true,
      onProgress: (progress) => {
        if (taskId !== currentTaskId) return
        post('PARSE_PROGRESS', { taskId, progress })
      },
    })

    if (taskId !== currentTaskId) return

    if (result.ok) {
      post('WASM_READY', {
        taskId,
        ready: Boolean(result.report?.engine?.wasmAvailable),
        backend: result.report?.scan?.backend ?? 'js',
      })
      post('PARSE_RESULT', { taskId, report: result.report })
    } else {
      post('PARSE_ERROR', {
        taskId,
        aborted: Boolean(result.aborted),
        error: result.error,
      })
    }
  } catch (error) {
    if (taskId !== currentTaskId) return
    post('PARSE_ERROR', {
      taskId,
      aborted: false,
      error: {
        code: 'WORKER_PARSE_FAILED',
        message: error instanceof Error ? error.message : String(error),
        details: {},
      },
    })
  } finally {
    if (taskId === currentTaskId) {
      controller = null
      currentTaskId = null
    }
  }
}
