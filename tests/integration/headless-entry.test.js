import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AIParserEngine, AIWorkerClient, CanvasRenderer } from '../../src/headless.js'

const samplePath = fileURLToPath(
  new URL('../fixtures/synthetic/synthetic-ai12-pdf.bin', import.meta.url),
)

describe('无框架入口', () => {
  it('导出解析与 Canvas 能力，并可完成一次解析', async () => {
    expect(typeof AIWorkerClient).toBe('function')
    expect(typeof CanvasRenderer).toBe('function')

    const result = await new AIParserEngine({ hash: false }).parse(readFileSync(samplePath), {
      fileName: 'synthetic-ai12-pdf.bin',
    })

    expect(result.ok).toBe(true)
    expect(result.report.graphics.vectorCount).toBe(2)
    expect(result.report.scene.stats.shapes).toBe(2)
  })
})
