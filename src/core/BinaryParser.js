/**
 * BinaryParser
 * ----------------
 * 所有二进制读取集中在此模块，责任：
 * - 字节 / 整数 / 浮点读取
 * - 偏移定位、数据块提取
 * - 编码与压缩块识别（zlib / zstd / ASCII85）
 * - 边界检查，禁止越界读取
 *
 * 注意：本模块只做数据访问，不包含任何 AI 语法解析逻辑。
 */

import { AiViewerError, ErrorCodes, throwIfAborted } from '../utils/errors.js'

const DEFAULT_MAX_STRING_LENGTH = 4 * 1024 * 1024
const DEFAULT_MAX_INFLATE_BYTES = 256 * 1024 * 1024
const DEFAULT_MAX_ASCII85_BYTES = 256 * 1024 * 1024

/** @param {ArrayBuffer | ArrayBufferView} input */
export function toUint8Array(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  }
  throw new AiViewerError(ErrorCodes.BINARY_ARGUMENT, '需要 ArrayBuffer 或 Uint8Array 数据')
}

/**
 * Boyer-Moore-Horspool 字节序列查找。
 * @param {Uint8Array} haystack
 * @param {Uint8Array} needle
 * @param {number} from
 * @param {number} to
 */
export function indexOfBytes(haystack, needle, from = 0, to = haystack.length) {
  const needleLength = needle.length
  if (needleLength === 0) return Math.min(Math.max(from, 0), to)
  if (from < 0) from = 0
  if (to > haystack.length) to = haystack.length
  if (to - from < needleLength) return -1

  const skip = new Uint32Array(256).fill(needleLength)
  for (let i = 0; i < needleLength - 1; i += 1) {
    skip[needle[i]] = needleLength - 1 - i
  }

  let cursor = from + needleLength - 1
  while (cursor < to) {
    let index = needleLength - 1
    while (index >= 0 && haystack[cursor - needleLength + 1 + index] === needle[index]) {
      index -= 1
    }
    if (index < 0) return cursor - needleLength + 1
    cursor += skip[haystack[cursor]] || 1
  }
  return -1
}

/** zlib 头（RFC 1950）快速判断。 */
export function looksLikeZlib(bytes, offset = 0) {
  if (bytes.length - offset < 2) return false
  const cmf = bytes[offset]
  const flg = bytes[offset + 1]
  if ((cmf & 0x0f) !== 0x08) return false
  if (((cmf << 8) + flg) % 31 !== 0) return false
  return (flg & 0x20) === 0
}

/** Zstandard 帧头（0x28 0xB5 0x2F 0xFD）。 */
export function looksLikeZstandard(bytes, offset = 0) {
  if (bytes.length - offset < 4) return false
  return (
    bytes[offset] === 0x28 &&
    bytes[offset + 1] === 0xb5 &&
    bytes[offset + 2] === 0x2f &&
    bytes[offset + 3] === 0xfd
  )
}

const ASCII85_WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20])

/**
 * 解码 ASCII85（Adobe 变体，支持 `<~` / `~>` 边界与 `z` 缩写）。
 * @param {string | Uint8Array} input
 * @param {{ maxBytes?: number }} [options]
 */
export function decodeAscii85(input, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_ASCII85_BYTES
  const target = typeof input === 'string' ? input : new TextDecoder('latin1').decode(input)

  let capacity = Math.min(64 * 1024, Math.max(16, target.length))
  let output = new Uint8Array(capacity)
  let outLength = 0

  const ensure = (extra) => {
    if (outLength + extra <= output.length) return
    let next = output.length * 2
    while (next < outLength + extra) next *= 2
    if (next > maxBytes) next = maxBytes
    if (next < outLength + extra) {
      throw new AiViewerError(
        ErrorCodes.ASCII85_INVALID,
        `ASCII85 解码结果超过上限 ${maxBytes} 字节`,
      )
    }
    const grown = new Uint8Array(next)
    grown.set(output.subarray(0, outLength))
    output = grown
  }

  let group = []
  let finished = false

  let begin = 0
  while (begin < target.length && ASCII85_WHITESPACE.has(target.charCodeAt(begin))) begin += 1
  if (target.charCodeAt(begin) === 0x3c && target.charCodeAt(begin + 1) === 0x7e) {
    begin += 2
  }

  for (let i = begin; i < target.length; i += 1) {
    const code = target.charCodeAt(i)
    if (code === 0x7e) {
      // '~' 只有在后面紧跟 '>' 时才结束
      if (target.charCodeAt(i + 1) === 0x3e) {
        finished = true
        i += 1
      } else {
        throw new AiViewerError(ErrorCodes.ASCII85_INVALID, `ASCII85 非法字符 '~'（位置 ${i}）`)
      }
      break
    }
    if (ASCII85_WHITESPACE.has(code)) continue

    if (code === 0x7a) {
      // 'z' = 四个零字节，只允许出现在组边界
      if (group.length !== 0) {
        throw new AiViewerError(ErrorCodes.ASCII85_INVALID, `ASCII85 'z' 出现在组中间（位置 ${i}）`)
      }
      ensure(4)
      output.fill(0, outLength, outLength + 4)
      outLength += 4
      continue
    }

    if (code < 33 || code > 117) {
      throw new AiViewerError(
        ErrorCodes.ASCII85_INVALID,
        `ASCII85 非法字符 0x${code.toString(16)}（位置 ${i}）`,
      )
    }

    group.push(code - 33)
    if (group.length === 5) {
      let value = 0
      for (const digit of group) value = value * 85 + digit
      ensure(4)
      output[outLength] = (value >>> 24) & 0xff
      output[outLength + 1] = (value >>> 16) & 0xff
      output[outLength + 2] = (value >>> 8) & 0xff
      output[outLength + 3] = value & 0xff
      outLength += 4
      group = []
    }
  }

  if (group.length === 1) {
    throw new AiViewerError(ErrorCodes.ASCII85_INVALID, 'ASCII85 末尾组长度非法')
  }
  if (group.length > 1) {
    const outputCount = group.length - 1
    while (group.length < 5) group.push(84)
    let value = 0
    for (const digit of group) value = value * 85 + digit
    ensure(outputCount)
    const bytes = [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]
    output.set(bytes.slice(0, outputCount), outLength)
    outLength += outputCount
  }

  if (!finished) {
    // 没有 ~> 结束符也可以解码（部分 Adobe 数据会省略），由调用方决定是否告警
  }

  return output.slice(0, outLength)
}

/**
 * 使用浏览器原生 DecompressionStream 解压 zlib（deflate 包装格式）。
 * 原生实现不依赖第三方压缩库；WASM 加速在阶段 5 接入。
 *
 * AI 私有数据块后面通常紧跟 `%AI12_EndCompressedData` 等文本标记，
 * 解压流读到尾部会产生 "Trailing junk" 错误，因此保留已解出的数据并标记 trailingData。
 *
 * @param {ArrayBuffer | ArrayBufferView} input
 * @param {{ maxBytes?: number, signal?: AbortSignal, format?: string }} [options]
 */
export async function inflateBytes(input, options = {}) {
  const bytes = toUint8Array(input)
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_INFLATE_BYTES
  const format = options.format ?? 'deflate'
  throwIfAborted(options.signal)

  if (typeof DecompressionStream === 'undefined') {
    throw new AiViewerError(
      ErrorCodes.INFLATE_UNAVAILABLE,
      '当前运行环境不支持 DecompressionStream，无法解压私有数据',
    )
  }

  let stream
  try {
    stream = new DecompressionStream(format)
  } catch (error) {
    throw new AiViewerError(ErrorCodes.INFLATE_UNAVAILABLE, `不支持的解压格式：${format}`, {
      cause: error instanceof Error ? error.message : String(error),
    })
  }

  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()

  const writeTask = (async () => {
    try {
      await writer.write(bytes.slice())
      await writer.close()
    } catch {
      // 读取端会报告真正的错误；这里只负责避免未处理的 Promise rejection
    }
  })()

  /** @type {Uint8Array[]} */
  const chunks = []
  let total = 0
  let trailingData = false
  let readError = null

  try {
    for (;;) {
      throwIfAborted(options.signal)
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new AiViewerError(
          ErrorCodes.INFLATE_LIMIT,
          `解压数据超过安全上限 ${maxBytes} 字节`,
          { maxBytes },
        )
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof AiViewerError) throw error
    if (error?.name === 'AbortError') throw error
    readError = error
    trailingData = total > 0
  } finally {
    await writeTask
  }

  if (total === 0 && readError) {
    throw new AiViewerError(ErrorCodes.INFLATE_FAILED, 'zlib 数据解压失败', {
      cause: readError instanceof Error ? readError.message : String(readError),
    })
  }

  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }

  return {
    bytes: output,
    trailingData,
    error: readError instanceof Error ? readError.message : readError ? String(readError) : null,
  }
}

export class BinaryParser {
  /**
   * @param {ArrayBuffer | ArrayBufferView} input
   * @param {{ maxStringLength?: number }} [options]
   */
  constructor(input, options = {}) {
    this.bytes = toUint8Array(input)
    this.length = this.bytes.byteLength
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength)
    this.maxStringLength = options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH
  }

  assertRange(offset, length = 1) {
    if (!Number.isInteger(offset) || !Number.isInteger(length)) {
      throw new AiViewerError(ErrorCodes.BINARY_ARGUMENT, 'offset 与 length 必须是整数')
    }
    if (offset < 0 || length < 0 || offset + length > this.length) {
      throw new AiViewerError(
        ErrorCodes.BINARY_RANGE,
        `二进制读取越界：offset=${offset}, length=${length}, size=${this.length}`,
        { offset, length, size: this.length },
      )
    }
  }

  readUint8(offset) {
    this.assertRange(offset, 1)
    return this.view.getUint8(offset)
  }

  readInt8(offset) {
    this.assertRange(offset, 1)
    return this.view.getInt8(offset)
  }

  readUint16(offset, littleEndian = false) {
    this.assertRange(offset, 2)
    return this.view.getUint16(offset, littleEndian)
  }

  readUint32(offset, littleEndian = false) {
    this.assertRange(offset, 4)
    return this.view.getUint32(offset, littleEndian)
  }

  readInt32(offset, littleEndian = false) {
    this.assertRange(offset, 4)
    return this.view.getInt32(offset, littleEndian)
  }

  readFloat32(offset, littleEndian = false) {
    this.assertRange(offset, 4)
    return this.view.getFloat32(offset, littleEndian)
  }

  readFloat64(offset, littleEndian = false) {
    this.assertRange(offset, 8)
    return this.view.getFloat64(offset, littleEndian)
  }

  /** 返回原始字节视图（不复制，调用方不得修改）。 */
  readBytes(offset, length) {
    this.assertRange(offset, length)
    return this.bytes.subarray(offset, offset + length)
  }

  /** 以 Latin-1 / ASCII 方式读取字符串，适用于标记与操作符。 */
  readAscii(offset, length) {
    if (length > this.maxStringLength) {
      throw new AiViewerError(
        ErrorCodes.BINARY_ARGUMENT,
        `字符串读取长度 ${length} 超过上限 ${this.maxStringLength}`,
      )
    }
    this.assertRange(offset, length)
    let result = ''
    const end = offset + length
    for (let i = offset; i < end; i += 1) {
      result += String.fromCharCode(this.bytes[i])
    }
    return result
  }

  /** UTF-8 解码（容错）。 */
  toText(offset = 0, length = this.length - offset) {
    this.assertRange(offset, length)
    return new TextDecoder('utf-8', { fatal: false }).decode(
      this.bytes.subarray(offset, offset + length),
    )
  }

  toLatin1(offset = 0, length = this.length - offset) {
    this.assertRange(offset, length)
    return new TextDecoder('latin1').decode(this.bytes.subarray(offset, offset + length))
  }

  findAscii(needle, options = {}) {
    const pattern =
      typeof needle === 'string' ? Uint8Array.from(needle, (char) => char.charCodeAt(0) & 0xff) : needle
    return indexOfBytes(
      this.bytes,
      pattern,
      options.from ?? 0,
      options.to ?? this.length,
    )
  }

  findLastAscii(needle, options = {}) {
    const from = options.from ?? 0
    const to = options.to ?? this.length
    const pattern =
      typeof needle === 'string'
        ? Uint8Array.from(needle, (char) => char.charCodeAt(0) & 0xff)
        : needle
    if (pattern.length === 0) return Math.min(Math.max(from, 0), to)
    for (let cursor = to - pattern.length; cursor >= from; cursor -= 1) {
      let matched = true
      for (let index = 0; index < pattern.length; index += 1) {
        if (this.bytes[cursor + index] !== pattern[index]) {
          matched = false
          break
        }
      }
      if (matched) return cursor
    }
    return -1
  }

  /**
   * 在 [from, to) 内查找全部匹配位置。
   * @returns {number[]}
   */
  findAllAscii(needle, options = {}) {
    const from = options.from ?? 0
    const to = options.to ?? this.length
    const limit = options.limit ?? 1000
    const pattern =
      typeof needle === 'string' ? Uint8Array.from(needle, (char) => char.charCodeAt(0) & 0xff) : needle
    const results = []
    let cursor = from
    while (cursor < to && results.length < limit) {
      const found = indexOfBytes(this.bytes, pattern, cursor, to)
      if (found < 0) break
      results.push(found)
      cursor = found + Math.max(1, pattern.length)
    }
    return results
  }
}
