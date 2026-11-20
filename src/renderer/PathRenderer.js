/**
 * PathRenderer
 * ----------------
 * 将 Scene Graph 的子路径转换为 Path2D，不直接操作 Canvas。
 */

import { IDENTITY_MATRIX, transformPoint } from '../engine/TransformEngine.js'

function visitBounds(points, matrix, state) {
  for (const segment of points) {
    if (segment.type === 'C') {
      for (const point of [
        [segment.x1, segment.y1],
        [segment.x2, segment.y2],
      ]) {
        const transformed = transformPoint(matrix, point[0], point[1])
        state.minX = Math.min(state.minX, transformed.x)
        state.minY = Math.min(state.minY, transformed.y)
        state.maxX = Math.max(state.maxX, transformed.x)
        state.maxY = Math.max(state.maxY, transformed.y)
        state.count += 1
      }
    }
    const transformed = transformPoint(matrix, segment.x, segment.y)
    state.minX = Math.min(state.minX, transformed.x)
    state.minY = Math.min(state.minY, transformed.y)
    state.maxX = Math.max(state.maxX, transformed.x)
    state.maxY = Math.max(state.maxY, transformed.y)
    state.count += 1
  }
}

/**
 * 计算路径在指定矩阵下的包围盒（控制点近似）。
 * @param {Array<{ segments: object[] }>} subpaths
 * @param {number[]} [matrix]
 */
export function computePathBounds(subpaths, matrix = IDENTITY_MATRIX) {
  const state = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    count: 0,
  }
  for (const subpath of subpaths ?? []) visitBounds(subpath.segments ?? [], matrix, state)
  if (state.count === 0) return null
  return {
    x: state.minX,
    y: state.minY,
    width: state.maxX - state.minX,
    height: state.maxY - state.minY,
  }
}

/** 计算复合组内多个图形（含各自相对变换）的合并包围盒。 */
export function computeShapesBounds(shapes) {
  let result = null
  for (const shape of shapes ?? []) {
    const bounds = computePathBounds(shape.subpaths, shape.transform ?? IDENTITY_MATRIX)
    if (!bounds) continue
    if (!result) {
      result = { ...bounds }
    } else {
      const minX = Math.min(result.x, bounds.x)
      const minY = Math.min(result.y, bounds.y)
      const maxX = Math.max(result.x + result.width, bounds.x + bounds.width)
      const maxY = Math.max(result.y + result.height, bounds.y + bounds.height)
      result = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    }
  }
  return result
}

/**
 * @param {Array<{ closed: boolean, segments: object[] }>} subpaths
 * @param {number[]} [matrix]
 * @param {typeof Path2D} [Path2DImpl]
 */
export function buildPath2D(subpaths, matrix = IDENTITY_MATRIX, Path2DImpl = globalThis.Path2D) {
  if (typeof Path2DImpl !== 'function') return null
  const path = new Path2DImpl()
  if (!Array.isArray(subpaths)) return path

  for (const subpath of subpaths) {
    let started = false
    for (const segment of subpath.segments ?? []) {
      if (segment.type === 'M') {
        const point = transformPoint(matrix, segment.x, segment.y)
        path.moveTo(point.x, point.y)
        started = true
      } else if (segment.type === 'L') {
        if (!started) continue
        const point = transformPoint(matrix, segment.x, segment.y)
        path.lineTo(point.x, point.y)
      } else if (segment.type === 'C') {
        if (!started) continue
        const c1 = transformPoint(matrix, segment.x1, segment.y1)
        const c2 = transformPoint(matrix, segment.x2, segment.y2)
        const end = transformPoint(matrix, segment.x, segment.y)
        path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y)
      }
    }
    if (subpath.closed) path.closePath()
  }

  return path
}

/**
 * 复合路径：把多个子图形的局部路径合并成一个 Path2D。
 * @param {Array<{ subpaths: object[], transform: number[] }>} shapes
 * @param {number[]} [parentMatrix]
 */
export function buildCompoundPath2D(shapes, parentMatrix = IDENTITY_MATRIX, Path2DImpl = globalThis.Path2D) {
  if (typeof Path2DImpl !== 'function') return null
  const path = new Path2DImpl()
  for (const shape of shapes) {
    for (const subpath of shape.subpaths ?? []) {
      let started = false
      for (const segment of subpath.segments ?? []) {
        if (segment.type === 'M') {
          const local = transformPoint(shape.transform ?? IDENTITY_MATRIX, segment.x, segment.y)
          const world = transformPoint(parentMatrix, local.x, local.y)
          path.moveTo(world.x, world.y)
          started = true
        } else if (segment.type === 'L') {
          if (!started) continue
          const local = transformPoint(shape.transform ?? IDENTITY_MATRIX, segment.x, segment.y)
          const world = transformPoint(parentMatrix, local.x, local.y)
          path.lineTo(world.x, world.y)
        } else if (segment.type === 'C') {
          if (!started) continue
          const c1 = transformPoint(shape.transform, segment.x1, segment.y1)
          const c2 = transformPoint(shape.transform, segment.x2, segment.y2)
          const end = transformPoint(shape.transform, segment.x, segment.y)
          const w1 = transformPoint(parentMatrix, c1.x, c1.y)
          const w2 = transformPoint(parentMatrix, c2.x, c2.y)
          const w3 = transformPoint(parentMatrix, end.x, end.y)
          path.bezierCurveTo(w1.x, w1.y, w2.x, w2.y, w3.x, w3.y)
        }
      }
      if (subpath.closed) path.closePath()
    }
  }
  return path
}
