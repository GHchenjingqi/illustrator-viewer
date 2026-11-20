import { describe, expect, it } from 'vitest'
import {
  CanvasRenderer,
  computeViewport,
  screenToWorld,
  worldToScreen,
} from '../../src/renderer/CanvasRenderer.js'
import { buildPath2D, buildCompoundPath2D } from '../../src/renderer/PathRenderer.js'
import { resolvePaintColor } from '../../src/engine/ColorEngine.js'
import { IDENTITY_MATRIX } from '../../src/engine/TransformEngine.js'

class FakePath2D {
  constructor() {
    this.commands = []
  }

  moveTo(x, y) {
    this.commands.push(['M', x, y])
  }

  lineTo(x, y) {
    this.commands.push(['L', x, y])
  }

  bezierCurveTo(x1, y1, x2, y2, x, y) {
    this.commands.push(['C', x1, y1, x2, y2, x, y])
  }

  closePath() {
    this.commands.push(['Z'])
  }
}

function createContextRecorder() {
  const calls = []
  const context = {
    calls,
    setTransform: (...args) => calls.push(['setTransform', ...args]),
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    strokeRect: (...args) => calls.push(['strokeRect', ...args]),
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    beginPath: () => calls.push(['beginPath']),
    rect: (...args) => calls.push(['rect', ...args]),
    clip: () => calls.push(['clip']),
    translate: (...args) => calls.push(['translate', ...args]),
    scale: (...args) => calls.push(['scale', ...args]),
    transform: (...args) => calls.push(['transform', ...args]),
    fill: (...args) => calls.push(['fill', ...args]),
    stroke: (...args) => calls.push(['stroke', ...args]),
    setLineDash: (...args) => calls.push(['setLineDash', ...args]),
    createLinearGradient: (...args) => {
      calls.push(['createLinearGradient', ...args])
      return {
        addColorStop: (...stopArgs) => calls.push(['addColorStop', ...stopArgs]),
      }
    },
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    lineDashOffset: 0,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
  }
  return context
}

function fakeCanvas(context) {
  return {
    width: 0,
    height: 0,
    clientWidth: 400,
    clientHeight: 300,
    getContext: () => context,
  }
}

function shape(overrides = {}) {
  return {
    type: 'shape',
    id: 's1',
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
    fill: { type: 'rgb', values: [1, 0, 0] },
    stroke: { type: 'none' },
    fillRule: 'nonzero',
    strokeWidth: 1,
    lineCap: 0,
    lineJoin: 0,
    miterLimit: 10,
    dashArray: [],
    dashOffset: 0,
    transform: [1, 0, 0, 1, 5, 5],
    nonPrinting: false,
    ...overrides,
  }
}

function sceneWith(shapes) {
  return {
    type: 'document',
    artboards: [
      {
        type: 'artboard',
        id: 'a1',
        name: 'A1',
        rect: { x: 0, y: 0, width: 100, height: 100 },
        width: 100,
        height: 100,
        children: [
          {
            type: 'group',
            role: 'layer',
            transform: [1, 0, 0, 1, 0, 0],
            opacity: 1,
            visible: true,
            children: shapes,
          },
        ],
      },
    ],
  }
}

describe('computeViewport', () => {
  it('按画板与视口计算适应缩放和原点', () => {
    const artboard = { x: 0, y: 0, width: 100, height: 50 }
    const viewport = computeViewport({ width: 200, height: 200, artboard, padding: 0 })
    expect(viewport.scale).toBe(2)
    expect(viewport.originX).toBe(0)
    expect(viewport.originY).toBe(50)

    const topLeft = worldToScreen(viewport, artboard, 0, 50)
    expect(topLeft).toEqual({ x: 0, y: 50 })
    const bottomRight = worldToScreen(viewport, artboard, 100, 0)
    expect(bottomRight).toEqual({ x: 200, y: 150 })

    const world = screenToWorld(viewport, artboard, 100, 100)
    expect(world.x).toBe(50)
    expect(world.y).toBe(25)
  })

  it('支持 Y 轴翻转', () => {
    const artboard = { x: 0, y: -700, width: 1250, height: 700 }
    const viewport = computeViewport({ width: 1250, height: 700, artboard, padding: 0 })
    expect(worldToScreen(viewport, artboard, 0, 0)).toEqual({ x: 0, y: 0 })
    expect(worldToScreen(viewport, artboard, 0, -700)).toEqual({ x: 0, y: 700 })
  })
})

describe('PathRenderer', () => {
  it('转换路径并应用矩阵', () => {
    const path = buildPath2D(
      [
        {
          closed: true,
          segments: [
            { type: 'M', x: 0, y: 0 },
            { type: 'L', x: 10, y: 0 },
            { type: 'C', x1: 20, y1: 0, x2: 20, y2: 10, x: 10, y: 10 },
          ],
        },
      ],
      [2, 0, 0, 2, 5, 5],
      FakePath2D,
    )
    expect(path.commands).toEqual([
      ['M', 5, 5],
      ['L', 25, 5],
      ['C', 45, 5, 45, 25, 25, 25],
      ['Z'],
    ])
  })

  it('合并复合路径并应用子图形变换', () => {
    const path = buildCompoundPath2D(
      [shape(), shape({ transform: [1, 0, 0, 1, 20, 0] })],
      [1, 0, 0, 1, 0, 0],
      FakePath2D,
    )
    expect(path.commands.filter((command) => command[0] === 'M')).toEqual([
      ['M', 5, 5],
      ['M', 20, 0],
    ])
  })
})

describe('ColorEngine', () => {
  it('解析 RGB / CMYK / 近似颜色', () => {
    expect(resolvePaintColor({ type: 'rgb', values: [1, 0, 0] })).toEqual({
      css: 'rgb(255, 0, 0)',
      approximate: false,
    })
    expect(resolvePaintColor({ type: 'cmyk', values: [0, 1, 1, 0] })).toEqual({
      css: 'rgb(255, 0, 0)',
      approximate: false,
    })
    expect(resolvePaintColor({ type: 'gray', values: [0.5] }).css).toBe('rgb(128, 128, 128)')
    expect(
      resolvePaintColor({ type: 'gradient', approxColor: [0, 0.5, 1] }),
    ).toEqual({ css: 'rgb(0, 128, 255)', approximate: true })
  })
})

describe('CanvasRenderer', () => {
  it('绘制场景并统计近似对象', () => {
    const context = createContextRecorder()
    const canvas = fakeCanvas(context)
    const renderer = new CanvasRenderer(canvas, { Path2D: FakePath2D })
    renderer.setDocument(sceneWith([shape()]))

    expect(renderer.stats.shapesDrawn).toBe(1)
    expect(renderer.stats.approximateShapes).toBe(0)
    expect(context.calls.some(([name]) => name === 'fill')).toBe(true)

    renderer.setDocument(
      sceneWith([shape({ fill: { type: 'gradient', approxColor: [0, 0.5, 1] } })]),
    )
    expect(renderer.stats.approximateShapes).toBe(1)

    renderer.setDocument(
      sceneWith([
        shape({
          fill: {
            type: 'gradient',
            approxColor: [0, 0.5, 1],
            angle: 90,
            stops: [
              { offset: 0, rgb: [0, 0.4, 0.6] },
              { offset: 1, rgb: [0.1, 0.8, 0.9] },
            ],
          },
        }),
      ]),
    )
    expect(context.calls.some(([name]) => name === 'createLinearGradient')).toBe(true)
    expect(context.calls.filter(([name]) => name === 'addColorStop')).toHaveLength(2)
  })

  it('跳过非打印图形', () => {
    const context = createContextRecorder()
    const renderer = new CanvasRenderer(fakeCanvas(context), { Path2D: FakePath2D })
    renderer.setDocument(sceneWith([shape({ nonPrinting: true })]))
    expect(renderer.stats.shapesSkipped).toBe(1)
    expect(renderer.stats.shapesDrawn).toBe(0)
  })

  it('把黑色外轮廓 + 渐变子图形按剪裁蒙版绘制', () => {
    const context = createContextRecorder()
    const renderer = new CanvasRenderer(fakeCanvas(context), { Path2D: FakePath2D })
    const mask = shape({
      id: 'mask',
      fill: { type: 'gray', values: [0] },
      transform: IDENTITY_MATRIX,
    })
    const gradient = shape({
      id: 'gradient',
      fill: {
        type: 'gradient',
        approxColor: [0, 0.5, 1],
        angle: 90,
        stops: [
          { offset: 0, rgb: [0, 0.4, 0.6] },
          { offset: 1, rgb: [0.1, 0.8, 0.9] },
        ],
      },
      transform: IDENTITY_MATRIX,
      bounds: { x: 2, y: 2, width: 4, height: 4 },
    })
    const compound = {
      type: 'group',
      role: 'compound',
      transform: IDENTITY_MATRIX,
      opacity: 1,
      visible: true,
      children: [mask, gradient],
    }
    renderer.setDocument(sceneWith([compound]))

    expect(renderer.stats.clipMaskGroups).toBe(1)
    expect(renderer.stats.shapesDrawn).toBe(1)
    expect(context.calls.some(([name]) => name === 'createLinearGradient')).toBe(true)
    expect(context.calls.filter(([name]) => name === 'addColorStop')).toHaveLength(2)
    const fillCall = context.calls.find(([name]) => name === 'fill')
    expect(fillCall?.[2]).toBe('evenodd')
    expect(fillCall?.[1]?.commands.filter(([command]) => command === 'M')).toHaveLength(2)
  })

  it('缩放到指定比例', () => {
    const renderer = new CanvasRenderer(fakeCanvas(createContextRecorder()), { Path2D: FakePath2D })
    renderer.setDocument(sceneWith([shape()]))
    const before = renderer.getScalePercent()
    renderer.setZoom(2)
    expect(renderer.getScalePercent()).toBeGreaterThan(before)
  })
})
