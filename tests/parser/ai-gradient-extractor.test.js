import { describe, expect, it } from 'vitest'
import { extractGradientDefinitions } from '../../src/core/AIGradientExtractor.js'

const block = [
  '%AI5_BeginGradient: (Test Gradient)',
  '(Test Gradient) 0 2 Bd',
  '[',
  '<',
  '0001020304',
  '>',
  '0.75 0.17 0.25 0 0.015 0.66 0.76 2 1 6 50 0 %_BS',
  '%_0.75 0.17 0.25 0 0.015 0.66 0.76 2 1 6 50 0 Bs',
  '0.85 0.5 0.2 0 0 0.45 0.66 2 1 6 50 100 %_BS',
  '%_0.85 0.5 0.2 0 0 0.45 0.66 2 1 6 50 100 Bs',
  'BD',
  '%AI5_EndGradient',
].join('\r\n')

const sixNumberBlock = [
  '%AI5_BeginGradient: (RGB Gradient)',
  '(RGB Gradient) 0 2 Bd',
  '[',
  '0.81 0 1 6 50 100 %_BS',
  '1 0 1 6 50 0 %_BS',
  'BD',
  '%AI5_EndGradient',
].join('\r\n')

describe('extractGradientDefinitions', () => {
  it('提取 CMYK/RGB 停靠点与位置', () => {
    const map = extractGradientDefinitions(block)
    const gradient = map.get('Test Gradient')
    expect(gradient).toBeTruthy()
    expect(gradient.stops).toHaveLength(2)
    expect(gradient.stops[0].offset).toBe(0)
    expect(gradient.stops[0].rgb).toEqual([0.015, 0.66, 0.76])
    expect(gradient.stops[1].offset).toBe(1)
    expect(gradient.stops[1].rgb).toEqual([0, 0.45, 0.66])
    expect(gradient.approxColor).toHaveLength(3)
  })

  it('兼容 6 数字 RGB 停靠点', () => {
    const gradient = extractGradientDefinitions(sixNumberBlock).get('RGB Gradient')
    expect(gradient.stops).toEqual([
      { offset: 0, rgb: [1, 0, 1], cmyk: null },
      { offset: 1, rgb: [0.81, 0, 1], cmyk: null },
    ])
  })

  it('没有渐变时返回空 Map', () => {
    expect(extractGradientDefinitions('0 0 m 10 0 l S').size).toBe(0)
  })
})
