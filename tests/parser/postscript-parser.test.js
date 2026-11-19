import { describe, expect, it } from 'vitest'
import { parsePostScript } from '../../src/core/PostScriptParser.js'

function parse(source, options = {}) {
  return parsePostScript(source, options)
}

describe('PostScriptParser - 基础路径与颜色', () => {
  it('提取填充矩形', () => {
    const result = parse('0 0 m 100 0 l 100 50 l 0 50 l h 1 0 0 rg f')
    expect(result.status).toBe('parsed')
    expect(result.vectorCount).toBe(1)
    const [vector] = result.vectors
    expect(vector.type).toBe('rect')
    expect(vector.fill).toEqual({ type: 'rgb', values: [1, 0, 0] })
    expect(vector.stroke).toEqual({ type: 'none' })
    expect(vector.bounds).toEqual({ x: 0, y: 0, width: 100, height: 50 })
    expect(vector.rect).toEqual({ x: 0, y: 0, width: 100, height: 50 })
    expect(vector.subpaths[0].closed).toBe(true)
  })

  it('提取 CMYK 填充与 RGB 描边', () => {
    const result = parse('0 0 100 50 re 0 1 1 0 k f 2 w 0.9 0.2 0.3 RG 0 0 m 10 10 l S')
    expect(result.vectorCount).toBe(2)
    expect(result.vectors[0].fill).toEqual({ type: 'cmyk', values: [0, 1, 1, 0] })
    expect(result.vectors[1].type).toBe('line')
    expect(result.vectors[1].stroke).toEqual({ type: 'rgb', values: [0.9, 0.2, 0.3] })
    expect(result.vectors[1].strokeWidth).toBe(2)
  })

  it('提取贝塞尔曲线并标记近似包围盒', () => {
    const result = parse('10 10 m 20 20 30 30 40 40 c S')
    expect(result.vectorCount).toBe(1)
    const vector = result.vectors[0]
    expect(vector.type).toBe('path')
    expect(vector.subpaths[0].segments).toEqual([
      { type: 'M', x: 10, y: 10 },
      { type: 'C', x1: 20, y1: 20, x2: 30, y2: 30, x: 40, y: 40 },
    ])
    expect(vector.boundsApproximate).toBe(true)
  })

  it('支持 v 与 y 曲线操作符', () => {
    const result = parse('0 0 m 10 10 20 20 v 30 30 40 40 y S')
    const segments = result.vectors[0].subpaths[0].segments
    expect(segments[1]).toEqual({
      type: 'C',
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 10,
      x: 20,
      y: 20,
    })
    expect(segments[2]).toEqual({
      type: 'C',
      x1: 30,
      y1: 30,
      x2: 40,
      y2: 40,
      x: 40,
      y: 40,
    })
  })

  it('处理 evenodd 填充与闭合描边', () => {
    const result = parse('0 0 m 10 0 l 10 10 l 0 10 l h f*')
    expect(result.vectors[0].fillRule).toBe('evenodd')

    const closedStroke = parse('0 0 m 10 0 l 10 10 l s')
    expect(closedStroke.vectors[0].subpaths[0].closed).toBe(true)
  })

  it('记录虚线、线帽与连接', () => {
    const result = parse('[3 2] 1 d 1 J 2 j 4 M 0 0 m 10 0 l S')
    const [vector] = result.vectors
    expect(vector.dashArray).toEqual([3, 2])
    expect(vector.dashOffset).toBe(1)
    expect(vector.lineCap).toBe(1)
    expect(vector.lineJoin).toBe(2)
    expect(vector.miterLimit).toBe(4)
  })
})

describe('PostScriptParser - 变换与状态', () => {  it('应用 translate/scale/rotate/cm 到对象变换与包围盒', () => {
    const result = parse('2 0 0 2 10 20 cm 0 0 m 10 10 l 0 0 0 rg S')
    const [vector] = result.vectors
    expect(vector.transform).toEqual([2, 0, 0, 2, 10, 20])
    expect(vector.bounds).toEqual({ x: 10, y: 20, width: 20, height: 20 })

    const translated = parse('50 60 translate 0 0 m 10 0 l 0 0 0 rg S')
    expect(translated.vectors[0].transform).toEqual([1, 0, 0, 1, 50, 60])
    expect(translated.vectors[0].bounds.x).toBe(50)

    const rotated = parse('90 rotate 0 0 m 10 0 l 0 0 0 rg S')
    expect(rotated.vectors[0].transform[0]).toBeCloseTo(0, 6)
    expect(rotated.vectors[0].transform[1]).toBeCloseTo(1, 6)
  })

  it('gsave/grestore 恢复颜色与 CTM', () => {
    const result = parse(
      '1 0 0 rg 10 0 translate gsave 0 0 1 rg 0 0 m 5 0 l f grestore 0 0 m 5 0 l f',
    )
    expect(result.vectorCount).toBe(2)
    expect(result.vectors[0].fill).toEqual({ type: 'rgb', values: [0, 0, 1] })
    expect(result.vectors[0].transform[4]).toBe(10)
    expect(result.vectors[1].fill).toEqual({ type: 'rgb', values: [1, 0, 0] })
    expect(result.vectors[1].transform[4]).toBe(10)
  })

  it('支持 DeviceRGB / DeviceCMYK 颜色空间与 sc/scn', () => {
    const result = parse('/DeviceRGB cs 0.1 0.2 0.3 sc 0 0 m 10 0 l f')
    expect(result.vectors[0].fill).toEqual({ type: 'rgb', values: [0.1, 0.2, 0.3] })

    const cmyk = parse('/DeviceCMYK cs 0 1 1 0 scn 0 0 m 10 0 l f')
    expect(cmyk.vectors[0].fill).toEqual({ type: 'cmyk', values: [0, 1, 1, 0] })
  })

  it('sethsbcolor 转换为 RGB', () => {
    const result = parse('0 1 1 sethsbcolor 0 0 m 10 0 l f')
    expect(result.vectors[0].fill.type).toBe('rgb')
    expect(result.vectors[0].fill.values).toEqual([1, 0, 0])
  })
})

describe('PostScriptParser - AI 私有操作符（真实样本校准）', () => {
  it('支持大写路径操作符 C / L / Y / H / F', () => {
    const result = parse('0 0 m 10 0 L 10 10 20 20 30 30 C 30 30 40 40 Y H F')
    expect(result.vectorCount).toBe(1)
    const [vector] = result.vectors
    expect(vector.type).toBe('path')
    expect(vector.subpaths[0].closed).toBe(true)
    expect(vector.subpaths[0].segments.map((segment) => segment.type)).toEqual([
      'M',
      'L',
      'C',
      'C',
    ])
  })

  it('解析 AI 自定义颜色 Xa 与填充规则 Xw', () => {
    const result = parse(
      '1 Xw 0.1 0.2 0.3 0.4 0.5 0.6 0.7 Xa 0 0 m 10 0 l 10 10 l h f',
    )
    const [vector] = result.vectors
    expect(vector.fill.type).toBe('custom')
    expect(vector.fill.values).toHaveLength(7)
    expect(vector.fillRule).toBe('evenodd')
    expect(result.stats.customColors).toBe(1)
  })

  it('渐变填充标记为 gradient，而不是错误地使用黑色', () => {
    const result = parse(
      '0 0 m 10 0 l 10 10 l h Bb 1 (Gradient A) 0 0 -90 1 1 0 0 1 0 0 1 Bg 1 0 0 1 0 0 Xm f 0 BB',
    )
    const [vector] = result.vectors
    expect(vector.fill.type).toBe('gradient')
    expect(vector.fill.name).toBe('Gradient A')
    expect(vector.fill.matrices).toHaveLength(1)
    expect(result.stats.gradients).toBe(1)
  })

  it('图层头 Lb 清理操作数栈', () => {
    const result = parse(
      '1 1 1 1 0 0 1 0 79 128 255 0 50 0 Lb (Layer 1) Ln 0 0 m 10 0 l S',
    )
    expect(result.vectorCount).toBe(1)
    expect(result.stats.layers).toBe(1)
    expect(result.stats.leftoverOperands).toBe(0)
  })

  it('跳过 AI 标点/渐变定义 token 而不产生未知操作符', () => {
    const result = parse('1 2 , 3 : 4 ; 0 0 m 10 0 l S')
    expect(result.unknownOperators).toHaveLength(0)
    expect(result.unsupportedFeatures.some((item) => item.feature === 'punctuation')).toBe(true)
  })
})

describe('PostScriptParser - 安全与容错', () => {
  it('未知操作符被记录并跳过', () => {
    const result = parse('0 0 m 10 0 l S Xq Xb foo')
    expect(result.vectors.length).toBe(1)
    expect(result.unknownOperators.map((item) => item.operator)).toEqual(
      expect.arrayContaining(['Xq', 'Xb', 'foo']),
    )
  })

  it('过程体不执行', () => {
    const result = parse('/x { 0 0 m 100 0 l f } def')
    expect(result.stats.procedureBlocks).toBe(1)
    expect(result.vectorCount).toBe(0)
    expect(result.unsupportedFeatures.some((item) => item.feature === 'procedure')).toBe(true)
  })

  it('文本与图片操作符记录为未支持', () => {
    const result = parse('(hello) Tj 0 0 1 1 0 0 Tm')
    expect(result.stats.textOperators).toBeGreaterThan(0)
    expect(result.unsupportedFeatures.some((item) => item.feature === 'text')).toBe(true)
  })

  it('裁剪被记录但不影响解析', () => {
    const result = parse('0 0 10 10 re W 0 0 m 10 0 l S')
    expect(result.stats.clipOperators).toBe(1)
    expect(result.unsupportedFeatures.some((item) => item.feature === 'clip')).toBe(true)
    expect(result.vectorCount).toBe(1)
  })

  it('栈下溢与类型错误产生诊断而不崩溃', () => {
    const result = parse('0 0 m 10 l')
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics.some((item) => item.code === 'STACK_UNDERFLOW')).toBe(true)
  })

  it('损坏字符串不崩溃', () => {
    const result = parse('(unclosed\n0 0 m 10 0 l S')
    expect(result.diagnostics.some((item) => item.code === 'UNTERMINATED_STRING')).toBe(true)
    expect(result.status).toBe('parsed')
  })

  it('遵守路径点数上限并标记截断', () => {
    const result = parse('0 0 m 1 1 l 2 2 l 3 3 l 4 4 l S', { maxPoints: 2 })
    expect(result.truncated).toBe(true)
    expect(result.diagnostics.some((item) => item.code === 'PATH_LIMIT')).toBe(true)
  })
})

describe('PostScriptParser - 画板边界提示', () => {
  it('从 BoundingBox 生成画板候选', () => {
    const result = parse('%%BoundingBox: 0 0 300 200\n0 0 m 10 0 l S')
    expect(result.artboards).toHaveLength(1)
    expect(result.artboards[0].rect).toEqual({ x: 0, y: 0, width: 300, height: 200 })
    expect(result.artboards[0].source).toBe('bounding-box')
  })

  it('优先使用调用方传入的 hints', () => {
    const result = parse('0 0 m 10 0 l S', {
      artboardHints: [{ kind: 'media-box', values: [0, 0, 595, 842] }],
    })
    expect(result.artboards[0].source).toBe('media-box')
    expect(result.artboardHintCount).toBe(1)
  })
})
