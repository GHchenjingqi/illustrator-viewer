/**
 * AIFileReader
 * ----------------
 * 负责把 File / Blob / ArrayBuffer / Uint8Array 统一读取为 Uint8Array。
 * - 支持分块流式读取与进度回调
 * - 支持取消（AbortSignal）
 * - 不修改原始数据
 * - 可选计算 SHA-256（用于测试样本登记）
 */

import { AiViewerError, ErrorCodes, throwIfAborted } from '../utils/errors.js'

export const DEFAULT_MAX_FILE_SIZE = 512 * 1024 * 1024
export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024

function isBlobLike(source) {
  return (
    source != null &&
    typeof source === 'object' &&
    typeof source.size === 'number' &&
    typeof source.slice === 'function' &&
    typeof source.arrayBuffer === 'function'
  )
}

function concatChunks(chunks, total) {
  if (chunks.length === 1) return chunks[0]
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new AiViewerError(ErrorCodes.HASH_UNAVAILABLE, '当前环境不支持 SHA-256')
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export class AIFileReader {
  /**
   * @param {{ chunkSize?: number, maxFileSize?: number, hash?: boolean }} [options]
   */
  constructor(options = {}) {
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
    this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE
    this.hash = options.hash ?? true
  }

  /**
   * @param {File | Blob | ArrayBuffer | ArrayBufferView} source
   * @param {{ signal?: AbortSignal, onProgress?: (event: { phase: string, loaded: number, total: number, ratio: number | null }) => void }} [options]
   */
  async read(source, options = {}) {
    const { signal } = options
    const onProgress = options.onProgress ?? (() => {})
    throwIfAborted(signal)

    let bytes
    let name = null
    let type = ''
    let lastModified = null
    let total = 0

    if (isBlobLike(source)) {
      total = source.size
      name = typeof source.name === 'string' ? source.name : null
      type = typeof source.type === 'string' ? source.type : ''
      lastModified = Number.isFinite(source.lastModified) ? source.lastModified : null
      bytes = await this.readBlob(source, { signal, onProgress })
    } else if (source instanceof ArrayBuffer) {
      total = source.byteLength
      bytes = new Uint8Array(source)
      onProgress({ phase: 'read', loaded: total, total, ratio: total === 0 ? 0 : 1 })
    } else if (ArrayBuffer.isView(source)) {
      total = source.byteLength
      bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      onProgress({ phase: 'read', loaded: total, total, ratio: total === 0 ? 0 : 1 })
    } else {
      throw new AiViewerError(
        ErrorCodes.UNSUPPORTED_SOURCE,
        '不支持的文件来源：需要 File / Blob / ArrayBuffer / Uint8Array',
      )
    }

    throwIfAborted(signal)

    if (bytes.byteLength === 0) {
      throw new AiViewerError(ErrorCodes.EMPTY_FILE, '文件内容为空')
    }
    if (bytes.byteLength > this.maxFileSize) {
      throw new AiViewerError(
        ErrorCodes.FILE_TOO_LARGE,
        `文件大小 ${bytes.byteLength} 字节超过上限 ${this.maxFileSize} 字节`,
        { size: bytes.byteLength, maxFileSize: this.maxFileSize },
      )
    }

    let sha256 = null
    let hashError = null
    if (this.hash) {
      try {
        sha256 = await sha256Hex(bytes)
      } catch (error) {
        hashError = error instanceof Error ? error.message : String(error)
      }
      throwIfAborted(signal)
    }

    return {
      bytes,
      name,
      type,
      size: bytes.byteLength,
      lastModified,
      sha256,
      hashError,
    }
  }

  async readBlob(blob, options) {
    const { signal } = options
    const onProgress = options.onProgress ?? (() => {})
    const total = blob.size

    if (typeof blob.stream === 'function') {
      const reader = blob.stream().getReader()
      const chunks = []
      let loaded = 0
      try {
        for (;;) {
          throwIfAborted(signal)
          const { done, value } = await reader.read()
          if (done) break
          if (!value) continue
          loaded += value.byteLength
          if (loaded > this.maxFileSize) {
            await reader.cancel().catch(() => {})
            throw new AiViewerError(
              ErrorCodes.FILE_TOO_LARGE,
              `文件读取超过上限 ${this.maxFileSize} 字节`,
              { size: loaded, maxFileSize: this.maxFileSize },
            )
          }
          chunks.push(value)
          onProgress({
            phase: 'read',
            loaded,
            total,
            ratio: total > 0 ? Math.min(loaded / total, 1) : null,
          })
        }
      } catch (error) {
        if (error instanceof AiViewerError || error?.name === 'AbortError') throw error
        throw new AiViewerError(ErrorCodes.READ_FAILED, '读取文件流失败', {
          cause: error instanceof Error ? error.message : String(error),
        })
      } finally {
        reader.releaseLock?.()
      }
      return concatChunks(chunks, loaded)
    }

    // 回退路径：按块 slice 读取，兼容不支持 Blob.stream 的环境
    const chunks = []
    let loaded = 0
    try {
      while (loaded < total) {
        throwIfAborted(signal)
        const end = Math.min(loaded + this.chunkSize, total)
        const buffer = await blob.slice(loaded, end).arrayBuffer()
        const chunk = new Uint8Array(buffer)
        chunks.push(chunk)
        loaded += chunk.byteLength
        onProgress({
          phase: 'read',
          loaded,
          total,
          ratio: total > 0 ? Math.min(loaded / total, 1) : null,
        })
      }
    } catch (error) {
      if (error instanceof AiViewerError || error?.name === 'AbortError') throw error
      throw new AiViewerError(ErrorCodes.READ_FAILED, '分块读取文件失败', {
        cause: error instanceof Error ? error.message : String(error),
      })
    }
    return concatChunks(chunks, loaded)
  }
}
