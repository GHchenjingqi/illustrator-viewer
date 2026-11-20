/**
 * SceneBuilder
 * ----------------
 * 将阶段 2 的扁平矢量对象与解析事件转换为层级 Scene Graph。
 *
 * 结构：
 *   Document
 *     └─ Artboard[]
 *          └─ Layer / Group / CompoundGroup
 *               └─ Shape
 *
 * 说明：
 * - 矢量对象的 CTM 是绘制时的绝对变换；这里用逆矩阵计算相对于父组的变换，
 *   避免渲染时重复变换。
 * - 渐变/专色没有完整颜色数据，使用近似色并标记 approximate，渲染器必须提示。
 * - 多画板时暂不重建跨画板层级，使用扁平图层并标记。
 */

import { IDENTITY_MATRIX, invertMatrix, multiplyMatrix } from '../engine/TransformEngine.js'

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1)
}

export function cmykToRgb(values) {
  const [c = 0, m = 0, y = 0, k = 0] = values.map(clamp01)
  return [
    (1 - c) * (1 - k),
    (1 - m) * (1 - k),
    (1 - y) * (1 - k),
  ]
}

function paintApproxColor(paint) {
  if (!paint) return null
  if (paint.type === 'gray') return [clamp01(paint.values[0] ?? 0), clamp01(paint.values[0] ?? 0), clamp01(paint.values[0] ?? 0)]
  if (paint.type === 'rgb') return paint.values.slice(0, 3).map(clamp01)
  if (paint.type === 'cmyk') return cmykToRgb(paint.values)
  if (paint.type === 'custom') {
    const values = paint.values ?? []
    if (values.length >= 7) return values.slice(4, 7).map(clamp01)
    if (values.length === 4) return cmykToRgb(values)
    if (values.length === 3) return values.map(clamp01)
    if (values.length === 1) return [clamp01(values[0]), clamp01(values[0]), clamp01(values[0])]
  }
  return null
}

function resolvePaint(paint, gradients) {
  if (!paint || paint.type === 'none') return { type: 'none' }
  if (paint.type === 'gray' || paint.type === 'rgb' || paint.type === 'cmyk') {
    return {
      ...paint,
      approximate: false,
      approxColor: paintApproxColor(paint),
    }
  }
  if (paint.type === 'custom') {
    return {
      ...paint,
      approximate: true,
      approxColor: paintApproxColor(paint) ?? [0.5, 0.5, 0.5],
      note: '自定义/专色分量未完全确认，使用近似 RGB 预览',
    }
  }
  if (paint.type === 'gradient') {
    const definition = paint.name ? gradients.get(paint.name) : null
    return {
      ...paint,
      approximate: true,
      approxColor: definition?.approxColor ?? [0.5, 0.5, 0.5],
      stops: definition?.stops ?? [],
      angle: paint.angle ?? 90,
      gradientDefinition: definition ?? null,
      note: '渐变停靠点已解析，渐变几何仍为近似；渲染时明确标记',
    }
  }
  return { ...paint, approximate: true, approxColor: [0.5, 0.5, 0.5] }
}

function relativeTransform(absolute, parentAbsolute) {
  if (!Array.isArray(absolute)) return [...IDENTITY_MATRIX]
  if (!Array.isArray(parentAbsolute)) return [...absolute]
  return multiplyMatrix(absolute, invertMatrix(parentAbsolute))
}

function createShape(vector, parentAbsolute, gradients, visibilityBounds) {
  if (visibilityBounds && vector.bounds) {
    const b = vector.bounds
    const v = visibilityBounds
    const intersects =
      b.x + b.width >= v.x &&
      b.x <= v.x + v.width &&
      b.y + b.height >= v.y &&
      b.y <= v.y + v.height
    if (!intersects) return null
  }
  return {
    type: 'shape',
    id: vector.id,
    shapeType: vector.type,
    subpaths: vector.subpaths,
    fill: resolvePaint(vector.fill, gradients),
    stroke: resolvePaint(vector.stroke, gradients),
    fillRule: vector.fillRule ?? 'nonzero',
    strokeWidth: vector.strokeWidth,
    lineCap: vector.lineCap,
    lineJoin: vector.lineJoin,
    miterLimit: vector.miterLimit,
    dashArray: vector.dashArray,
    dashOffset: vector.dashOffset,
    transform: relativeTransform(vector.transform, parentAbsolute),
    absoluteTransform: [...(vector.transform ?? IDENTITY_MATRIX)],
    bounds: vector.bounds,
    boundsApproximate: vector.boundsApproximate,
    nonPrinting: Boolean(vector.nonPrinting),
    compound: Boolean(vector.compound),
    sourceOffset: vector.sourceOffset ?? null,
    support: 'PARTIAL',
  }
}

function createGroup(role, name, absolute, parentAbsolute) {
  return {
    type: 'group',
    role,
    name: name ?? null,
    transform: relativeTransform(absolute ?? IDENTITY_MATRIX, parentAbsolute),
    opacity: 1,
    visible: true,
    children: [],
  }
}

function closeRole(stack, role) {
  for (let index = stack.length - 1; index >= 1; index -= 1) {
    if (stack[index].node.role === role) {
      stack.length = index
      return
    }
  }
}

function buildEventTree(artboard, vectors, events, gradients, visibilityBounds) {
  const rootNode = {
    type: 'group',
    role: 'layer',
    name: artboard.name ?? 'Layer 1',
    transform: [...IDENTITY_MATRIX],
    opacity: 1,
    visible: true,
    children: [],
  }
  const stack = [{ node: rootNode, absolute: IDENTITY_MATRIX }]
  let cursor = 0

  const appendVectors = (until) => {
    while (cursor < until && cursor < vectors.length) {
      const vector = vectors[cursor]
      cursor += 1
      if (!vector) continue
      const parent = stack[stack.length - 1]
      const shape = createShape(vector, parent.absolute, gradients, visibilityBounds)
      if (shape) parent.node.children.push(shape)
    }
  }

  for (const event of events) {
    appendVectors(Math.min(event.vectorIndex, vectors.length))

    if (event.type === 'layer-begin') {
      const group = createGroup('layer', event.name, event.transform, stack[stack.length - 1].absolute)
      stack[stack.length - 1].node.children.push(group)
      stack.push({ node: group, absolute: event.transform ?? IDENTITY_MATRIX })
    } else if (event.type === 'layer-end') {
      closeRole(stack, 'layer')
    } else if (event.type === 'group-begin') {
      const group = createGroup('group', event.name, event.transform, stack[stack.length - 1].absolute)
      stack[stack.length - 1].node.children.push(group)
      stack.push({ node: group, absolute: event.transform ?? IDENTITY_MATRIX })
    } else if (event.type === 'group-end') {
      closeRole(stack, 'group')
    } else if (event.type === 'compound-begin') {
      const group = createGroup('compound', event.name, event.transform, stack[stack.length - 1].absolute)
      stack[stack.length - 1].node.children.push(group)
      stack.push({ node: group, absolute: event.transform ?? IDENTITY_MATRIX })
    } else if (event.type === 'compound-end') {
      closeRole(stack, 'compound')
    }
  }

  appendVectors(vectors.length)
  return rootNode
}

function buildFlatTree(artboard, vectors, gradients, visibilityBounds) {
  const root = createGroup('layer', artboard.name ?? 'Layer 1', IDENTITY_MATRIX, IDENTITY_MATRIX)
  for (const vector of vectors) {
    const shape = createShape(vector, IDENTITY_MATRIX, gradients, visibilityBounds)
    if (shape) root.children.push(shape)
  }
  return root
}

function containsPoint(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
}

function vectorArtboardIndex(vector, artboards) {
  const bounds = vector.bounds
  if (!bounds) return 0
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  for (let index = 0; index < artboards.length; index += 1) {
    if (containsPoint(artboards[index].rect, x, y)) return index
  }
  return 0
}

function computeVectorUnion(vectors) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const vector of vectors) {
    if (!vector.bounds) continue
    minX = Math.min(minX, vector.bounds.x)
    minY = Math.min(minY, vector.bounds.y)
    maxX = Math.max(maxX, vector.bounds.x + vector.bounds.width)
    maxY = Math.max(maxY, vector.bounds.y + vector.bounds.height)
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) {
    return { x: 0, y: 0, width: 1000, height: 1000 }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * @param {object} report AIParserEngine 报告
 * @param {{ gradients?: Map<string, object> }} [options]
 */
export function buildScene(report, options = {}) {
  const gradients = options.gradients ?? new Map()
  const visibilityBounds = options.visibilityBounds ?? null
  const graphics = report.graphics ?? {}
  const vectors = Array.isArray(graphics.vectors) ? graphics.vectors : []
  const events = Array.isArray(graphics.sceneEvents) ? graphics.sceneEvents : []

  let artboardDefs = Array.isArray(graphics.artboards) ? graphics.artboards : []
  if (artboardDefs.length === 0) {
    artboardDefs = [
      {
        id: 'artboard-1',
        name: 'Artboard 1（内容推断）',
        rect: computeVectorUnion(vectors),
        source: 'vector-bounds',
        confidence: 'low',
      },
    ]
  }

  const assigned = artboardDefs.map(() => [])
  for (const vector of vectors) {
    const index = vectorArtboardIndex(vector, artboardDefs)
    assigned[index]?.push(vector)
  }

  const useEvents = artboardDefs.length === 1 && events.length > 0
  let approximateFillCount = 0

  const artboards = artboardDefs.map((definition, index) => {
    const artboardVectors = assigned[index]
    const tree = useEvents
      ? buildEventTree(definition, artboardVectors, events, gradients, visibilityBounds)
      : buildFlatTree(definition, artboardVectors, gradients, visibilityBounds)

    const countApprox = (node) => {
      if (node.type === 'shape') {
        if (node.fill?.approximate) approximateFillCount += 1
      } else if (node.children) {
        node.children.forEach(countApprox)
      }
    }
    countApprox(tree)

    return {
      type: 'artboard',
      id: definition.id,
      name: definition.name,
      rect: definition.rect,
      width: definition.rect.width,
      height: definition.rect.height,
      source: definition.source,
      confidence: definition.confidence,
      background: null,
      children: [tree],
    }
  })

  const nodes = { layers: 0, groups: 0, compounds: 0, shapes: 0 }
  const count = (node) => {
    if (node.type === 'shape') nodes.shapes += 1
    if (node.type === 'group') {
      if (node.role === 'layer') nodes.layers += 1
      else if (node.role === 'compound') nodes.compounds += 1
      else nodes.groups += 1
    }
    if (node.children) node.children.forEach(count)
  }
  artboards.forEach((artboard) => artboard.children.forEach(count))

  return {
    schemaVersion: 1,
    type: 'document',
    fileName: report.file?.name ?? null,
    fileSize: report.file?.size ?? null,
    version: {
      aiFormat: report.detection?.aiFormatVersion ?? null,
      creator: report.detection?.creator ?? null,
      application: report.detection?.applicationVersion ?? null,
      container: report.detection?.container ?? null,
    },
    artboards,
    approximateFillCount,
    hierarchy: useEvents ? 'events' : 'flat',
    stats: {
      ...nodes,
      artboards: artboards.length,
      vectors: vectors.length,
      visibleVectors: nodes.shapes,
      filteredOutVectors: Math.max(0, vectors.length - nodes.shapes),
    },
    compatibility: report.compatibility ?? null,
    diagnostics: report.diagnostics ?? [],
    unsupportedFeatures: graphics.unsupportedFeatures ?? [],
  }
}
