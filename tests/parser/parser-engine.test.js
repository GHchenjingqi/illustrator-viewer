import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AIParserEngine, ENGINE_STAGE } from '../../src/core/AIParserEngine.js'
import { ErrorCodes } from '../../src/utils/errors.js'

const fixtureBuffer = (name) =>
  readFileSync(new URL(`../fixtures/synthetic/${name}`, import.meta.url))

describe('AIParserEngine', () => {
  it('完成 读取 → 检测 → 兼容性报告 的完整调度', async () => {
    const engine = new AIParserEngine()
    const events = []
    const result = await engine.parse(fixtureBuffer('synthetic-ai12-pdf.bin'), {
      fileName: 'sample.bin',
      onProgress: (event) => events.push(event),
    })

    expect(result.ok).toBe(true)
    expect(result.stage).toBe(ENGINE_STAGE)
    expect(result.report.file.name).toBe('sample.bin')
    expect(result.report.file.sha256).toHaveLength(64)
    expect(result.report.compatibility.overall).toBe('PARTIAL')
    expect(result.report.engine).toMatchObject({ stage: 1, javascriptOnly: true, wasmUsed: false })
    expect(result.report.durationMs).toBeGreaterThanOrEqual(0)
    expect(events.at(0).phase).toBe('read')
    expect(events.at(-1).phase).toBe('done')
  })

  it('未知文件返回结构化报告而不崩溃', async () => {
    const engine = new AIParserEngine()
    const result = await engine.parse(new TextEncoder().encode('plain text'))
    expect(result.ok).toBe(true)
    expect(result.report.detection.container).toBe('unknown')
    expect(result.report.compatibility.overall).toBe('INVALID')
  })

  it('空文件返回结构化错误', async () => {
    const engine = new AIParserEngine()
    const result = await engine.parse(new Uint8Array([]))
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe(ErrorCodes.EMPTY_FILE)
  })

  it('支持在开始前取消', async () => {
    const engine = new AIParserEngine()
    const controller = new AbortController()
    controller.abort()
    const result = await engine.parse(fixtureBuffer('synthetic-ai12-pdf.bin'), {
      signal: controller.signal,
    })
    expect(result.ok).toBe(false)
    expect(result.aborted).toBe(true)
    expect(result.error.code).toBe('ABORTED')
  })

  it('可关闭 SHA-256 计算', async () => {
    const engine = new AIParserEngine({ hash: false })
    const result = await engine.parse(fixtureBuffer('synthetic-legacy-ps.bin'))
    expect(result.ok).toBe(true)
    expect(result.report.file.sha256).toBeNull()
  })
})
