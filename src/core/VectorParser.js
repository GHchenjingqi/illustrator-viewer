/**
 * VectorParser
 * ----------------
 * 将解析器产生的基础绘图数据转换为统一的矢量对象。
 *
 * 阶段 2 只负责：
 * - 路径 / 线段 / 矩形的基本分类
 * - 填充、描边、线宽、端点、连接、虚线
 * - 保留 CTM 快照与局部坐标
 * - 计算（可能近似的）包围盒
 *
 * 不构建 Scene Graph，不接触 Canvas。
 */

import { transformPoint } from '../engine/TransformEngine.js'

const EPSILON = 1e-6

export function normalizePaint(paint) {
  if (!paint || paint.type === 'none') return { type: 'none' }
  if (paint.type === 'gradient') {
    return {
      type: 'gradient',
      name: paint.name ?? null,
      matrices: Array.isArray(paint.matrices) ? paint.matrices.map((matrix) => [...matrix]) : [],
    }
  }
  if (paint.type === 'custom') {
    return {
      type: 'custom',
      values: Array.isArray(paint.values) ? paint.values.filter(Number.isFinite) : [],
    }
  }
  if (!['gray', 'rgb', 'cmyk'].includes(paint.type)) {
    return paint.name ? { type: 'named', name: String(paint.name) } : { type: 'unknown' }
  }
  const expected = { gray: 1, rgb: 3, cmyk: 4 }[paint.type]
  const values = Array.isArray(paint.values) ? paint.values.slice(0, expected) : []
  if (values.length !== expected || !values.every(Number.isFinite)) {
    return { type: 'unknown', reason: '颜色分量数量或类型不合法' }
  }
  return { type: paint.type, values }
}

function cloneSegment(segment) {
  if (segment.type === 'C') {
    return {
      type: 'C',
      x1: segment.x1,
      y1: segment.y1,
      x2: segment.x2,
      y2: segment.y2,
      x: segment.x,
      y: segment.y,
    }
  }
  return { type: segment.type, x: segment.x, y: segment.y }
}

function cloneSubpath(subpath) {
  return {
    closed: Boolean(subpath.closed),
    segments: subpath.segments.map(cloneSegment),
  }
}

/**
 * 基于控制点计算包围盒（三次曲线的真实极值可能更小）。
 * 返回的 boundsApproximate 会标记这一点。
 */
export function computeBounds(subpaths, transform) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let hasCurve = false
  let pointCount = 0

  const visit = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const point = transformPoint(transform, x, y)
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
    pointCount += 1
  }

  for (const subpath of subpaths) {
    for (const segment of subpath.segments) {
      if (segment.type === 'C') {
        hasCurve = true
        visit(segment.x1, segment.y1)
        visit(segment.x2, segment.y2)
      }
      visit(segment.x, segment.y)
    }
  }

  if (pointCount === 0) return null

  return {
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
    approximate: hasCurve,
  }
}

function isAxisAlignedRectangle(points) {
  if (points.length !== 4) return false
  for (let index = 0; index < 4; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % 4]
    const horizontal = Math.abs(current.y - next.y) <= EPSILON
    const vertical = Math.abs(current.x - next.x) <= EPSILON
    if (!horizontal && !vertical) return false
  }
  return true
}

function classifyPath(subpaths) {
  if (subpaths.length !== 1) return { type: 'path' }
  const [subpath] = subpaths
  const segments = subpath.segments
  if (segments.length === 0) return { type: 'path' }

  const hasCurve = segments.some((segment) => segment.type === 'C')
  const lines = segments.filter((segment) => segment.type === 'L')

  if (!hasCurve && !subpath.closed && segments[0].type === 'M' && lines.length === 1) {
    return { type: 'line' }
  }

  if (!hasCurve && subpath.closed && segments[0].type === 'M' && lines.length === 3) {
    const points = [segments[0], ...lines]
    if (isAxisAlignedRectangle(points)) {
      const xs = points.map((point) => point.x)
      const ys = points.map((point) => point.y)
      return {
        type: 'rect',
        rect: {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        },
      }
    }
  }

  return { type: 'path' }
}

export class VectorBuilder {
  /**
   * @param {{ maxObjects?: number }} [options]
   */
  constructor(options = {}) {
    this.maxObjects = options.maxObjects ?? 50000
    this.objects = []
    this.truncated = false
    this.sequence = 0
  }

  /**
   * @param {{
   *   subpaths: Array<{ closed: boolean, segments: object[] }>,
   *   fill?: object | null,
   *   stroke?: object | null,
   *   fillRule?: string | null,
   *   transform?: number[],
   *   strokeWidth?: number,
   *   lineCap?: number,
   *   lineJoin?: number,
   *   miterLimit?: number,
   *   dashArray?: number[],
   *   dashOffset?: number,
   * }} input
   */
  addPath(input) {
    if (!input || !Array.isArray(input.subpaths) || input.subpaths.length === 0) return null
    if (this.objects.length >= this.maxObjects) {
      this.truncated = true
      return null
    }

    const subpaths = input.subpaths
      .map(cloneSubpath)
      .filter((subpath) => subpath.segments.length > 0)
    if (subpaths.length === 0) return null

    const transform = input.transform?.slice(0, 6) ?? [1, 0, 0, 1, 0, 0]
    const classification = classifyPath(subpaths)
    const boundsResult = computeBounds(subpaths, transform)
    const fill = normalizePaint(input.fill)
    const stroke = normalizePaint(input.stroke)

    if (fill.type === 'none' && stroke.type === 'none') {
      // 没有填充也没有描边时不产生可见对象，但保留诊断由调用方处理
      return null
    }

    const object = {
      id: `vector-${++this.sequence}`,
      type: classification.type,
      ...(classification.rect ? { rect: classification.rect } : {}),
      subpaths,
      fill,
      stroke,
      fillRule: input.fillRule ?? null,
      strokeWidth: Number.isFinite(input.strokeWidth) ? input.strokeWidth : 1,
      lineCap: Number.isInteger(input.lineCap) ? input.lineCap : 0,
      lineJoin: Number.isInteger(input.lineJoin) ? input.lineJoin : 0,
      miterLimit: Number.isFinite(input.miterLimit) ? input.miterLimit : 10,
      dashArray: Array.isArray(input.dashArray) ? input.dashArray.filter(Number.isFinite) : [],
      dashOffset: Number.isFinite(input.dashOffset) ? input.dashOffset : 0,
      transform,
      bounds: boundsResult?.bounds ?? null,
      boundsApproximate: boundsResult?.approximate ?? false,
      nonPrinting: Boolean(input.nonPrinting),
      compound: Boolean(input.compound),
      groupDepth: Number.isInteger(input.groupDepth) ? input.groupDepth : 0,
      support: 'PARTIAL',
    }

    this.objects.push(object)
    return object
  }
}
