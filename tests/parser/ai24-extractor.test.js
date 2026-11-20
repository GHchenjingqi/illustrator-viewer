import { describe, expect, it } from 'vitest'
import zlib from 'node:zlib'
import { extractAi24Zstd } from '../../src/core/AI24Extractor.js'

const canCompress = typeof zlib.zstdCompressSync === 'function'

function buildChunkedPdf(compressed, splitAt) {
  const marker = Buffer.from('%AI24_ZStandard_Data', 'latin1')
  const firstData = Buffer.concat([marker, compressed.subarray(0, splitAt)])
  const secondData = compressed.subarray(splitAt)
  const parts = [
    Buffer.from(`11 0 obj\r<</Length ${firstData.length}>>stream\r\n`, 'latin1'),
    firstData,
    Buffer.from(
      `\r\nendstream\rendobj\r12 0 obj\r<</Length ${secondData.length}>>stream\r\n`,
      'latin1',
    ),
    secondData,
    Buffer.from('\r\nendstream\rendobj\r', 'latin1'),
  ]
  const buffer = Buffer.concat(parts)
  return { buffer, markerOffset: buffer.indexOf(marker) }
}

describe.skipIf(!canCompress)('extractAi24Zstd', () => {
  it('拼接多个 PDF stream 分块并解压', async () => {
    const plain = Buffer.from('AI24 zstd chunk test '.repeat(500), 'latin1')
    const compressed = zlib.zstdCompressSync(plain)
    const { buffer, markerOffset } = buildChunkedPdf(compressed, Math.floor(compressed.length / 2))

    const result = await extractAi24Zstd(new Uint8Array(buffer), markerOffset)
    expect(result.status).toBe('decoded')
    expect(result.chunkCount).toBe(2)
    expect(result.chunksUsed).toBe(2)
    expect(result.objectNumber).toBe(11)
    expect(Buffer.from(result.bytes).toString('latin1')).toBe(plain.toString('latin1'))
  })

  it('支持标记后直接跟单帧 zstd 的回退路径', async () => {
    const plain = Buffer.from('raw zstd payload '.repeat(100), 'latin1')
    const compressed = zlib.zstdCompressSync(plain)
    const marker = Buffer.from('%AI24_ZStandard_Data', 'latin1')
    const buffer = Buffer.concat([Buffer.from('prefix\n', 'latin1'), marker, compressed])
    const markerOffset = buffer.indexOf(marker)

    const result = await extractAi24Zstd(new Uint8Array(buffer), markerOffset)
    expect(result.status).toBe('decoded')
    expect(result.source).toBe('raw-zstd')
    expect(Buffer.from(result.bytes).toString('latin1')).toBe(plain.toString('latin1'))
  })

  it('忽略 zstd frame 后的尾随换行', async () => {
    const plain = Buffer.from('trailing newline payload '.repeat(50), 'latin1')
    const compressed = zlib.zstdCompressSync(plain)
    const marker = Buffer.from('%AI24_ZStandard_Data', 'latin1')
    const buffer = Buffer.concat([marker, compressed, Buffer.from('\r\n', 'latin1')])
    const markerOffset = buffer.indexOf(marker)

    const result = await extractAi24Zstd(new Uint8Array(buffer), markerOffset)
    expect(result.status).toBe('decoded')
    expect(Buffer.from(result.bytes).toString('latin1')).toBe(plain.toString('latin1'))
  })
})
