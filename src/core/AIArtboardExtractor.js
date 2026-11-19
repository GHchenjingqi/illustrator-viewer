/**
 * AIArtboardExtractor
 * ----------------
 * 从 Illustrator 私有数据的 DocumentData 中提取原生画板信息。
 *
 * 真实 AI24 样本中的结构（简化）：
 *   (画板 1) /UnicodeString (Name) ,
 *   1250 -700 /RealPointRelToROrigin
 *   (PositionPoint2) ,
 *   0 0 /RealPointRelToROrigin
 *   (PositionPoint1) ,
 *   ... (ArtboardArray)
 *
 * 该结构不是标准 PostScript，阶段 2 以受控的正则提取，并校验坐标合法。
 * 结果标记为 native-artboard；仍属于部分支持，需更多版本样本验证。
 */

import { decodeMaybeUtf8 } from '../utils/encoding.js'

const POINT_PATTERN =
  /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\/RealPointRelToROrigin[\s\S]{0,96}?\(PositionPoint([12])\)/g

const NAME_PATTERN = /\(([^()\r\n]{1,160})\)\s*\/UnicodeString\s*\(Name\)/g

function decodeName(value) {
  const text = String(value ?? '').trim()
  return text ? decodeMaybeUtf8(text) : ''
}

function clampArtboardRect(a, b) {  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const width = Math.abs(b.x - a.x)
  const height = Math.abs(b.y - a.y)
  if (![x, y, width, height].every(Number.isFinite)) return null
  if (width <= 0 || height <= 0 || width > 1e7 || height > 1e7) return null
  return { x, y, width, height }
}

/**
 * @param {string} text 完整私有数据文本
 * @returns {Array<{ id: string, name: string, rect: object, unit: string, source: string, confidence: string, note: string }>}
 */
export function extractNativeArtboards(text) {
  if (typeof text !== 'string' || text.length === 0) return []

  const arrayIndex = text.indexOf('(ArtboardArray)')
  const windowEnd = arrayIndex > 0 ? arrayIndex : text.length
  const windowStart = Math.max(0, windowEnd - 65536)
  const windowText = text.slice(windowStart, windowEnd)

  const points1 = []
  const points2 = []
  POINT_PATTERN.lastIndex = 0
  let match
  while ((match = POINT_PATTERN.exec(windowText)) !== null) {
    const point = { x: Number(match[1]), y: Number(match[2]) }
    if (match[3] === '1') points1.push(point)
    else points2.push(point)
  }

  const names = []
  NAME_PATTERN.lastIndex = 0
  while ((match = NAME_PATTERN.exec(windowText)) !== null) {
    names.push(match[1])
  }

  const count = Math.min(points1.length, points2.length)
  if (count === 0) return []

  const artboards = []
  const seen = new Set()
  for (let index = 0; index < count; index += 1) {
    const rect = clampArtboardRect(points1[index], points2[index])
    if (!rect) continue
    const key = `${rect.x},${rect.y},${rect.width},${rect.height}`
    if (seen.has(key)) continue
    seen.add(key)

    artboards.push({
      id: `artboard-${artboards.length + 1}`,
      name: decodeName(names[index]) || `Artboard ${artboards.length + 1}`,
      rect,
      unit: 'pt',
      source: 'native-artboard',
      confidence: 'medium',
      note: '来自 AI DocumentData 的 ArtboardArray；已通过坐标范围校验，待更多版本样本验证',
    })
  }

  return artboards
}
