import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { WasmBridge } from '../../src/wasm/WasmBridge.js'
import { VectorBuilder } from '../../src/core/VectorParser.js'

const wasmPath = fileURLToPath(new URL('../../public/wasm/ai_viewer_wasm.wasm', import.meta.url))
const wasmBytes = existsSync(wasmPath) ? readFileSync(wasmPath) : null

const rectSubpaths = [
  {
    closed: true,
    segments: [
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 10, y: 0 },
      { type: 'L', x: 10, y: 10 },
      { type: 'L', x: 0, y: 10 },
    ],
  },
]

describe.skipIf(!wasmBytes)('WasmBridge', () => {
  it('计算仿射变换后的包围盒', async () => {
    const bridge = new WasmBridge({ bytes: wasmBytes })
    expect(await bridge.init()).toBe(true)
    expect(bridge.ready).toBe(true)

    const points = new Float64Array([0, 0, 10, 10])
    const bounds = bridge.computeBounds(points, [2, 0, 0, 2, 5, 6])
    expect(bounds).toEqual({ x: 5, y: 6, width: 20, height: 20 })
    expect(bridge.boundsCalls).toBe(1)
  })

  it('字节模式计数与 JS 结果一致', async () => {
    const bridge = new WasmBridge({ bytes: wasmBytes })
    await bridge.init()
    const haystack = new TextEncoder().encode('abc--marker--abc--marker')
    const needle = new TextEncoder().encode('marker')
    expect(bridge.countPattern(haystack, needle)).toBe(2)

    const scan = bridge.scanPatterns(haystack, [needle, new TextEncoder().encode('abc')])
    expect(scan.counts).toEqual([2, 2])
    expect(scan.first).toEqual([5, 0])
  })

  it('WASM 包围盒与 JS 计算结果一致', async () => {
    const bridge = new WasmBridge({ bytes: wasmBytes })
    await bridge.init()

    const wasmBuilder = new VectorBuilder({
      boundsComputer: (points, matrix) => bridge.computeBounds(points, matrix),
    })
    const jsBuilder = new VectorBuilder()

    const wasmVector = wasmBuilder.addPath({
      subpaths: rectSubpaths,
      fill: { type: 'gray', values: [0] },
      transform: [2, 0, 0, 2, 5, 6],
    })
    const jsVector = jsBuilder.addPath({
      subpaths: rectSubpaths,
      fill: { type: 'gray', values: [0] },
      transform: [2, 0, 0, 2, 5, 6],
    })

    expect(wasmVector.boundsBackend).toBe('wasm')
    expect(jsVector.boundsBackend).toBe('js')
    expect(wasmVector.bounds).toEqual(jsVector.bounds)
    expect(wasmBuilder.wasmBoundsUsed).toBe(1)
    expect(jsBuilder.jsBoundsUsed).toBe(1)
  })

  it('WASM 不可用时回退 JS', async () => {
    const bridge = new WasmBridge({ enabled: false })
    expect(await bridge.init()).toBe(false)
    expect(bridge.computeBounds(new Float64Array([0, 0]), [1, 0, 0, 1, 0, 0])).toBeNull()
    expect(bridge.getStatus().failed).toBe(true)
  })
})
