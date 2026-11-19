/**
 * AIFileDetector
 * ----------------
 * 阶段 1 目标：不做矢量解析，只回答下面这些问题：
 * - 这个 .ai 文件内部到底是什么容器？(PDF / EPS / PostScript / 未知)
 * - 版本与 Creator 信息是什么？
 * - 是否包含 Illustrator 私有数据（PGF/PostScript 层）？
 * - 私有数据是否压缩？能否在 JS 侧解压？
 * - 关键结构标记位于哪里？
 * - 当前引擎具备哪些解析能力、有哪些未支持项？
 *
 * 重要：检测结果不是“兼容性承诺”。阶段 1 没有图形解析能力，
 * capabilities 中所有图形相关项均为 false。
 */

import {
  BinaryParser,
  decodeAscii85,
  inflateBytes,
  looksLikeZlib,
  looksLikeZstandard,
} from './BinaryParser.js'
import {
  AiViewerError,
  DiagnosticSeverity,
  ErrorCodes,
  createDiagnostic,
} from '../utils/errors.js'
import { extractPageBoxes } from './PageBoxExtractor.js'
import { extractAi24Zstd } from './AI24Extractor.js'
import { decompressZstd } from '../utils/zstd.js'
import { decodeLatin1 } from '../utils/encoding.js'

export const ContainerKind = Object.freeze({
  PDF: 'pdf',
  EPS: 'eps',
  POSTSCRIPT: 'postscript',
  UNKNOWN: 'unknown',
})

const SCAN_HEAD_BYTES = 2 * 1024 * 1024
const SCAN_TAIL_BYTES = 16 * 1024 * 1024
const SMALL_FILE_LIMIT = 24 * 1024 * 1024
const MAX_PRIVATE_DATA_BYTES = 64 * 1024 * 1024
const MAX_INFLATE_BYTES = 128 * 1024 * 1024
const MAX_MARKER_COUNT = 2000
const DOS_EPS_MAGIC = [0xc5, 0xd0, 0xd3, 0xc6]

export const MARKER_DEFINITIONS = Object.freeze([
  { id: 'pdfHeader', label: 'PDF 文件头', needle: '%PDF-', group: 'container' },
  { id: 'psHeader', label: 'PostScript 文件头', needle: '%!PS-Adobe', group: 'container' },
  { id: 'aiCreator', label: 'Illustrator Creator 标记', needle: '%%Creator: Adobe Illustrator', group: 'meta' },
  { id: 'boundingBox', label: 'EPS BoundingBox', needle: '%%BoundingBox', group: 'container' },
  { id: 'endSetup', label: 'PostScript Setup 结束', needle: '%%EndSetup', group: 'container' },
  { id: 'beginScript', label: '内嵌脚本段', needle: '%%BeginScript', group: 'container' },
  { id: 'beginData', label: '二进制数据块', needle: '%%BeginData:', group: 'data' },
  { id: 'endData', label: '二进制数据块结束', needle: '%%EndData', group: 'data' },
  { id: 'ai5BeginLayer', label: 'AI5 图层开始', needle: '%AI5_BeginLayer', group: 'private' },
  { id: 'ai5EndLayer', label: 'AI5 图层结束', needle: '%AI5_EndLayer--', group: 'private' },
  { id: 'ai9PrivateBegin', label: 'AI9 私有数据开始', needle: '%AI9_PrivateDataBegin', group: 'private' },
  { id: 'ai9PrivateEnd', label: 'AI9 私有数据结束', needle: '%AI9_PrivateDataEnd', group: 'private' },
  { id: 'ai12Compressed', label: 'AI12 压缩数据', needle: '%AI12_CompressedData', group: 'private' },
  { id: 'ai12EndCompressed', label: 'AI12 压缩数据结束', needle: '%AI12_EndCompressedData', group: 'private' },
  { id: 'ai24Zstandard', label: 'AI24 Zstandard 数据', needle: '%AI24_ZStandard_Data', group: 'private' },
  { id: 'startxref', label: 'PDF startxref', needle: 'startxref', group: 'pdf' },
  { id: 'eof', label: '文件结束标记', needle: '%%EOF', group: 'pdf' },
])

const CREATOR_LABELS = Object.freeze({
  8: 'Adobe Illustrator 8',
  9: 'Adobe Illustrator 9',
  10: 'Adobe Illustrator 10',
  11: 'Adobe Illustrator CS',
  12: 'Adobe Illustrator CS2',
  13: 'Adobe Illustrator CS3',
  14: 'Adobe Illustrator CS4',
  15: 'Adobe Illustrator CS5',
  16: 'Adobe Illustrator CS6',
})

const CREATOR_PATTERNS = [
  /%%Creator:\s*Adobe Illustrator(?:\(R\))?\s*([0-9][0-9.]*)/i,
  /Adobe Illustrator(?:\(R\))?\s*([0-9][0-9.]*)/i,
]

function measure() {
  return globalThis.performance?.now?.() ?? Date.now()
}

function isWhitespace(byte) {
  return byte === 0x0a || byte === 0x0d || byte === 0x20 || byte === 0x09
}

function sanitizePreview(text, maxLength = 800) {
  if (!text) return ''
  return text
    .slice(0, maxLength)
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '·')
}

function findCreator(text) {
  if (!text) return null
  for (const pattern of CREATOR_PATTERNS) {
    const match = pattern.exec(text)
    if (match?.[1]) return match[1]
  }
  return null
}

function buildScanWindows(size) {
  if (size <= SMALL_FILE_LIMIT) {
    return [{ start: 0, end: size, region: 'full' }]
  }
  const headEnd = Math.min(SCAN_HEAD_BYTES, size)
  const tailStart = Math.max(headEnd, size - SCAN_TAIL_BYTES)
  return [
    { start: 0, end: headEnd, region: 'head' },
    { start: tailStart, end: size, region: 'tail' },
  ]
}

function scanMarkers(parser, windows) {
  const results = []
  for (const definition of MARKER_DEFINITIONS) {
    let firstOffset = -1
    let count = 0
    let countCapped = false

    for (const window of windows) {
      const found = parser.findAllAscii(definition.needle, {
        from: window.start,
        to: window.end,
        limit: 500,
      })
      if (found.length > 0) {
        if (firstOffset < 0 || found[0] < firstOffset) firstOffset = found[0]
        count += found.length
        if (found.length >= 500) countCapped = true
      }
    }

    results.push({
      id: definition.id,
      label: definition.label,
      needle: definition.needle,
      group: definition.group,
      present: count > 0,
      offset: firstOffset,
      count: Math.min(count, MAX_MARKER_COUNT),
      countCapped,
    })
  }
  return results
}

function toMarkerMap(markers) {
  return Object.fromEntries(markers.map((marker) => [marker.id, marker]))
}

function collectWindowText(parser, windows) {
  return windows.map((window) => ({
    ...window,
    text: parser.toLatin1(window.start, window.end - window.start),
  }))
}

function collectAiTags(textWindows) {
  const counts = new Map()
  let matches = 0
  for (const window of textWindows) {
    const regex = /%AI(\d+)_([A-Za-z0-9_]+)/g
    let match
    while ((match = regex.exec(window.text)) !== null && matches < 5000) {
      const key = `AI${match[1]}_${match[2]}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
      matches += 1
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => (a.tag < b.tag ? -1 : 1))
}

function collectBinaryDataBlocks(textWindows) {
  const blocks = []
  for (const window of textWindows) {
    const regex = /%%BeginData:\s*(\d+)\s+([A-Za-z ]*?)Bytes/g
    let match
    while ((match = regex.exec(window.text)) !== null && blocks.length < 32) {
      blocks.push({
        offset: window.start + match.index,
        declaredBytes: Number(match[1]),
        description: match[2].trim() || 'Binary',
      })
    }
  }
  return blocks
}

function detectFormVersion(textWindows) {
  for (const window of textWindows) {
    const match = /%PDF-(\d+\.\d+)/.exec(window.text)
    if (match) return match[1]
  }
  return null
}

function detectContainer(parser, markersById) {
  const headLength = Math.min(parser.length, 1024)
  const headText = parser.toLatin1(0, headLength)
  const diagnostics = []

  if (DOS_EPS_MAGIC.every((byte, index) => parser.bytes[index] === byte)) {
    if (parser.length < 32) {
      diagnostics.push(
        createDiagnostic(
          'EPS_HEADER_TRUNCATED',
          '检测到 DOS EPS 魔数，但文件头不足 32 字节，无法读取偏移信息',
          DiagnosticSeverity.ERROR,
        ),
      )
      return { kind: ContainerKind.EPS, variant: 'dos-eps', headerOffset: 0, confidence: 'low', diagnostics }
    }

    const psOffset = parser.readUint32(4, true)
    const psLength = parser.readUint32(8, true)
    const inBounds = psOffset > 0 && psLength > 0 && psOffset + psLength <= parser.length
    if (!inBounds) {
      diagnostics.push(
        createDiagnostic(
          'EPS_PS_SECTION_INVALID',
          `DOS EPS 的 PostScript 段偏移/长度越界：offset=${psOffset}, length=${psLength}, size=${parser.length}`,
          DiagnosticSeverity.ERROR,
          { psOffset, psLength, size: parser.length },
        ),
      )
    } else {
      diagnostics.push(
        createDiagnostic(
          'EPS_PS_SECTION',
          `DOS EPS 容器：PostScript 段位于 ${psOffset}，长度 ${psLength} 字节`,
          DiagnosticSeverity.INFO,
          { psOffset, psLength },
        ),
      )
    }

    return {
      kind: ContainerKind.EPS,
      variant: 'dos-eps',
      headerOffset: 0,
      psOffset: inBounds ? psOffset : null,
      psLength: inBounds ? psLength : null,
      confidence: inBounds ? 'high' : 'low',
      diagnostics,
    }
  }

  const pdfIndex = headText.indexOf('%PDF-')
  if (pdfIndex >= 0) {
    if (pdfIndex > 0) {
      diagnostics.push(
        createDiagnostic(
          'PDF_HEADER_OFFSET',
          `PDF 文件头不在偏移 0，而在 ${pdfIndex}（PDF 规范允许在前 1024 字节内）`,
          DiagnosticSeverity.INFO,
          { offset: pdfIndex },
        ),
      )
    }
    return {
      kind: ContainerKind.PDF,
      variant: 'pdf',
      headerOffset: pdfIndex,
      confidence: markersById.eof?.present || markersById.aiCreator?.present ? 'high' : 'medium',
      diagnostics,
    }
  }

  const psIndex = headText.indexOf('%!PS-Adobe')
  if (psIndex >= 0) {
    const isEps = markersById.boundingBox?.present === true
    if (isEps) {
      diagnostics.push(
        createDiagnostic('EPS_BOUNDING_BOX', '检测到 %%BoundingBox，按 EPS 处理', DiagnosticSeverity.INFO),
      )
    }
    return {
      kind: isEps ? ContainerKind.EPS : ContainerKind.POSTSCRIPT,
      variant: isEps ? 'eps-ps' : 'postscript',
      headerOffset: psIndex,
      confidence: markersById.aiCreator?.present ? 'high' : 'medium',
      diagnostics,
    }
  }

  diagnostics.push(
    createDiagnostic(
      'UNKNOWN_CONTAINER',
      '未识别出 PDF / EPS / PostScript 容器特征，无法确定文件内部结构',
      DiagnosticSeverity.ERROR,
    ),
  )
  return {
    kind: ContainerKind.UNKNOWN,
    variant: 'unknown',
    headerOffset: -1,
    confidence: 'low',
    diagnostics,
  }
}

function collectDecodedMarkers(text) {
  const definitions = [
    { id: 'ai5BeginLayer', label: 'AI5 图层开始', needle: '%AI5_BeginLayer' },
    { id: 'ai5EndLayer', label: 'AI5 图层结束', needle: '%AI5_EndLayer--' },
    { id: 'ai5BeginGroup', label: 'AI5 组开始', needle: '%AI5_BeginGroup' },
    { id: 'ai5EndGroup', label: 'AI5 组结束', needle: '%AI5_EndGroup' },
    { id: 'ai9FileData', label: 'AI9 文档数据', needle: '%AI9_FileData' },
    { id: 'ai12CsPt', label: 'AI12 CsPt 段', needle: '%AI12_CsPt' },
    { id: 'ai12Pgf', label: 'AI12 PGF 段', needle: '%AI12_PGF' },
  ]
  return definitions
    .map((definition) => {
      let count = 0
      let cursor = 0
      for (;;) {
        const found = text.indexOf(definition.needle, cursor)
        if (found < 0 || count >= MAX_MARKER_COUNT) break
        count += 1
        cursor = found + definition.needle.length
      }
      return { ...definition, count }
    })
    .filter((entry) => entry.count > 0)
}

async function inflatePrivateData(compressed, options) {
  try {
    const result = await inflateBytes(compressed, {
      maxBytes: MAX_INFLATE_BYTES,
      signal: options.signal,
    })
    return {
      status: 'decoded',
      encoding: 'zlib',
      bytes: result.bytes,
      trailingData: result.trailingData,
      error: result.error,
    }
  } catch (error) {
    return {
      status: 'failed',
      encoding: 'zlib',
      bytes: null,
      trailingData: false,
      error: error instanceof AiViewerError ? error.message : String(error),
    }
  }
}

/**
 * 分析 `%AI12_CompressedData` / `%AI24_ZStandard_Data` 私有数据块。
 */
async function analyzeCompressedBlock(parser, marker, endMarkerId, formatName, options) {
  const diagnostics = []
  let cursor = marker.offset + marker.needle.length
  while (cursor < parser.length && isWhitespace(parser.bytes[cursor])) cursor += 1

  const endOffset = endMarkerId
    ? parser.findAscii(
        MARKER_DEFINITIONS.find((definition) => definition.id === endMarkerId).needle,
        { from: cursor },
      )
    : -1

  const regionLength = (endOffset >= 0 ? endOffset : parser.length) - cursor
  const base = {
    status: 'absent',
    format: formatName,
    marker: marker.needle,
    markerOffset: marker.offset,
    dataOffset: cursor,
    endOffset: endOffset >= 0 ? endOffset : null,
    declaredDataLength: regionLength > 0 ? regionLength : 0,
    compression: 'unknown',
    decodedBytes: 0,
    textLength: 0,
    trailingData: false,
    preview: '',
    decodedMarkers: [],
    error: null,
  }

  if (regionLength <= 0) {
    diagnostics.push(
      createDiagnostic(
        'PRIVATE_DATA_EMPTY',
        '私有数据标记存在，但没有可读取的数据段',
        DiagnosticSeverity.WARNING,
      ),
    )
    return { ...base, status: 'failed', diagnostics }
  }

  if (regionLength > MAX_PRIVATE_DATA_BYTES) {
    diagnostics.push(
      createDiagnostic(
        'PRIVATE_DATA_SKIPPED',
        `私有数据段 ${regionLength} 字节超过阶段 1 检测上限 ${MAX_PRIVATE_DATA_BYTES} 字节，已跳过解压`,
        DiagnosticSeverity.WARNING,
        { regionLength, limit: MAX_PRIVATE_DATA_BYTES },
      ),
    )
    return { ...base, status: 'skipped', diagnostics }
  }

  const region = parser.bytes.subarray(cursor, cursor + regionLength)
  let compressed = region
  let encoding = 'raw'

  if (looksLikeZlib(region)) {
    encoding = 'zlib'
  } else if (looksLikeZstandard(region)) {
    encoding = 'zstd'
  } else if (region[0] === 0x3c && region[1] === 0x7e) {
    encoding = 'ascii85'
    try {
      compressed = decodeAscii85(region, { maxBytes: MAX_INFLATE_BYTES })
      if (looksLikeZlib(compressed)) encoding = 'ascii85+zlib'
      else if (looksLikeZstandard(compressed)) encoding = 'ascii85+zstd'
    } catch (error) {
      diagnostics.push(
        createDiagnostic(
          'PRIVATE_DATA_DECODE_FAILED',
          `ASCII85 解码失败：${error instanceof Error ? error.message : String(error)}`,
          DiagnosticSeverity.WARNING,
        ),
      )
      return { ...base, status: 'failed', compression: 'ascii85', error: String(error), diagnostics }
    }
  }

  let decoded = null
  let trailingData = false
  let failure = null
  let unsupported = null
  let extraction = null

  if (encoding === 'zlib' || encoding === 'ascii85+zlib') {
    const result = await inflatePrivateData(compressed, options)
    if (result.status === 'decoded') {
      decoded = result.bytes
      trailingData = result.trailingData
    } else {
      failure = result.error
    }
  } else if (encoding === 'zstd') {
    extraction = await extractAi24Zstd(parser.bytes, marker.offset, {
      maxBytes: MAX_INFLATE_BYTES,
      signal: options.signal,
    })
    if (extraction.status === 'decoded') {
      decoded = extraction.bytes
    } else {
      failure = extraction.error
    }
  } else if (encoding === 'ascii85+zstd') {
    try {
      decoded = decompressZstd(compressed, {
        maxBytes: MAX_INFLATE_BYTES,
        signal: options.signal,
      })
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
  } else {
    // 未压缩的原始私有数据（旧版本或已解压的工具输出）
    decoded = region
  }

  if (!decoded) {
    const message = unsupported
      ? `当前浏览器不支持 zstd 解压：${unsupported}`
      : `私有数据解压失败：${failure ?? '未知错误'}`
    diagnostics.push(
      createDiagnostic(
        unsupported ? 'PRIVATE_DATA_COMPRESSION_UNSUPPORTED' : 'PRIVATE_DATA_DECODE_FAILED',
        message,
        DiagnosticSeverity.WARNING,
      ),
    )
    return {
      ...base,
      status: unsupported ? 'unsupported' : 'failed',
      compression: encoding,
      error: unsupported ?? failure,
      diagnostics,
    }
  }

  if (trailingData) {
    diagnostics.push(
      createDiagnostic(
        'PRIVATE_DATA_TRAILING_DATA',
        '解压流尾部存在额外数据（通常是紧随其后的文本结束标记），已保留有效解压结果',
        DiagnosticSeverity.INFO,
      ),
    )
  }

  const text = decodeLatin1(decoded)
  const decodedMarkers = collectDecodedMarkers(text)

  return {
    ...base,
    status: 'decoded',
    compression: encoding,
    decodedBytes: decoded.byteLength,
    textLength: text.length,
    declaredDataLength: extraction?.compressedBytes ?? base.declaredDataLength,
    chunkCount: extraction?.chunkCount ?? null,
    chunksUsed: extraction?.chunksUsed ?? null,
    streamObject: extraction?.objectNumber ?? null,
    dataSource: extraction?.source ?? null,
    trailingData,
    preview: sanitizePreview(text),
    decodedMarkers,
    text,
    diagnostics,
  }
}

/**
 * 分析 `%AI9_PrivateDataBegin` 私有数据段（EPS / 旧版）。
 * 该段常见形态：`%` 前缀的 ASCII85 + zlib 数据。
 */
async function analyzeAi9PrivateData(parser, marker, options) {
  const diagnostics = []
  const endMarker = MARKER_DEFINITIONS.find((definition) => definition.id === 'ai9PrivateEnd')
  const endOffset = parser.findAscii(endMarker.needle, { from: marker.offset + marker.needle.length })
  const start = marker.offset + marker.needle.length
  const regionLength = (endOffset >= 0 ? endOffset : parser.length) - start

  const base = {
    status: 'absent',
    format: 'AI9',
    marker: marker.needle,
    markerOffset: marker.offset,
    dataOffset: start,
    endOffset: endOffset >= 0 ? endOffset : null,
    declaredDataLength: Math.max(regionLength, 0),
    compression: 'unknown',
    decodedBytes: 0,
    textLength: 0,
    trailingData: false,
    preview: '',
    decodedMarkers: [],
    error: null,
  }

  if (regionLength <= 0) {
    diagnostics.push(
      createDiagnostic('PRIVATE_DATA_EMPTY', 'AI9 私有数据段为空', DiagnosticSeverity.WARNING),
    )
    return { ...base, status: 'failed', diagnostics }
  }
  if (regionLength > MAX_PRIVATE_DATA_BYTES) {
    diagnostics.push(
      createDiagnostic(
        'PRIVATE_DATA_SKIPPED',
        `AI9 私有数据段 ${regionLength} 字节超过阶段 1 检测上限，已跳过`,
        DiagnosticSeverity.WARNING,
      ),
    )
    return { ...base, status: 'skipped', diagnostics }
  }

  const region = parser.bytes.subarray(start, start + regionLength)
  const rawText = decodeLatin1(region)
  const cleaned = rawText
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('%%'))
    .map((line) => (line.trimStart().startsWith('%') ? line.trimStart().slice(1) : line))
    .join('\n')
    .trim()

  let decoded = null
  let encoding = 'text'
  let trailingData = false
  let failure = null

  try {
    if (cleaned.startsWith('<~')) {
      encoding = 'ascii85'
      const binary = decodeAscii85(cleaned, { maxBytes: MAX_INFLATE_BYTES })
      if (looksLikeZlib(binary)) {
        encoding = 'ascii85+zlib'
        const result = await inflatePrivateData(binary, options)
        if (result.status === 'decoded') {
          decoded = result.bytes
          trailingData = result.trailingData
        } else {
          failure = result.error
        }
      } else {
        decoded = binary
      }
    } else {
      decoded = new TextEncoder().encode(cleaned)
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }

  if (!decoded) {
    diagnostics.push(
      createDiagnostic(
        'PRIVATE_DATA_DECODE_FAILED',
        `AI9 私有数据解码失败：${failure ?? '未知错误'}`,
        DiagnosticSeverity.WARNING,
      ),
    )
    return { ...base, status: 'failed', compression: encoding, error: failure, diagnostics }
  }

  const text = decodeLatin1(decoded)
  return {
    ...base,
    status: 'decoded',
    compression: encoding,
    decodedBytes: decoded.byteLength,
    textLength: text.length,
    trailingData,
    preview: sanitizePreview(text),
    decodedMarkers: collectDecodedMarkers(text),
    text,
    diagnostics,
  }
}

async function extractPrivateData(parser, markersById, options) {
  if (markersById.ai12Compressed?.present) {
    return analyzeCompressedBlock(
      parser,
      markersById.ai12Compressed,
      'ai12EndCompressed',
      'AI12',
      options,
    )
  }
  if (markersById.ai24Zstandard?.present) {
    return analyzeCompressedBlock(parser, markersById.ai24Zstandard, null, 'AI24', options)
  }
  if (markersById.ai9PrivateBegin?.present) {
    return analyzeAi9PrivateData(parser, markersById.ai9PrivateBegin, options)
  }

  return {
    status: 'absent',
    format: null,
    marker: null,
    markerOffset: -1,
    dataOffset: -1,
    endOffset: null,
    declaredDataLength: 0,
    compression: 'none',
    decodedBytes: 0,
    textLength: 0,
    trailingData: false,
    preview: '',
    decodedMarkers: [],
    error: null,
    diagnostics: [],
  }
}

function deriveAiFormatVersion(aiTags, privateData) {
  const versions = new Set()
  for (const entry of aiTags) {
    const match = /^AI(\d+)_/.exec(entry.tag)
    if (match) {
      const version = Number(match[1])
      if (Number.isInteger(version) && version > 0 && version < 100) versions.add(version)
    }
  }
  if (privateData.format === 'AI12') versions.add(12)
  if (privateData.format === 'AI24') versions.add(24)
  if (privateData.format === 'AI9') versions.add(9)
  return {
    versions: [...versions].sort((a, b) => a - b),
    primary: versions.size > 0 ? Math.max(...versions) : null,
  }
}

function describeAiVersion(version) {
  if (!version) return null
  // `%AI12_` 等前缀表示“私有段格式/压缩方案”的引入版本，
  // 并不等同于文件的营销版本（例如 Illustrator 2020 也会使用 AI12 压缩段）。
  return `AI 私有格式标记 AI${version}`
}

function describeCreatorVersion(creator) {
  if (!creator) return null
  const major = Number.parseInt(creator, 10)
  if (!Number.isInteger(major) || major <= 0) return null
  return CREATOR_LABELS[major] ?? `Adobe Illustrator ${major}`
}

/**
 * 主入口：检测文件结构并生成结构化报告。
 *
 * @param {ArrayBuffer | ArrayBufferView} input
 * @param {{ fileName?: string | null, sha256?: string | null, signal?: AbortSignal, decodePrivateData?: boolean }} [options]
 */
export async function detectStructure(input, options = {}) {
  const started = measure()
  const parser = new BinaryParser(input)
  if (parser.length === 0) {
    throw new AiViewerError(ErrorCodes.EMPTY_FILE, '文件内容为空')
  }

  const windows = buildScanWindows(parser.length)
  const markers = scanMarkers(parser, windows)
  const markersById = toMarkerMap(markers)
  const textWindows = collectWindowText(parser, windows)
  const aiTags = collectAiTags(textWindows)
  const binaryDataBlocks = collectBinaryDataBlocks(textWindows)
  const pdfVersion = detectFormVersion(textWindows)
  const pageBoxHints = []
  for (const window of textWindows) {
    if (pageBoxHints.length >= 24) break
    pageBoxHints.push(
      ...extractPageBoxes(window.text, {
        offsetBase: window.start,
        limit: 24 - pageBoxHints.length,
      }),
    )
  }

  const container = detectContainer(parser, markersById)
  const diagnostics = [...container.diagnostics]

  const rawCreator = textWindows.map((window) => findCreator(window.text)).find(Boolean) ?? null

  const privateData =
    options.decodePrivateData === false
      ? {
          status: 'skipped',
          format: null,
          marker: null,
          markerOffset: -1,
          dataOffset: -1,
          endOffset: null,
          declaredDataLength: 0,
          compression: 'unknown',
          decodedBytes: 0,
          textLength: 0,
          trailingData: false,
          preview: '',
          decodedMarkers: [],
          error: null,
          diagnostics: [],
        }
      : await extractPrivateData(parser, markersById, { signal: options.signal })
  diagnostics.push(...privateData.diagnostics)

  const creator = rawCreator ?? findCreator(privateData.text) ?? null
  const decodedText = privateData.text ?? ''
  const applicationVersion =
    /%%AI8_CreatorVersion:\s*([0-9][0-9.]*)/.exec(decodedText)?.[1] ?? null
  const layerCountMatch = /%AI5_NumLayers:\s*(\d+)/.exec(decodedText)
  const declaredLayerCount = layerCountMatch ? Number(layerCountMatch[1]) : null
  const artboardCountMatch = /(-?\d+)\s*\/Int\s*\(LastArtboardID\)/.exec(decodedText)
  const declaredArtboardCount = artboardCountMatch ? Number(artboardCountMatch[1]) : null
  const { versions: aiFormatVersions, primary: aiFormatVersion } = deriveAiFormatVersion(
    aiTags,
    privateData,
  )

  if (!creator) {
    diagnostics.push(
      createDiagnostic(
        'CREATOR_NOT_FOUND',
        '未找到 Illustrator Creator 版本字符串（文件可能不是 Illustrator 导出，或版本信息被压缩/加密）',
        DiagnosticSeverity.INFO,
      ),
    )
  }

  const scannedBytes = windows.reduce((sum, window) => sum + (window.end - window.start), 0)
  const scanTruncated = scannedBytes < parser.length
  if (scanTruncated) {
    diagnostics.push(
      createDiagnostic(
        'SCAN_TRUNCATED',
        `为保证性能，结构标记仅扫描了文件首尾共 ${scannedBytes} 字节（文件共 ${parser.length} 字节）`,
        DiagnosticSeverity.INFO,
        { scannedBytes, size: parser.length },
      ),
    )
  }

  if (container.kind === ContainerKind.PDF) {
    if (!markersById.eof?.present) {
      diagnostics.push(
        createDiagnostic(
          'TRUNCATED_FILE',
          'PDF 容器缺少 %%EOF 结束标记，文件可能被截断',
          DiagnosticSeverity.WARNING,
        ),
      )
    }
    if (!markersById.ai12Compressed?.present && !markersById.ai24Zstandard?.present && !markersById.ai9PrivateBegin?.present) {
      diagnostics.push(
        createDiagnostic(
          'PDF_WITHOUT_PRIVATE_DATA',
          'PDF 容器中未发现 Illustrator 私有数据标记；该文件可能只是普通 PDF，或私有数据布局尚未覆盖',
          DiagnosticSeverity.WARNING,
        ),
      )
    }
  }

  if (container.kind === ContainerKind.POSTSCRIPT && !markersById.aiCreator?.present) {
    diagnostics.push(
      createDiagnostic(
        'POSTSCRIPT_WITHOUT_AI_CREATOR',
        'PostScript 容器中未发现 Illustrator Creator 标记',
        DiagnosticSeverity.INFO,
      ),
    )
  }

  const hasPrivateData = privateData.status !== 'absent'
  const structure = {
    hasPdf: container.kind === ContainerKind.PDF,
    hasPostScript:
      container.kind === ContainerKind.POSTSCRIPT ||
      container.kind === ContainerKind.EPS ||
      Boolean(markersById.psHeader?.present),
    hasPrivateData,
    hasPgfLayer: hasPrivateData,
    hasCompressedData:
      privateData.compression === 'zlib' ||
      privateData.compression === 'zstd' ||
      privateData.compression === 'ascii85+zlib' ||
      privateData.compression === 'ascii85+zstd',
    hasBinaryDataBlocks: binaryDataBlocks.length > 0,
    binaryDataBlocks,
    pageBoxHints,
    aiTagCount: aiTags.length,
    aiTags,
  }

  const capabilities = {
    structureDetection: true,
    privateDataExtraction: privateData.status === 'decoded' || privateData.status === 'raw',
    privateDataDecode: privateData.status === 'decoded',
    postScriptParsing: false,
    pgfParsing: false,
    sceneGraph: false,
    canvasRendering: false,
    pdfPreviewImageExtraction: false,
  }

  const decodedSize = privateData.decodedBytes
  const containerLabel = {
    [ContainerKind.PDF]: 'PDF 容器',
    [ContainerKind.EPS]: 'EPS（PostScript）',
    [ContainerKind.POSTSCRIPT]: 'PostScript',
    [ContainerKind.UNKNOWN]: '未知容器',
  }[container.kind]

  const report = {
    schemaVersion: 1,
    stage: 1,
    generatedAt: new Date().toISOString(),
    file: {
      name: options.fileName ?? null,
      size: parser.length,
      sha256: options.sha256 ?? null,
    },
    detection: {
      container: container.kind,
      containerLabel,
      variant: container.variant,
      headerOffset: container.headerOffset,
      confidence: container.confidence,
      pdfVersion,
      aiFormatVersion,
      aiFormatVersions,
      aiFormatLabel: describeAiVersion(aiFormatVersion),
      creator,
      creatorLabel: describeCreatorVersion(creator),
      applicationVersion,
      declaredLayerCount,
      declaredArtboardCount,
      creatorSource: rawCreator ? 'raw' : creator ? 'private-data' : null,
      encoding: 'binary',
    },
    structure,
    privateData: {
      status: privateData.status,
      format: privateData.format,
      marker: privateData.marker,
      markerOffset: privateData.markerOffset,
      dataOffset: privateData.dataOffset,
      endOffset: privateData.endOffset,
      declaredDataLength: privateData.declaredDataLength,
      compression: privateData.compression,
      decodedBytes: decodedSize,
      textLength: privateData.textLength,
      chunkCount: privateData.chunkCount ?? null,
      chunksUsed: privateData.chunksUsed ?? null,
      streamObject: privateData.streamObject ?? null,
      dataSource: privateData.dataSource ?? null,
      trailingData: privateData.trailingData,
      preview: privateData.preview,
      decodedMarkers: privateData.decodedMarkers,
      // 瞬态字段：仅供 AIParserEngine 在内部执行矢量解析，返回 UI 前会被删除
      text: privateData.text ?? '',
      error: privateData.error,
    },
    markers,
    capabilities,
    diagnostics,
    scan: {
      scannedBytes,
      size: parser.length,
      truncated: scanTruncated,
      windows: windows.map(({ start, end, region }) => ({ start, end, region })),
      elapsedMs: Number((measure() - started).toFixed(2)),
    },
    summary: buildSummary(
      containerLabel,
      describeCreatorVersion(creator) ?? describeAiVersion(aiFormatVersion),
      privateData.status,
    ),
  }

  return report
}

function buildSummary(containerLabel, versionLabel, privateDataStatus) {
  const statusLabel = {
    decoded: '私有数据已定位并成功解码',
    unsupported: '私有数据已定位，但当前环境无法解压',
    failed: '私有数据解码失败',
    skipped: '私有数据解码已跳过',
    absent: '未发现 AI 私有数据',
  }[privateDataStatus]
  return `${containerLabel} · ${versionLabel ?? '版本未知'} · ${statusLabel}`
}
