/**
 * 统一错误与诊断模型。
 * 解析失败必须转换为结构化信息，不能让 Vue 页面直接崩溃。
 */

export const ErrorCodes = Object.freeze({
  EMPTY_FILE: 'EMPTY_FILE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_SOURCE: 'UNSUPPORTED_SOURCE',
  ABORTED: 'ABORTED',
  READ_FAILED: 'READ_FAILED',
  HASH_UNAVAILABLE: 'HASH_UNAVAILABLE',
  BINARY_RANGE: 'BINARY_RANGE',
  BINARY_ARGUMENT: 'BINARY_ARGUMENT',
  INFLATE_UNAVAILABLE: 'INFLATE_UNAVAILABLE',
  INFLATE_FAILED: 'INFLATE_FAILED',
  INFLATE_LIMIT: 'INFLATE_LIMIT',
  ASCII85_INVALID: 'ASCII85_INVALID',
  DETECT_FAILED: 'DETECT_FAILED',
})

export const DiagnosticSeverity = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
})

export class AiViewerError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'AiViewerError'
    this.code = code
    this.details = details
  }
}

/**
 * @param {unknown} error
 * @returns {{ code: string, message: string, details: Record<string, unknown> }}
 */
export function toDiagnosticError(error) {
  if (error instanceof AiViewerError) {
    return { code: error.code, message: error.message, details: error.details ?? {} }
  }
  if (error instanceof Error) {
    return { code: 'UNEXPECTED_ERROR', message: error.message, details: { name: error.name } }
  }
  return { code: 'UNEXPECTED_ERROR', message: String(error), details: {} }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {string} [severity]
 * @param {Record<string, unknown>} [details]
 */
export function createDiagnostic(code, message, severity = DiagnosticSeverity.INFO, details = {}) {
  return { code, message, severity, ...details }
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === ErrorCodes.ABORTED
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    const reason = signal.reason
    if (reason instanceof Error) throw reason
    throw new DOMException('操作已取消', 'AbortError')
  }
}
