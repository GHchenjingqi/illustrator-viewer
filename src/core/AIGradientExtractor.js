/**
 * AIGradientExtractor
 * ----------------
 * 从 AI 私有数据的 `%AI5_BeginGradient` 块中提取一个**近似** RGB 颜色，
 * 仅用于阶段 4 的部分预览。
 *
 * 真实 AI 渐变结构的完整语义尚未确认；本模块：
 * - 按块读取 7 个数字一组的候选颜色（前 4 个疑似 CMYK，后 3 个疑似 RGB）
 * - 取后 3 个 0..1 分量作为 RGB
 * - 对多个停靠点求平均，得到近似色
 *
 * 结果必须标记为 approximate；不得宣称完整渐变还原。
 */

import { decodeMaybeUtf8 } from '../utils/encoding.js'

const BLOCK_PATTERN = /%AI5_BeginGradient:\s*\(([^()\r\n]{1,160})\)([\s\S]*?)%AI5_EndGradient/g
const SEVEN_NUMBER_GROUP = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1)
}

/**
 * @param {string} text 完整私有数据文本
 * @returns {Map<string, { name: string, approxColor: number[], stopCount: number, source: string, note: string }>}
 */
export function extractGradientDefinitions(text) {
  const definitions = new Map()
  if (typeof text !== 'string' || text.length === 0) return definitions

  BLOCK_PATTERN.lastIndex = 0
  let block
  while ((block = BLOCK_PATTERN.exec(text)) !== null) {
    const name = decodeMaybeUtf8(block[1].trim())
    const body = block[2]
    const colors = []

    SEVEN_NUMBER_GROUP.lastIndex = 0
    let match
    while ((match = SEVEN_NUMBER_GROUP.exec(body)) !== null) {
      const values = match.slice(1, 8).map(Number)
      if (!values.every(Number.isFinite)) continue
      const rgb = values.slice(4, 7)
      if (!rgb.every((value) => value >= -0.001 && value <= 1.001)) continue
      colors.push(rgb.map(clamp01))
      if (colors.length >= 16) break
    }

    if (colors.length === 0) continue
    const avg = [0, 1, 2].map(
      (channel) => colors.reduce((sum, color) => sum + color[channel], 0) / colors.length,
    )

    definitions.set(name, {
      name,
      approxColor: avg,
      stopCount: colors.length,
      source: 'heuristic-7-component',
      note: '从 7 分量颜色组启发式提取的近似 RGB，不代表完整渐变定义',
    })
  }

  return definitions
}
