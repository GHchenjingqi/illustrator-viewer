import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AIParserEngine } from '../../src/core/AIParserEngine.js'

const realPath = fileURLToPath(new URL('../fixtures/real/lengdong-logo.ai', import.meta.url))
const wasmPath = fileURLToPath(new URL('../../public/wasm/ai_viewer_wasm.wasm', import.meta.url))
const hasRealSample = existsSync(realPath)
const wasmBytes = existsSync(wasmPath) ? readFileSync(wasmPath) : undefined

describe.skipIf(!hasRealSample)('真实 AI24 样本（本地）', () => {
  it(
    '分块 zstd 解压、真实操作符解析、原生画板提取',
    async () => {
      const bytes = readFileSync(realPath)
      const engine = new AIParserEngine({ hash: false, wasmBytes })
      const result = await engine.parse(bytes, { fileName: 'lengdong-logo.ai' })

      expect(result.ok).toBe(true)
      const report = result.report
      expect(report.detection.container).toBe('pdf')
      expect(report.detection.aiFormatVersion).toBe(24)
      expect(report.detection.applicationVersion).toBe('29.3.0')

      expect(report.privateData.status).toBe('decoded')
      expect(report.privateData.compression).toBe('zstd')
      expect(report.privateData.chunkCount).toBeGreaterThan(1)
      expect(report.privateData.decodedBytes).toBeGreaterThan(1_000_000)

      const graphics = report.graphics
      expect(graphics.status).toBe('parsed')
      expect(graphics.vectorCount).toBeGreaterThan(500)
      expect(graphics.unknownOperators).toHaveLength(0)
      expect(graphics.stats.layers).toBe(1)
      expect(graphics.stats.gradients).toBeGreaterThan(0)

      const gradientCount = graphics.vectors.filter(
        (vector) => vector.fill?.type === 'gradient',
      ).length
      const customCount = graphics.vectors.filter(
        (vector) => vector.fill?.type === 'custom',
      ).length
      expect(gradientCount).toBeGreaterThan(0)
      expect(customCount).toBeGreaterThan(0)

      expect(graphics.artboardSource).toBe('native-artboard')
      expect(graphics.artboards).toHaveLength(1)
      expect(graphics.artboards[0].name).toBe('画板 1')
      expect(graphics.artboards[0].rect).toEqual({ x: 0, y: -700, width: 1250, height: 700 })

      expect(report.capabilities.postScriptParsing).toBe(true)
      expect(report.capabilities.vectorExtraction).toBe(true)
      expect(report.capabilities.sceneGraph).toBe(true)
      expect(report.capabilities.canvasRendering).toBe(true)
      expect(graphics.visibleVectorCount).toBeGreaterThan(0)
      expect(graphics.visibleVectorCount).toBeLessThan(graphics.vectorCount)
      expect(graphics.filteredOutShapes).toBeGreaterThan(0)
      expect(graphics.visibilityBounds).toBeTruthy()
      expect(report.scene.stats.shapes).toBe(graphics.visibleVectorCount)
      expect(report.compatibility.overall).toBe('PARTIAL')
      if (wasmBytes) {
        expect(report.engine.wasmAvailable).toBe(true)
        expect(report.engine.wasmUsed).toBe(true)
        expect(report.scan.backend).toBe('wasm')
        expect(report.graphics.stats.wasmBoundsUsed).toBe(0)
      }
    },
    30000,
  )
})
