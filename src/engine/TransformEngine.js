/**
 * TransformEngine
 * ----------------
 * 阶段 2 先提供解析器所需的仿射矩阵工具。
 * 阶段 4 将在此基础上增加画板定位、视口缩放/平移与屏幕坐标转换。
 *
 * 矩阵采用 PDF / PostScript 的六元组：[a b c d e f]
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 */

export const IDENTITY_MATRIX = Object.freeze([1, 0, 0, 1, 0, 0])

export function isMatrix(value) {
  return Array.isArray(value) && value.length === 6 && value.every((item) => Number.isFinite(item))
}

/** row-vector 约定下的矩阵乘法：返回 m × n。 */
export function multiplyMatrix(m, n) {
  const [a1, b1, c1, d1, e1, f1] = m
  const [a2, b2, c2, d2, e2, f2] = n
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ]
}

export function translationMatrix(tx, ty) {
  return [1, 0, 0, 1, tx, ty]
}

export function scalingMatrix(sx, sy) {
  return [sx, 0, 0, sy, 0, 0]
}

export function rotationMatrix(degrees) {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return [cos, sin, -sin, cos, 0, 0]
}

export function transformPoint(matrix, x, y) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  }
}

/** 当前 CTM 与局部变换合成（局部变换先执行）。 */
export function concatMatrix(current, local) {
  return multiplyMatrix(local, current)
}

export function matrixToObject(matrix) {
  const [a, b, c, d, e, f] = matrix
  return { a, b, c, d, e, f }
}

/** 求逆矩阵；不可逆时返回单位矩阵。 */
export function invertMatrix(matrix) {
  if (!isMatrix(matrix)) return [...IDENTITY_MATRIX]
  const [a, b, c, d, e, f] = matrix
  const determinant = a * d - b * c
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    return [...IDENTITY_MATRIX]
  }
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ]
}
