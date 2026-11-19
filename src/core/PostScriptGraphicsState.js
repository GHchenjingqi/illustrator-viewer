/**
 * PostScriptGraphicsState
 * ----------------
 * 保存 PostScript / PDF 内容流中的图形状态子集。
 * 不支持的状态项不会被猜测，由解析器记录诊断。
 */

import { IDENTITY_MATRIX } from '../engine/TransformEngine.js'

export function createDefaultPaint() {
  return { type: 'gray', values: [0] }
}

export function clonePaint(paint) {
  return {
    type: paint.type,
    values: paint.values ? [...paint.values] : undefined,
    name: paint.name,
  }
}

export class PostScriptGraphicsState {
  constructor() {
    this.ctm = [...IDENTITY_MATRIX]
    this.fillColor = createDefaultPaint()
    this.strokeColor = createDefaultPaint()
    this.fillColorSpace = 'DeviceGray'
    this.strokeColorSpace = 'DeviceGray'
    this.lineWidth = 1
    this.lineCap = 0
    this.lineJoin = 0
    this.miterLimit = 10
    this.dashArray = []
    this.dashOffset = 0
    this.clipDepth = 0
  }

  clone() {
    const next = new PostScriptGraphicsState()
    next.ctm = [...this.ctm]
    next.fillColor = clonePaint(this.fillColor)
    next.strokeColor = clonePaint(this.strokeColor)
    next.fillColorSpace = this.fillColorSpace
    next.strokeColorSpace = this.strokeColorSpace
    next.lineWidth = this.lineWidth
    next.lineCap = this.lineCap
    next.lineJoin = this.lineJoin
    next.miterLimit = this.miterLimit
    next.dashArray = [...this.dashArray]
    next.dashOffset = this.dashOffset
    next.clipDepth = this.clipDepth
    return next
  }
}
