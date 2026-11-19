import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AIParserEngine, ENGINE_STAGE } from '../../src/core/AIParserEngine.js'
import { ErrorCodes } from '../../src/utils/errors.js'

const fixtureBuffer = (name) =>
  readFileSync(new URL(`../fixtures/synthetic/${name}`, import.meta.url))

describe('AIParserEngine', () => {
  it('完成 读取 → 检测 → 基础矢量解析 → 兼容性报告 的完整调度', async () => {
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
    expect(result.report.engine).toMatchObject({ stage: 2, javascriptOnly: true, wasmUsed: false })
    expect(result.report.durationMs).toBeGreaterThanOrEqual(0)

    const graphics = result.report.graphics
    expect(graphics.status).toBe('parsed')
    expect(graphics.vectorCount).toBeGreaterThanOrEqual(2)
    expect(graphics.vectors.map((vector) => vector.type)).toEqual(
      expect.arrayContaining(['rect', 'line']),
    )
    expect(graphics.artboards.length).toBeGreaterThan(0)
    expect(graphics.artboards[0].source).toBe('media-box')

    expect(result.report.capabilities.postScriptParsing).toBe(true)
    expect(result.report.capabilities.vectorExtraction).toBe(true)
    expect(result.report.capabilities.pgfParsing).toBe(false)
    expect(result.report.capabilities.sceneGraph).toBe(false)
    expect(result.report.capabilities.canvasRendering).toBe(false)

    // 瞬态解码文本不得泄漏给 UI
    expect('text' in result.report.privateData).toBe(false)

    const extraction = result.report.compatibility.items.find(
      (item) => item.feature === '基础矢量对象提取',
    )
    expect(extraction.level).toBe('PARTIAL')

    expect(events.at(0).phase).toBe('read')
    expect(events.at(-1).phase).toBe('done')
  })

  it('可关闭矢量解析', async () => {
    const engine = new AIParserEngine()
    const result = await engine.parse(fixtureBuffer('synthetic-legacy-ps.bin'), {
      parseGraphics: false,
    })
    expect(result.ok).toBe(true)
    expect(result.report.graphics.status).toBe('skipped')
    expect(result.report.graphics.vectorCount).toBe(0)
    expect(result.report.capabilities.vectorExtraction).toBe(false)
  })

  it('未知文件返回结构化报告而不崩溃', async () => {
    const engine = new AIParserEngine()
    const result = await engine.parse(new TextEncoder().encode('plain text'))
    expect(result.ok).toBe(true)
    expect(result.report.detection.container).toBe('unknown')
    expect(result.report.compatibility.overall).toBe('INVALID')
    expect(result.report.graphics.status).toBe('skipped')
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
    expect(result.report.graphics.vectorCount).toBeGreaterThan(0)
  })
})
