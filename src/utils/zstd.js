/**
 * Zstandard 解码封装。
 *
 * 运行环境（Node 22 / 当前 Chromium）不提供 `DecompressionStream('zstd')`，
 * 因此使用纯 JavaScript 解码器 fzstd（MIT）作为 JavaScript 回退。
 * 阶段 5 将增加自研 WASM 路径；fzstd 只负责解压，不涉及任何 AI 解析逻辑。
 */

import { decompress } from 'fzstd'
import { AiViewerError, ErrorCodes, throwIfAborted } from './errors.js'

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024

/**
 * @param {ArrayBuffer | ArrayBufferView} input
 * @param {{ maxBytes?: number, signal?: AbortSignal }} [options]
 * @returns {Uint8Array}
 */
export function decompressZstd(input, options = {}) {
  throwIfAborted(options.signal)
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const bytes =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)

  let output
  try {
    output = decompress(bytes)
  } catch (error) {
    throw new AiViewerError(ErrorCodes.INFLATE_FAILED, 'Zstandard 数据解压失败', {
      cause: error instanceof Error ? error.message : String(error),
    })
  }

  if (output.byteLength > maxBytes) {
    throw new AiViewerError(ErrorCodes.INFLATE_LIMIT, `Zstandard 解压结果超过上限 ${maxBytes} 字节`, {
      maxBytes,
    })
  }
  return output
}
