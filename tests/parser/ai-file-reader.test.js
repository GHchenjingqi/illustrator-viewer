import { describe, expect, it } from 'vitest'
import { AIFileReader } from '../../src/core/AIFileReader.js'
import { ErrorCodes } from '../../src/utils/errors.js'

const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

describe('AIFileReader', () => {
  it('读取 Uint8Array 并计算 SHA-256', async () => {
    const reader = new AIFileReader()
    const result = await reader.read(new TextEncoder().encode('abc'))
    expect(result.size).toBe(3)
    expect(result.sha256).toBe(SHA256_ABC)
    expect(result.name).toBeNull()
  })

  it('读取 ArrayBuffer', async () => {
    const reader = new AIFileReader({ hash: false })
    const buffer = new TextEncoder().encode('hello').buffer
    const result = await reader.read(buffer)
    expect(new TextDecoder().decode(result.bytes)).toBe('hello')
    expect(result.sha256).toBeNull()
  })

  it('以流式方式读取 Blob 并报告进度', async () => {
    const reader = new AIFileReader({ chunkSize: 2, hash: false })
    const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])])
    const events = []
    const result = await reader.read(blob, { onProgress: (event) => events.push(event) })

    expect(result.size).toBe(5)
    expect(Array.from(result.bytes)).toEqual([1, 2, 3, 4, 5])
    expect(events.length).toBeGreaterThan(0)
    expect(events.at(-1).ratio).toBe(1)
    expect(events.at(-1).loaded).toBe(5)
  })

  it('拒绝空文件', async () => {
    const reader = new AIFileReader({ hash: false })
    await expect(reader.read(new Uint8Array([]))).rejects.toMatchObject({
      code: ErrorCodes.EMPTY_FILE,
    })
  })

  it('拒绝超过大小上限的文件', async () => {
    const reader = new AIFileReader({ maxFileSize: 4, hash: false })
    await expect(reader.read(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toMatchObject({
      code: ErrorCodes.FILE_TOO_LARGE,
    })
  })

  it('支持取消', async () => {
    const reader = new AIFileReader({ hash: false })
    const controller = new AbortController()
    controller.abort()
    await expect(
      reader.read(new Uint8Array([1, 2, 3]), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('拒绝未知来源', async () => {
    const reader = new AIFileReader({ hash: false })
    await expect(reader.read({ size: 1 })).rejects.toMatchObject({
      code: ErrorCodes.UNSUPPORTED_SOURCE,
    })
  })
})
