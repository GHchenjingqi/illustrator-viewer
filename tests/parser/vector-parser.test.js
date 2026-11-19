import { describe, expect, it } from 'vitest'
import { VectorBuilder, computeBounds, normalizePaint } from '../../src/core/VectorParser.js'

const rectSubpaths = [
  {
    closed: true,
    segments: [
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 100, y: 0 },
      { type: 'L', x: 100, y: 50 },
      { type: 'L', x: 0, y: 50 },
    ],
  },
]

describe('VectorBuilder', () => {
  it('分类矩形并保留填充', () => {
    const builder = new VectorBuilder()
    const vector = builder.addPath({
      subpaths: rectSubpaths,
      fill: { type: 'rgb', values: [1, 0, 0] },
      stroke: null,
      fillRule: 'nonzero',
      transform: [1, 0, 0, 1, 0, 0],
    })

    expect(vector.type).toBe('rect')
    expect(vector.rect).toEqual({ x: 0, y: 0, width: 100, height: 50 })
    expect(vector.fill).toEqual({ type: 'rgb', values: [1, 0, 0] })
    expect(vector.stroke).toEqual({ type: 'none' })
    expect(vector.support).toBe('PARTIAL')
  })

  it('分类线段与曲线', () => {
    const builder = new VectorBuilder()
    const line = builder.addPath({
      subpaths: [{ closed: false, segments: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 10, y: 10 }] }],
      stroke: { type: 'gray', values: [0] },
      transform: [1, 0, 0, 1, 0, 0],
    })
    expect(line.type).toBe('line')

    const curve = builder.addPath({
      subpaths: [
        {
          closed: false,
          segments: [
            { type: 'M', x: 0, y: 0 },
            { type: 'C', x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
          ],
        },
      ],
      stroke: { type: 'gray', values: [0] },
      transform: [1, 0, 0, 1, 0, 0],
    })
    expect(curve.type).toBe('path')
    expect(curve.boundsApproximate).toBe(true)
  })

  it('应用变换计算包围盒', () => {
    const builder = new VectorBuilder()
    const vector = builder.addPath({
      subpaths: rectSubpaths,
      fill: { type: 'gray', values: [0.5] },
      transform: [2, 0, 0, 2, 10, 20],
    })
    expect(vector.bounds).toEqual({ x: 10, y: 20, width: 200, height: 100 })
  })

  it('无填充且无描边时不生成对象', () => {
    const builder = new VectorBuilder()
    const vector = builder.addPath({
      subpaths: rectSubpaths,
      fill: { type: 'none' },
      stroke: { type: 'none' },
    })
    expect(vector).toBeNull()
    expect(builder.objects).toHaveLength(0)
  })

  it('遵守对象数量上限', () => {
    const builder = new VectorBuilder({ maxObjects: 1 })
    builder.addPath({ subpaths: rectSubpaths, fill: { type: 'gray', values: [0] } })
    const overflow = builder.addPath({ subpaths: rectSubpaths, fill: { type: 'gray', values: [0] } })
    expect(overflow).toBeNull()
    expect(builder.truncated).toBe(true)
    expect(builder.objects).toHaveLength(1)
  })
})

describe('computeBounds', () => {
  it('合并多子路径并应用矩阵', () => {
    const result = computeBounds(
      [
        { closed: false, segments: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 10, y: 10 }] },
        { closed: true, segments: [{ type: 'M', x: -5, y: -5 }, { type: 'L', x: 5, y: -5 }] },
      ],
      [2, 0, 0, 3, 5, 6],
    )
    expect(result.bounds.x).toBe(-5)
    expect(result.bounds.y).toBe(-9)
    expect(result.bounds.width).toBe(30)
    expect(result.bounds.height).toBe(45)
    expect(result.approximate).toBe(false)
  })
})

describe('normalizePaint', () => {
  it('规范化颜色与未知类型', () => {
    expect(normalizePaint({ type: 'cmyk', values: [0, 1, 1, 0] })).toEqual({
      type: 'cmyk',
      values: [0, 1, 1, 0],
    })
    expect(normalizePaint({ type: 'rgb', values: [1, 2] })).toMatchObject({ type: 'unknown' })
    expect(normalizePaint({ type: 'spot', name: 'PANTONE 185 C' })).toEqual({
      type: 'named',
      name: 'PANTONE 185 C',
    })
    expect(normalizePaint(null)).toEqual({ type: 'none' })
  })
})
