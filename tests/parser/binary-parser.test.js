import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import {
  BinaryParser,
  decodeAscii85,
  indexOfBytes,
  inflateBytes,
  looksLikeZlib,
  looksLikeZstandard,
} from '../../src/core/BinaryParser.js'
import { ErrorCodes } from '../../src/utils/errors.js'

describe('BinaryParser', () => {
  it('按大小端读取整数', () => {
    const parser = new BinaryParser(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0xff]))
    expect(parser.readUint8(0)).toBe(1)
    expect(parser.readUint16(0)).toBe(0x0102)
    expect(parser.readUint16(0, true)).toBe(0x0201)
    expect(parser.readUint32(0)).toBe(0x01020304)
    expect(parser.readInt8(4)).toBe(-1)
  })

  it('越界读取抛出结构化错误', () => {
    const parser = new BinaryParser(new Uint8Array([1, 2, 3]))
    expect(() => parser.readUint32(1)).toThrowError(/越界/)
    try {
      parser.readUint32(1)
    } catch (error) {
      expect(error.code).toBe(ErrorCodes.BINARY_RANGE)
    }
    expect(() => parser.readBytes(-1, 1)).toThrow()
  })

  it('查找字节序列', () => {
    const parser = new BinaryParser(new TextEncoder().encode('abc--marker--abc--marker'))
    expect(parser.findAscii('marker')).toBe(5)
    expect(parser.findAscii('missing')).toBe(-1)
    expect(parser.findAllAscii('marker')).toEqual([5, 18])
    expect(parser.findLastAscii('marker')).toBe(18)
    expect(parser.findAllAscii('a', { from: 1, to: 20 })).toEqual([6, 13, 19])
  })

  it('indexOfBytes 处理边界与空模式', () => {
    const haystack = new Uint8Array([1, 2, 3, 4, 5])
    const needle = new Uint8Array([4, 5])
    expect(indexOfBytes(haystack, needle)).toBe(3)
    expect(indexOfBytes(haystack, new Uint8Array([5, 4]))).toBe(-1)
    expect(indexOfBytes(haystack, new Uint8Array([]), 2)).toBe(2)
    expect(indexOfBytes(haystack, needle, 4)).toBe(-1)
  })

  it('识别 zlib / zstd 魔数', () => {
    const zlib = deflateSync(Buffer.from('hello'))
    expect(looksLikeZlib(zlib)).toBe(true)
    expect(looksLikeZlib(new Uint8Array([0x00, 0x00]))).toBe(false)
    expect(looksLikeZstandard(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]))).toBe(true)
    expect(looksLikeZstandard(new Uint8Array([0x28, 0xb5, 0x2f]))).toBe(false)
  })
})

describe('decodeAscii85', () => {
  it('解码 Adobe ASCII85 文本', () => {
    const decoded = decodeAscii85('<~87cURD]i,"Ebo80~>')
    expect(new TextDecoder().decode(decoded)).toBe('Hello World!')
  })

  it('支持 z 缩写与末尾不完整分组', () => {
    expect(Array.from(decodeAscii85('<~z~>'))).toEqual([0, 0, 0, 0])
    expect(Array.from(decodeAscii85('<~!!~>'))).toEqual([0])
  })

  it('忽略空白并拒绝非法字符', () => {
    expect(Array.from(decodeAscii85('<~ ! ! ~>'))).toEqual([0])
    expect(() => decodeAscii85('<~v~>')).toThrowError(/非法字符/)
    expect(() => decodeAscii85('<~A~>')).toThrowError(/末尾组/)
  })
})

describe('inflateBytes', () => {
  it('解压 zlib 数据', async () => {
    const compressed = deflateSync(Buffer.from('AI private data'))
    const result = await inflateBytes(compressed)
    expect(new TextDecoder().decode(result.bytes)).toBe('AI private data')
    expect(result.trailingData).toBe(false)
  })

  it('保留尾部垃圾前的有效数据', async () => {
    const compressed = deflateSync(Buffer.from('valid payload'))
    const input = Buffer.concat([compressed, Buffer.from('%AI12_EndCompressedData')])
    const result = await inflateBytes(input)
    expect(new TextDecoder().decode(result.bytes)).toBe('valid payload')
    expect(result.trailingData).toBe(true)
  })

  it('执行解压大小上限', async () => {
    const compressed = deflateSync(Buffer.alloc(4096, 65))
    await expect(inflateBytes(compressed, { maxBytes: 100 })).rejects.toMatchObject({
      code: ErrorCodes.INFLATE_LIMIT,
    })
  })

  it('损坏数据抛出结构化错误', async () => {
    await expect(inflateBytes(new Uint8Array([0x78, 0x9c, 0x00]))).rejects.toMatchObject({
      code: ErrorCodes.INFLATE_FAILED,
    })
  })
})
