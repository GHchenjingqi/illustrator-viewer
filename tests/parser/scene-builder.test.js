import { describe, expect, it } from 'vitest'
import { buildScene } from '../../src/scene/SceneBuilder.js'

function vector(id, overrides = {}) {
  return {
    id,
    type: 'path',
    subpaths: [
      {
        closed: true,
        segments: [
          { type: 'M', x: 0, y: 0 },
          { type: 'L', x: 10, y: 0 },
          { type: 'L', x: 10, y: 10 },
          { type: 'L', x: 0, y: 10 },
        ],
      },
    ],
    fill: { type: 'gray', values: [0] },
    stroke: { type: 'none' },
    fillRule: 'nonzero',
    strokeWidth: 1,
    lineCap: 0,
    lineJoin: 0,
    miterLimit: 10,
    dashArray: [],
    dashOffset: 0,
    transform: [1, 0, 0, 1, 0, 0],
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    boundsApproximate: false,
    support: 'PARTIAL',
    ...overrides,
  }
}

function reportWith(vectors, events) {
  return {
    file: { name: 'scene-test.ai' },
    detection: { aiFormatVersion: 24, creator: '24.0', applicationVersion: '29.0', container: 'pdf' },
    graphics: {
      vectors,
      sceneEvents: events,
      artboards: [
        {
          id: 'artboard-1',
          name: '画板 1',
          rect: { x: 0, y: 0, width: 1000, height: 1000 },
          source: 'native-artboard',
          confidence: 'medium',
        },
      ],
      unsupportedFeatures: [],
    },
    diagnostics: [],
  }
}

describe('SceneBuilder', () => {
  it('按事件构建组与复合路径层级，并计算相对变换', () => {
    const vectors = [
      vector('v1', { transform: [1, 0, 0, 1, 10, 0], bounds: { x: 10, y: 0, width: 10, height: 10 } }),
      vector('v2', {
        fill: { type: 'gradient', name: 'G' },
        transform: [1, 0, 0, 1, 20, 0],
        bounds: { x: 20, y: 0, width: 10, height: 10 },
      }),
      vector('v3', {
        fill: { type: 'custom', values: [0.1, 0.2, 0.3, 0, 0.4, 0.5, 0.6] },
        transform: [1, 0, 0, 1, 30, 0],
        bounds: { x: 30, y: 0, width: 10, height: 10 },
      }),
    ]
    const events = [
      { type: 'group-begin', vectorIndex: 0, transform: [1, 0, 0, 1, 10, 0] },
      { type: 'group-end', vectorIndex: 1, transform: [1, 0, 0, 1, 0, 0] },
      { type: 'compound-begin', vectorIndex: 1, transform: [1, 0, 0, 1, 0, 0] },
      { type: 'compound-end', vectorIndex: 3, transform: [1, 0, 0, 1, 0, 0] },
    ]

    const gradients = new Map([
      ['G', { name: 'G', approxColor: [0.1, 0.6, 0.9], stopCount: 2 }],
    ])
    const scene = buildScene(reportWith(vectors, events), { gradients })

    expect(scene.type).toBe('document')
    expect(scene.hierarchy).toBe('events')
    expect(scene.stats.shapes).toBe(3)
    expect(scene.stats.groups).toBe(1)
    expect(scene.stats.compounds).toBe(1)

    const root = scene.artboards[0].children[0]
    expect(root.role).toBe('layer')
    const group = root.children[0]
    expect(group.role).toBe('group')
    expect(group.transform).toEqual([1, 0, 0, 1, 10, 0])
    expect(group.children[0].id).toBe('v1')
    expect(group.children[0].transform[4]).toBe(0)

    const compound = root.children[1]
    expect(compound.role).toBe('compound')
    expect(compound.children).toHaveLength(2)
    expect(compound.children[0].fill.approximate).toBe(true)
    expect(compound.children[0].fill.approxColor).toEqual([0.1, 0.6, 0.9])
    expect(compound.children[1].fill.approximate).toBe(true)
    expect(compound.children[1].fill.approxColor).toEqual([0.4, 0.5, 0.6])
    expect(scene.approximateFillCount).toBe(2)
  })

  it('无事件时构建扁平图层', () => {
    const scene = buildScene(reportWith([vector('v1'), vector('v2')], []))
    expect(scene.hierarchy).toBe('flat')
    const root = scene.artboards[0].children[0]
    expect(root.role).toBe('layer')
    expect(root.children).toHaveLength(2)
  })

  it('没有画板时按内容包围盒生成候选画板', () => {
    const report = reportWith([vector('v1')], [])
    report.graphics.artboards = []
    const scene = buildScene(report)
    expect(scene.artboards).toHaveLength(1)
    expect(scene.artboards[0].source).toBe('vector-bounds')
    expect(scene.artboards[0].width).toBe(10)
  })
})
