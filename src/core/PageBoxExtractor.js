/**
 * PageBoxExtractor
 * ----------------
 * 从 EPS / PostScript / PDF 文本中提取页面边界提示：
 * - `%%BoundingBox` / `%%HiResBoundingBox` / `%%PageBoundingBox`
 * - `/MediaBox [x0 y0 x1 y1]` / `/CropBox [...]`
 *
 * 这些是“边界提示”，不等于 Illustrator 原生画板数据。
 * 真实 AI 画板信息必须通过私有数据解析确认（待真实样本）。
 */

const PATTERNS = [
  {
    kind: 'bounding-box',
    regex: /%%BoundingBox:\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/g,
  },
  {
    kind: 'hi-res-bounding-box',
    regex: /%%HiResBoundingBox:\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/g,
  },
  {
    kind: 'page-bounding-box',
    regex: /%%PageBoundingBox:\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/g,
  },
  {
    kind: 'media-box',
    regex: /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/g,
  },
  {
    kind: 'crop-box',
    regex: /\/CropBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/g,
  },
  {
    kind: 'art-box',
    regex: /\/ArtBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/g,
  },
  {
    kind: 'trim-box',
    regex: /\/TrimBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/g,
  },
]

/**
 * @param {string} text
 * @param {{ offsetBase?: number, limit?: number }} [options]
 * @returns {Array<{ kind: string, values: number[], offset: number, raw: string }>}
 */
export function extractPageBoxes(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) return []
  const offsetBase = options.offsetBase ?? 0
  const limit = options.limit ?? 32
  const results = []
  const seen = new Set()

  for (const { kind, regex } of PATTERNS) {
    regex.lastIndex = 0
    let match
    while ((match = regex.exec(text)) !== null && results.length < limit) {
      const values = match.slice(1, 5).map(Number)
      if (!values.every(Number.isFinite)) continue
      const key = `${kind}:${values.join(',')}`
      if (seen.has(key)) continue
      seen.add(key)
      results.push({
        kind,
        values,
        offset: offsetBase + match.index,
        raw: match[0],
      })
    }
  }

  return results
}

/**
 * 将边界提示转换为画板候选。
 * PDF 优先 MediaBox / CropBox；EPS / PostScript 优先 BoundingBox。
 * @param {Array<{ kind: string, values: number[], offset?: number }>} hints
 * @param {{ container?: string }} [options]
 */
export function pageBoxesToArtboards(hints, options = {}) {
  if (!Array.isArray(hints)) return []
  const artboards = []
  const seen = new Set()

  const preferred =
    options.container === 'pdf'
      ? ['media-box', 'crop-box']
      : ['bounding-box', 'hi-res-bounding-box', 'page-bounding-box']
  const primary = hints.filter((hint) => preferred.includes(hint.kind))
  const candidates = primary.length > 0 ? primary : hints

  for (const hint of candidates.slice(0, 24)) {
    const [x1, y1, x2, y2] = hint.values ?? []
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue

    const x = Math.min(x1, x2)
    const y = Math.min(y1, y2)
    const width = Math.abs(x2 - x1)
    const height = Math.abs(y2 - y1)
    if (width <= 0 || height <= 0 || width > 1e7 || height > 1e7) continue

    const key = `${x},${y},${width},${height}`
    if (seen.has(key)) continue
    seen.add(key)

    const fromBoundingBox = hint.kind !== 'media-box' && hint.kind !== 'crop-box'
    artboards.push({
      id: `artboard-hint-${artboards.length + 1}`,
      name: `Artboard ${artboards.length + 1}（边界推断）`,
      rect: { x, y, width, height },
      unit: 'pt',
      source: hint.kind,
      confidence: fromBoundingBox ? 'medium' : 'low',
      note: fromBoundingBox
        ? '来自 PostScript/EPS 边界标记，非 Illustrator 原生画板数据'
        : '来自 PDF 页面边界，可能不等于 Illustrator 画板',
    })

    if (artboards.length >= 24) break
  }

  return artboards
}

/**
 * 页面内容边界（BoundingBox / HiResBoundingBox），用于提示图形实际范围。
 * 它不是画板，不能替代 ArtboardArray。
 */
export function pageBoxesToContentBounds(hints) {
  if (!Array.isArray(hints)) return []
  const results = []
  const seen = new Set()

  for (const hint of hints) {
    if (
      ![
        'bounding-box',
        'hi-res-bounding-box',
        'page-bounding-box',
        'art-box',
      ].includes(hint.kind)
    ) {
      continue
    }
    const [x1, y1, x2, y2] = hint.values ?? []
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue
    const x = Math.min(x1, x2)
    const y = Math.min(y1, y2)
    const width = Math.abs(x2 - x1)
    const height = Math.abs(y2 - y1)
    if (width <= 0 || height <= 0) continue
    const key = `${x},${y},${width},${height}`
    if (seen.has(key)) continue
    seen.add(key)
    results.push({
      kind: hint.kind,
      rect: { x, y, width, height },
      note: 'PostScript/EPS 边界标记，表示内容范围，不等同于画板',
    })
  }

  return results
}
