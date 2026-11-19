/**
 * ColorEngine
 * ----------------
 * 渲染前的颜色解析。
 * - RGB / Gray / CMYK 为确定性转换
 * - 渐变 / 专色没有完整数据时使用 SceneBuilder 提供的近似色，并标记 approximate
 */

export function clamp01(value) {
  return Math.min(Math.max(value, 0), 1)
}

export function cmykToRgb(values) {
  const [c = 0, m = 0, y = 0, k = 0] = values.map(clamp01)
  return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]
}

export function rgbToCss(values) {
  const [r = 0, g = 0, b = 0] = values.map(clamp01)
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
}

/**
 * @param {object | null} paint
 * @returns {{ css: string | null, approximate: boolean }}
 */
export function resolvePaintColor(paint) {
  if (!paint || paint.type === 'none') return { css: null, approximate: false }
  switch (paint.type) {
    case 'gray':
      return { css: rgbToCss([paint.values?.[0] ?? 0, paint.values?.[0] ?? 0, paint.values?.[0] ?? 0]), approximate: false }
    case 'rgb':
      return { css: rgbToCss(paint.values ?? []), approximate: false }
    case 'cmyk':
      return { css: rgbToCss(cmykToRgb(paint.values ?? [])), approximate: false }
    case 'gradient':
    case 'custom':
      return {
        css: rgbToCss(paint.approxColor ?? [0.5, 0.5, 0.5]),
        approximate: true,
      }
    default:
      return { css: 'rgb(128, 128, 128)', approximate: true }
  }
}
