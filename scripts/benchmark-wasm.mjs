#!/usr/bin/env node
/**
 * WASM vs JavaScript 基准测试。
 *
 * 用法：npm run benchmark:wasm
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WasmBridge } from '../src/wasm/WasmBridge.js'

const wasmPath = fileURLToPath(new URL('../public/wasm/ai_viewer_wasm.wasm', import.meta.url))
const bytes = readFileSync(wasmPath)

const bridge = new WasmBridge({ bytes })
const ready = await bridge.init()
if (!ready) {
  console.error('WASM 初始化失败：', bridge.error)
  process.exit(1)
}

function jsBounds(points, matrix) {
  const [a, b, c, d, e, f] = matrix
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index]
    const y = points[index + 1]
    const tx = a * x + c * y + e
    const ty = b * x + d * y + f
    if (tx < minX) minX = tx
    if (ty < minY) minY = ty
    if (tx > maxX) maxX = tx
    if (ty > maxY) maxY = ty
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function jsCountPattern(haystack, needle) {
  let count = 0
  let cursor = 0
  while (cursor <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle[0], cursor)
    if (found < 0 || found + needle.length > haystack.length) break
    let matched = true
    for (let index = 1; index < needle.length; index += 1) {
      if (haystack[found + index] !== needle[index]) {
        matched = false
        break
      }
    }
    if (matched) {
      count += 1
      cursor = found + needle.length
    } else {
      cursor = found + 1
    }
  }
  return count
}

function time(label, iterations, run) {
  run()
  const started = performance.now()
  let result
  for (let index = 0; index < iterations; index += 1) result = run()
  const elapsed = performance.now() - started
  return { label, iterations, elapsed, perRun: elapsed / iterations, result }
}

const pointCount = 200000
const points = new Float64Array(pointCount * 2)
for (let index = 0; index < pointCount; index += 1) {
  points[index * 2] = (index * 17.31) % 4096
  points[index * 2 + 1] = (index * 29.07) % 4096
}
const matrix = [1.25, 0.12, -0.08, 0.94, 120.5, -340.25]

const jsBoundsRun = time('JS bounds', 60, () => jsBounds(points, matrix))
const wasmBoundsRun = time('WASM bounds', 60, () => bridge.computeBounds(points, matrix))

const haystackSize = 16 * 1024 * 1024
const haystack = new Uint8Array(haystackSize)
for (let index = 0; index < haystackSize; index += 1) haystack[index] = index % 251
const patterns = [
  '%AI12_CompressedData',
  '%AI24_ZStandard_Data',
  '%AI9_PrivateDataBegin',
  '%AI5_BeginLayer',
  '%%BoundingBox',
  '%%BeginData',
  '%%EndData',
  '%%EOF',
].map((text) => new TextEncoder().encode(text))
let insert = 0
while (insert + 32 < haystackSize) {
  haystack.set(patterns[insert / 4096 % patterns.length], insert)
  insert += 4096
}
const expectedCounts = patterns.map((pattern) => jsCountPattern(haystack, pattern))
const jsCountRun = time('JS count', 6, () =>
  patterns.reduce((sum, pattern) => sum + jsCountPattern(haystack, pattern), 0),
)
const wasmCountRun = time('WASM scan', 6, () => {
  const scan = bridge.scanPatterns(haystack, patterns)
  return scan ? scan.counts.reduce((sum, count) => sum + count, 0) : -1
})
const finalScan = bridge.scanPatterns(haystack, patterns)
const scanEqual =
  Boolean(finalScan) && finalScan.counts.every((count, index) => count === expectedCounts[index])

const boundsMatch =
  Math.abs(jsBoundsRun.result.x - wasmBoundsRun.result.x) < 1e-9 &&
  Math.abs(jsBoundsRun.result.y - wasmBoundsRun.result.y) < 1e-9 &&
  Math.abs(jsBoundsRun.result.width - wasmBoundsRun.result.width) < 1e-9 &&
  Math.abs(jsBoundsRun.result.height - wasmBoundsRun.result.height) < 1e-9
const expectedCountSum = expectedCounts.reduce((sum, count) => sum + count, 0)

console.log('WASM benchmark')
console.log('----------------')
console.log(
  `bounds: JS ${jsBoundsRun.perRun.toFixed(3)} ms | WASM ${wasmBoundsRun.perRun.toFixed(3)} ms | speedup ${(jsBoundsRun.perRun / wasmBoundsRun.perRun).toFixed(2)}x | equal=${boundsMatch}`,
)
if (!scanEqual) {
  console.log('expectedCounts:', expectedCounts)
  console.log('actualCounts:  ', finalScan?.counts)
}
console.log(
  `scan:   JS ${jsCountRun.perRun.toFixed(3)} ms | WASM ${wasmCountRun.perRun.toFixed(3)} ms | speedup ${(jsCountRun.perRun / wasmCountRun.perRun).toFixed(2)}x | equal=${scanEqual} (${expectedCountSum} matches)`,
)
console.log(
  `WASM calls: scan=${bridge.scanCalls}, scanFallbacks=${bridge.scanFallbacks}, bounds=${bridge.boundsCalls}, boundsFallbacks=${bridge.boundsFallbacks}`,
)
