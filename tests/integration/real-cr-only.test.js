import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AIParserEngine } from '../../src/core/AIParserEngine.js'

const realPath = fileURLToPath(new URL('../fixtures/real/wuyingying.ai', import.meta.url))
const wasmPath = fileURLToPath(new URL('../../public/wasm/ai_viewer_wasm.wasm', import.meta.url))
const hasSample = existsSync(realPath)
const wasmBytes = existsSync(wasmPath) ? readFileSync(wasmPath) : undefined

describe.skipIf(!hasSample)('真实 AI 样本（CR-only + zstd 尾部空白）', () => {
  it(
    '解码 AI24 zstd 并解析 CR-only 换行的绘图内容',
    async () => {
      const result = await new AIParserEngine({
        hash: false,
        wasmBytes,
      }).parse(readFileSync(realPath), { fileName: 'wuyingying.ai' })

      expect(result.ok).toBe(true)
      const report = result.report
      expect(report.detection.container).toBe('pdf')
      expect(report.privateData.status).toBe('decoded')
      expect(report.privateData.compression).toBe('zstd')
      expect(report.privateData.decodedBytes).toBeGreaterThan(100_000)

      expect(report.graphics.status).toBe('parsed')
      expect(report.graphics.vectorCount).toBeGreaterThan(50)
      expect(report.graphics.unknownOperators).toHaveLength(0)
      expect(report.graphics.artboards[0].rect).toMatchObject({
        width: 595.276000976563,
        height: 841.890014648438,
      })
      expect(report.scene.stats.shapes).toBe(report.graphics.vectorCount)
      expect(report.compatibility.overall).toBe('PARTIAL')
    },
    30_000,
  )
})
