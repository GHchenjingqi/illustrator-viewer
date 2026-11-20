/**
 * AI24Extractor
 * ----------------
 * Illustrator 24+ 的私有数据使用 Zstandard 压缩，并且通常被拆分为多个
 * PDF stream 对象（例如对象 11–18，每块 64 KiB）。
 *
 * 本模块负责：
 * 1. 从 `%AI24_ZStandard_Data` 标记向前定位所属 PDF stream 对象；
 * 2. 按对象编号顺序拼接后续 stream 块；
 * 3. 依次尝试前缀解压，找到完整 zstd frame；
 * 4. 返回解压后的字节与分块元信息。
 *
 * 不解析 PDF 页面内容；只提取 AI 私有数据块。
 */

import { indexOfBytes } from './BinaryParser.js'
import { decompressZstd } from '../utils/zstd.js'
import { throwIfAborted } from '../utils/errors.js'
import { decodeLatin1 } from '../utils/encoding.js'

const MARKER = '%AI24_ZStandard_Data'
const MAX_CHUNKS = 64
const HEADER_WINDOW = 8192
const NEXT_HEADER_WINDOW = 4096

const STREAM_HEADER = /(\d+)\s+0\s+obj\s*<<[^>]*?\/Length\s+(\d+)[^>]*?>>\s*stream\r?\n/g

const END_STREAM_CRLF = Uint8Array.from([0x0d, 0x0a, 0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d])
const END_STREAM_LF = Uint8Array.from([0x0a, 0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d])
const END_STREAM_CR = Uint8Array.from([0x0d, 0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d])

function concatBytes(totalLength, chunks) {
  const output = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function trimTrailingWhitespace(bytes) {
  let end = bytes.byteLength
  while (end > 0) {
    const byte = bytes[end - 1]
    if (byte === 0x0a || byte === 0x0d || byte === 0x20 || byte === 0x09) end -= 1
    else break
  }
  return end === bytes.byteLength ? bytes : bytes.subarray(0, end)
}

function findStreamEnd(bytes, from) {
  const positions = [
    indexOfBytes(bytes, END_STREAM_CRLF, from),
    indexOfBytes(bytes, END_STREAM_LF, from),
    indexOfBytes(bytes, END_STREAM_CR, from),
  ].filter((position) => position >= 0)
  return positions.length > 0 ? Math.min(...positions) : -1
}

function findNearestHeader(bytes, markerOffset) {
  const windowStart = Math.max(0, markerOffset - HEADER_WINDOW)
  const text = decodeLatin1(bytes.subarray(windowStart, markerOffset))
  const regex = new RegExp(STREAM_HEADER.source, 'g')
  let match
  let last = null
  while ((match = regex.exec(text)) !== null) {
    last = match
  }
  if (!last) return null

  const dataStart = windowStart + last.index + last[0].length
  return {
    objectNumber: Number(last[1]),
    declaredLength: Number(last[2]),
    dataStart,
    headerOffset: windowStart + last.index,
  }
}

function findNextHeader(bytes, from) {
  const windowEnd = Math.min(bytes.length, from + NEXT_HEADER_WINDOW)
  const text = decodeLatin1(bytes.subarray(from, windowEnd))
  const regex = new RegExp(STREAM_HEADER.source, 'g')
  const match = regex.exec(text)
  if (!match) return null
  return {
    objectNumber: Number(match[1]),
    declaredLength: Number(match[2]),
    dataStart: from + match.index + match[0].length,
    headerOffset: from + match.index,
  }
}

/**
 * @param {Uint8Array} bytes 完整文件
 * @param {number} markerOffset `%AI24_ZStandard_Data` 的偏移
 * @param {{ maxBytes?: number, signal?: AbortSignal }} [options]
 */
export async function extractAi24Zstd(bytes, markerOffset, options = {}) {
  throwIfAborted(options.signal)
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024
  const dataStart = markerOffset + MARKER.length

  const firstHeader = findNearestHeader(bytes, markerOffset)
  const insideStream =
    firstHeader &&
    firstHeader.dataStart <= markerOffset &&
    markerOffset - firstHeader.dataStart <= 1024

  const chunks = []
  let objectNumber = null

  if (insideStream) {
    objectNumber = firstHeader.objectNumber
    let current = firstHeader

    for (let index = 0; index < MAX_CHUNKS; index += 1) {
      const end = findStreamEnd(bytes, current.dataStart)
      if (end < 0) break
      const start = index === 0 ? dataStart : current.dataStart
      if (end > start) chunks.push(bytes.subarray(start, end))
      const next = findNextHeader(bytes, end)
      if (!next || next.objectNumber !== current.objectNumber + 1) break
      current = next
    }
  }

  if (chunks.length === 0) {
    // 回退：标记后直接是 zstd 数据，直到文件末尾
    chunks.push(bytes.subarray(dataStart))
  }

  let combined = new Uint8Array(0)
  let lastError = null

  for (let index = 0; index < chunks.length; index += 1) {
    throwIfAborted(options.signal)
    const next = concatBytes(combined.byteLength + chunks[index].byteLength, [
      combined,
      chunks[index],
    ])
    combined = next

    try {
      const decoded = decompressZstd(combined, { maxBytes, signal: options.signal })
      return {
        status: 'decoded',
        bytes: decoded,
        compressedBytes: combined.byteLength,
        chunksUsed: index + 1,
        chunkCount: chunks.length,
        objectNumber,
        source: insideStream ? 'pdf-stream-chunks' : 'raw-zstd',
      }
    } catch (error) {
      // 某些 AI 文件在 zstd frame 后附带换行/空白；fzstd 会拒绝尾部字节，
      // 而 Node/原生 zstd 能正常解压。先尝试裁剪尾部空白。
      const trimmed = trimTrailingWhitespace(combined)
      if (trimmed.byteLength !== combined.byteLength && trimmed.byteLength > 0) {
        try {
          const decoded = decompressZstd(trimmed, { maxBytes, signal: options.signal })
          return {
            status: 'decoded',
            bytes: decoded,
            compressedBytes: trimmed.byteLength,
            chunksUsed: index + 1,
            chunkCount: chunks.length,
            objectNumber,
            source: insideStream ? 'pdf-stream-chunks' : 'raw-zstd',
          }
        } catch {
          // 保留原始错误，继续尝试后续分块
        }
      }
      lastError = error
    }
  }

  return {
    status: 'failed',
    bytes: null,
    compressedBytes: combined.byteLength,
    chunksUsed: 0,
    chunkCount: chunks.length,
    objectNumber,
    source: insideStream ? 'pdf-stream-chunks' : 'raw-zstd',
    error:
      lastError instanceof Error
        ? lastError.message
        : lastError
          ? String(lastError)
          : '没有可解压的 Zstandard 数据',
  }
}
