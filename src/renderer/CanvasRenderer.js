/**
 * CanvasRenderer
 * ----------------
 * 原生 Canvas 2D 渲染器。只消费 Scene Graph，不包含任何解析逻辑。
 *
 * 阶段 4 限制：
 * - 渐变/专色使用近似纯色，明确标记 approximate
 * - 嵌入图片、裁剪、透明度组、可编辑文字未渲染
 * - 复合路径通过 combined Path2D 绘制
 */

import { resolvePaintColor, rgbToCss } from '../engine/ColorEngine.js'
import { IDENTITY_MATRIX } from '../engine/TransformEngine.js'
import {
  buildPath2D,
  buildCompoundPath2D,
  computePathBounds,
  computeShapesBounds,
} from './PathRenderer.js'

const LINE_CAPS = ['butt', 'round', 'square']
const LINE_JOINS = ['miter', 'round', 'bevel']

export function computeViewport({
  width,
  height,
  artboard,
  zoom = 1,
  panX = 0,
  panY = 0,
  padding = 32,
}) {
  const safeWidth = Math.max(1, artboard?.width ?? 1)
  const safeHeight = Math.max(1, artboard?.height ?? 1)
  const availableWidth = Math.max(1, width - padding * 2)
  const availableHeight = Math.max(1, height - padding * 2)
  const fitScale = Math.min(availableWidth / safeWidth, availableHeight / safeHeight)
  const scale = Math.max(fitScale * zoom, 1e-6)
  const originX = (width - safeWidth * scale) / 2 + panX
  const originY = (height - safeHeight * scale) / 2 + panY
  return { scale, originX, originY, width, height }
}

export function worldToScreen(viewport, artboard, x, y) {
  return {
    x: viewport.originX + (x - artboard.x) * viewport.scale,
    y: viewport.originY + (artboard.y + artboard.height - y) * viewport.scale,
  }
}

export function screenToWorld(viewport, artboard, x, y) {
  return {
    x: artboard.x + (x - viewport.originX) / viewport.scale,
    y: artboard.y + artboard.height - (y - viewport.originY) / viewport.scale,
  }
}

export function createGradientFill(context, paint, bounds) {
  if (!paint?.stops?.length || !bounds) return null
  if (typeof context.createLinearGradient !== 'function') return null
  const { x, y, width, height } = bounds
  if (!(width > 0) || !(height > 0)) return null

  const centerX = x + width / 2
  const centerY = y + height / 2
  const angle = ((paint.angle ?? 90) * Math.PI) / 180
  const radius = Math.max(width, height) / 2
  const dx = Math.cos(angle) * radius
  const dy = Math.sin(angle) * radius

  const gradient = context.createLinearGradient(
    centerX - dx,
    centerY - dy,
    centerX + dx,
    centerY + dy,
  )

  const stops = [...paint.stops].sort((a, b) => a.offset - b.offset)
  for (const stop of stops) {
    gradient.addColorStop(Math.min(Math.max(stop.offset, 0), 1), rgbToCss(stop.rgb))
  }
  return gradient
}

export class CanvasRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ Path2D?: typeof Path2D, padding?: number, background?: string }} [options]
   */
  constructor(canvas, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new Error('CanvasRenderer 需要一个 canvas 元素')
    }
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法获取 Canvas 2D 上下文')

    this.canvas = canvas
    this.ctx = context
    this.Path2DImpl = options.Path2D ?? globalThis.Path2D
    this.padding = options.padding ?? 32
    this.background = options.background ?? '#ffffff'
    this.document = null
    this.artboardIndex = 0
    this.zoom = 1
    this.panX = 0
    this.panY = 0
    this.lastViewport = null
    this.stats = {
      shapesDrawn: 0,
      shapesSkipped: 0,
      approximateShapes: 0,
      compoundGroups: 0,
      clipMaskGroups: 0,
      groupsVisited: 0,
    }
  }

  setDocument(document) {
    this.document = document
    this.artboardIndex = 0
    this.zoom = 1
    this.panX = 0
    this.panY = 0
    this.render()
  }

  get artboard() {
    return this.document?.artboards?.[this.artboardIndex] ?? null
  }

  setArtboard(index) {
    if (!this.document?.artboards) return
    this.artboardIndex = Math.min(Math.max(0, index), this.document.artboards.length - 1)
    this.zoom = 1
    this.panX = 0
    this.panY = 0
    this.render()
  }

  resize() {
    this.render()
  }

  fit() {
    this.zoom = 1
    this.panX = 0
    this.panY = 0
    this.render()
  }

  actualSize() {
    const viewport = this.getViewport()
    const fitScale = viewport.scale / this.zoom
    if (fitScale > 0) {
      this.zoom = Math.min(Math.max(1 / fitScale, 0.02), 64)
      this.panX = 0
      this.panY = 0
      this.render()
    }
  }

  getScalePercent() {
    const viewport = this.getViewport()
    return Math.round(viewport.scale * 100)
  }

  setZoom(zoom) {
    this.zoom = Math.min(Math.max(zoom, 0.02), 64)
    this.render()
  }

  zoomAt(factor, screenX, screenY) {
    const artboard = this.artboard
    if (!artboard) return
    const before = this.getViewport()
    const world = screenToWorld(before, artboard, screenX, screenY)
    const nextZoom = Math.min(Math.max(this.zoom * factor, 0.02), 64)
    this.zoom = nextZoom
    const after = this.getViewport()
    const screen = worldToScreen(after, artboard, world.x, world.y)
    this.panX += screenX - screen.x
    this.panY += screenY - screen.y
    this.render()
  }

  panBy(dx, dy) {
    this.panX += dx
    this.panY += dy
    this.render()
  }

  getViewport(width, height) {
    const artboard = this.artboard
    const cssWidth = width ?? this.canvas.clientWidth ?? this.canvas.width ?? 800
    const cssHeight = height ?? this.canvas.clientHeight ?? this.canvas.height ?? 600
    return computeViewport({
      width: cssWidth,
      height: cssHeight,
      artboard: artboard?.rect ?? { x: 0, y: 0, width: 1, height: 1 },
      zoom: this.zoom,
      panX: this.panX,
      panY: this.panY,
      padding: this.padding,
    })
  }

  render() {
    const ctx = this.ctx
    const artboard = this.artboard
    if (!artboard) return

    const cssWidth = this.canvas.clientWidth || this.canvas.width || 800
    const cssHeight = this.canvas.clientHeight || this.canvas.height || 600
    const dpr = Math.min(Math.max(globalThis.devicePixelRatio || 1, 1), 3)

    if (this.canvas.width !== Math.round(cssWidth * dpr)) {
      this.canvas.width = Math.round(cssWidth * dpr)
    }
    if (this.canvas.height !== Math.round(cssHeight * dpr)) {
      this.canvas.height = Math.round(cssHeight * dpr)
    }

    this.stats = {
      shapesDrawn: 0,
      shapesSkipped: 0,
      approximateShapes: 0,
      compoundGroups: 0,
      clipMaskGroups: 0,
      groupsVisited: 0,
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    const viewport = this.getViewport(cssWidth, cssHeight)
    this.lastViewport = viewport
    const rect = artboard.rect

    const topLeft = worldToScreen(viewport, rect, rect.x, rect.y + rect.height)
    const artboardWidth = rect.width * viewport.scale
    const artboardHeight = rect.height * viewport.scale

    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
    ctx.shadowBlur = 24
    ctx.shadowOffsetY = 8
    ctx.fillStyle = this.background
    ctx.fillRect(topLeft.x, topLeft.y, artboardWidth, artboardHeight)
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.rect(topLeft.x, topLeft.y, artboardWidth, artboardHeight)
    ctx.clip()

    ctx.translate(viewport.originX, viewport.originY)
    ctx.scale(viewport.scale, -viewport.scale)
    ctx.translate(-rect.x, -(rect.y + rect.height))

    for (const child of artboard.children ?? []) {
      this.drawNode(child, 1)
    }

    ctx.restore()

    ctx.save()
    ctx.strokeStyle = 'rgba(125, 155, 220, 0.35)'
    ctx.lineWidth = 1
    ctx.strokeRect(topLeft.x + 0.5, topLeft.y + 0.5, artboardWidth, artboardHeight)
    ctx.restore()
  }

  drawNode(node, opacity) {
    if (!node || node.visible === false) return
    if (node.type === 'shape') {
      this.drawShape(node, opacity)
      return
    }
    if (node.type !== 'group') return

    this.stats.groupsVisited += 1
    const nextOpacity = opacity * (node.opacity ?? 1)
    this.ctx.save()
    this.ctx.transform(...(node.transform ?? IDENTITY_MATRIX))
    if (node.role === 'compound') {
      this.stats.compoundGroups += 1
      this.drawCompound(node, nextOpacity)
    } else {
      for (const child of node.children ?? []) this.drawNode(child, nextOpacity)
    }
    this.ctx.restore()
  }

  drawCompound(group, opacity) {
    const shapes = (group.children ?? []).filter(
      (child) => child.type === 'shape' && !child.nonPrinting,
    )
    const hasNested = (group.children ?? []).some((child) => child.type !== 'shape')

    if (hasNested || shapes.length === 0) {
      for (const child of group.children ?? []) this.drawNode(child, opacity)
      return
    }

    const first = shapes[0]
    const gradientChild = shapes
      .slice(1)
      .find((shape) => shape.fill?.type === 'gradient' && shape.fill?.stops?.length > 0)
    const isClipMask =
      gradientChild &&
      first.fill?.type === 'gray' &&
      (first.fill.values?.[0] ?? 1) <= 0.05

    if (isClipMask) {
      // AI 复合组中“黑色外轮廓 + 渐变内容”常见于剪裁蒙版：
      // 外轮廓只作为 clip，不绘制黑色填充；内孔路径必须一起参与复合路径，
      // 否则 R 的上半部分会被渐变填满，丢失镂空。
      const clipPath = buildCompoundPath2D(
        [first, gradientChild],
        IDENTITY_MATRIX,
        this.Path2DImpl,
      )
      const gradient = createGradientFill(
        this.ctx,
        gradientChild.fill,
        computePathBounds(first.subpaths, first.transform ?? IDENTITY_MATRIX),
      )
      if (clipPath) {
        this.ctx.globalAlpha = opacity
        const fill = resolvePaintColor(gradientChild.fill)
        if (gradient) {
          this.ctx.fillStyle = gradient
          this.ctx.fill(clipPath, 'evenodd')
        } else if (fill.css) {
          this.ctx.fillStyle = fill.css
          this.ctx.fill(clipPath, 'evenodd')
        }
        this.ctx.globalAlpha = 1
        this.stats.shapesDrawn += 1
        this.stats.approximateShapes += 1
        this.stats.clipMaskGroups += 1
        return
      }
    }

    const path = buildCompoundPath2D(shapes, IDENTITY_MATRIX, this.Path2DImpl)
    if (!path) {
      this.stats.shapesSkipped += shapes.length
      return
    }

    const fill = resolvePaintColor(first.fill)
    const stroke = resolvePaintColor(first.stroke)
    const gradient =
      first.fill?.type === 'gradient'
        ? createGradientFill(this.ctx, first.fill, computeShapesBounds(shapes))
        : null
    const fillRule = shapes.some((shape) => shape.fillRule === 'evenodd') ? 'evenodd' : 'nonzero'
    const paintMismatch =
      shapes.length > 1 &&
      shapes.some(
        (shape) =>
          JSON.stringify(shape.fill) !== JSON.stringify(first.fill) ||
          JSON.stringify(shape.stroke) !== JSON.stringify(first.stroke),
      )

    if (paintMismatch) {
      // 不同填充/描边的复合组不能安全合并，逐个绘制以保留各自样式
      for (const child of group.children ?? []) this.drawNode(child, opacity)
      return
    }

    this.ctx.globalAlpha = opacity
    if (gradient) {
      this.ctx.fillStyle = gradient
      this.ctx.fill(path, fillRule)
    } else if (fill.css) {
      this.ctx.fillStyle = fill.css
      this.ctx.fill(path, fillRule)
    }
    if (stroke.css) {
      this.applyStrokeStyle(first, stroke)
      this.ctx.stroke(path)
    }
    this.ctx.globalAlpha = 1
    this.stats.shapesDrawn += shapes.length
    if (fill.approximate || stroke.approximate) {
      this.stats.approximateShapes += shapes.length
    }
  }

  drawShape(shape, opacity) {
    if (shape.nonPrinting) {
      this.stats.shapesSkipped += 1
      return
    }
    const path = buildPath2D(shape.subpaths, IDENTITY_MATRIX, this.Path2DImpl)
    if (!path) return

    const fill = resolvePaintColor(shape.fill)
    const stroke = resolvePaintColor(shape.stroke)
    const fillRule = shape.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'
    const gradient =
      shape.fill?.type === 'gradient' && !shape.nonPrinting
        ? createGradientFill(this.ctx, shape.fill, computePathBounds(shape.subpaths))
        : null

    this.ctx.save()
    this.ctx.transform(...(shape.transform ?? IDENTITY_MATRIX))
    this.ctx.globalAlpha = opacity

    if (gradient) {
      this.ctx.fillStyle = gradient
      this.ctx.fill(path, fillRule)
    } else if (fill.css) {
      this.ctx.fillStyle = fill.css
      this.ctx.fill(path, fillRule)
    }
    if (stroke.css) {
      this.applyStrokeStyle(shape, stroke)
      this.ctx.stroke(path)
    }

    this.ctx.restore()
    this.stats.shapesDrawn += 1
    if (fill.approximate || stroke.approximate) this.stats.approximateShapes += 1
  }

  applyStrokeStyle(shape, stroke) {
    this.ctx.strokeStyle = stroke.css
    this.ctx.lineWidth = Math.max(0, shape.strokeWidth ?? 1)
    this.ctx.lineCap = LINE_CAPS[shape.lineCap] ?? 'butt'
    this.ctx.lineJoin = LINE_JOINS[shape.lineJoin] ?? 'miter'
    this.ctx.miterLimit = Math.max(1, shape.miterLimit ?? 10)
    this.ctx.setLineDash(Array.isArray(shape.dashArray) ? shape.dashArray : [])
    this.ctx.lineDashOffset = shape.dashOffset ?? 0
  }

  destroy() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.document = null
  }
}
