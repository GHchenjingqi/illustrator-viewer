/**
 * AIGradientExtractor
 * ----------------
 * 从 AI 私有数据的 `%AI5_BeginGradient` 块中提取渐变停靠点。
 *
 * 真实 AI24 样本中的停靠点行（`%_BS`）包含：
 *   c m y k  r g b  <type> <...> <midpoint> <position>
 * 或 6 个数字（RGB + 元数据）：
 *   r g b  <...> <position>
 *
 * 位置通常以 0–100 表示；实现归一化到 0–1。
 * 几何（线性/径向、角度、矩阵）仍不完整，渲染时会明确标记为近似渐变。
 */

import { decodeMaybeUtf8 } from '../utils/encoding.js'

const BLOCK_PATTERN = /%AI5_BeginGradient:\s*\(([^()\r\n]{1,160})\)([\s\S]*?)%AI5_EndGradient/g
const NUMBER_PATTERN = /-?\d+(?:\.\d+)?/g

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1)
}

function normalizePosition(value, fallback) {
  if (!Number.isFinite(value)) return fallback
  const normalized = Math.abs(value) > 1.5 ? value / 100 : value
  return clamp01(normalized)
}

function parseStopLine(line) {
  const marker = line.indexOf('%_BS')
  if (marker < 0) return null
  const numericPart = line.slice(0, marker)
  const values = [...numericPart.matchAll(NUMBER_PATTERN)].map((match) => Number(match[0]))
  if (values.length < 6) return null

  const position = normalizePosition(values[values.length - 1], Number.NaN)
  let rgb
  let cmyk = null

  if (values.length >= 12) {
    cmyk = values.slice(0, 4).map(clamp01)
    rgb = values.slice(4, 7).map(clamp01)
  } else {
    rgb = values.slice(0, 3).map(clamp01)
  }

  if (!rgb.every(Number.isFinite)) return null
  return { position, rgb, cmyk, raw: values }
}

/**
 * @param {string} text 完整私有数据文本
 * @returns {Map<string, { name: string, stops: Array<{offset:number,rgb:number[]}>, approxColor: number[], source: string, note: string }>}
 */
export function extractGradientDefinitions(text) {
  const definitions = new Map()
  if (typeof text !== 'string' || text.length === 0) return definitions

  BLOCK_PATTERN.lastIndex = 0
  let block
  while ((block = BLOCK_PATTERN.exec(text)) !== null) {
    const name = decodeMaybeUtf8(block[1].trim())
    const body = block[2]
    const stops = []
    const seen = new Set()

    for (const line of body.split(/\r?\n/)) {
      const stop = parseStopLine(line)
      if (!stop) continue
      const key = stop.raw.join(',')
      if (seen.has(key)) continue
      seen.add(key)
      stops.push(stop)
    }

    if (stops.length === 0) continue

    stops.sort((a, b) => a.position - b.position)
    const fallbackStep = stops.length > 1 ? 1 / (stops.length - 1) : 0
    stops.forEach((stop, index) => {
      if (!Number.isFinite(stop.position)) stop.position = index * fallbackStep
    })

    const normalizedStops = stops.map((stop) => ({
      offset: clamp01(stop.position),
      rgb: stop.rgb,
      cmyk: stop.cmyk,
    }))

    const avg = [0, 1, 2].map(
      (channel) =>
        normalizedStops.reduce((sum, stop) => sum + stop.rgb[channel], 0) /
        normalizedStops.length,
    )

    definitions.set(name, {
      name,
      stops: normalizedStops,
      approxColor: avg,
      source: 'ai-gradient-stops',
      note: '停靠点颜色来自 %_BS 行；渐变几何仍为近似，渲染时标记 approximate',
    })
  }

  return definitions
}
