import { describe, expect, it } from 'vitest'
import { extractNativeArtboards } from '../../src/core/AIArtboardExtractor.js'

function artboardText(name) {
  return [
    '%_/Array :',
    '%_/Dictionary :',
    '%_1 /Real (PAR) ,',
    `%_(${name}) /UnicodeString (Name) ,`,
    '%_0 /Bool (IsArtboardDefaultName) ,',
    '%_1250 -700 /RealPointRelToROrigin',
    '%_ (PositionPoint2) ,',
    '%_0 /Int (DisplayMark) ,',
    '%_7566 7841 /RealPoint',
    '%_ (RulerOrigin) ,',
    '%_0 0 /RealPointRelToROrigin',
    '%_ (PositionPoint1) ,',
    '%_; ,',
    '%_; (ArtboardArray) ,',
  ].join('\r\n')
}

describe('extractNativeArtboards', () => {
  it('提取原生画板名称与矩形', () => {
    const name = Buffer.from('画板 1', 'utf8').toString('latin1')
    const artboards = extractNativeArtboards(artboardText(name))
    expect(artboards).toHaveLength(1)
    expect(artboards[0].name).toBe('画板 1')
    expect(artboards[0].rect).toEqual({ x: 0, y: -700, width: 1250, height: 700 })
    expect(artboards[0].source).toBe('native-artboard')
  })

  it('无 ArtboardArray 时返回空数组', () => {
    expect(extractNativeArtboards('0 0 m 10 0 l S')).toEqual([])
    expect(extractNativeArtboards('')).toEqual([])
  })
})
