/**
 * WasmBridge
 * ----------------
 * JS ↔ WASM 的显式内存接口。
 * - 所有数据通过 alloc/dealloc 显式管理
 * - 任何失败都返回 null，由 JS 回退
 * - 不持有 Canvas / DOM 引用
 */

import { loadWasmModule } from './WasmLoader.js'

const F64_BYTES = 8

export class WasmBridge {
  /**
   * @param {{ enabled?: boolean, bytes?: ArrayBuffer | Uint8Array, url?: string }} [options]
   */
  constructor(options = {}) {
    this.enabled = options.enabled !== false
    this.bytes = options.bytes
    this.url = options.url
    this.exports = null
    this.ready = false
    this.failed = false
    this.error = null
    this.boundsCalls = 0
    this.boundsFallbacks = 0
    this.scanCalls = 0
    this.scanFallbacks = 0
    this._initPromise = null
  }

  async init() {
    if (!this.enabled) {
      this.failed = true
      this.error = 'WASM disabled'
      return false
    }
    if (this.ready) return true
    if (this._initPromise) return this._initPromise

    this._initPromise = (async () => {
      try {
        const exports = await loadWasmModule({ bytes: this.bytes, url: this.url })
        if (
          typeof exports.alloc_bytes !== 'function' ||
          typeof exports.dealloc_bytes !== 'function' ||
          typeof exports.compute_bounds !== 'function'
        ) {
          throw new Error('WASM 导出接口不完整')
        }
        this.exports = exports
        this.ready = true
        return true
      } catch (error) {
        this.failed = true
        this.error = error instanceof Error ? error.message : String(error)
        this.ready = false
        return false
      }
    })()

    return this._initPromise
  }

  _memory() {
    return this.exports?.memory
  }

  /**
   * @param {Float64Array} points x,y 交错
   * @param {number[]} matrix 六元组
   * @returns {{ x: number, y: number, width: number, height: number } | null}
   */
  computeBounds(points, matrix) {
    if (!this.ready || !(points instanceof Float64Array) || points.length < 2) {
      this.boundsFallbacks += 1
      return null
    }
    if (!Array.isArray(matrix) || matrix.length !== 6) {
      this.boundsFallbacks += 1
      return null
    }

    const exports = this.exports
    const memory = this._memory()
    const pointBytes = points.byteLength
    const matrixBytes = 6 * F64_BYTES
    const outBytes = 4 * F64_BYTES

    let pointPtr = 0
    let matrixPtr = 0
    let outPtr = 0

    try {
      pointPtr = exports.alloc_bytes(pointBytes)
      matrixPtr = exports.alloc_bytes(matrixBytes)
      outPtr = exports.alloc_bytes(outBytes)
      if (!pointPtr || !matrixPtr || !outPtr) throw new Error('WASM 内存分配失败')

      new Float64Array(memory.buffer, pointPtr, points.length).set(points)
      new Float64Array(memory.buffer, matrixPtr, 6).set(matrix)

      const ok = exports.compute_bounds(pointPtr, points.length, matrixPtr, outPtr)
      if (!ok) throw new Error('WASM compute_bounds 返回失败')

      const out = new Float64Array(memory.buffer, outPtr, 4)
      this.boundsCalls += 1
      return {
        x: out[0],
        y: out[1],
        width: out[2] - out[0],
        height: out[3] - out[1],
      }
    } catch {
      this.boundsFallbacks += 1
      return null
    } finally {
      if (pointPtr) exports.dealloc_bytes(pointPtr, pointBytes)
      if (matrixPtr) exports.dealloc_bytes(matrixPtr, matrixBytes)
      if (outPtr) exports.dealloc_bytes(outPtr, outBytes)
    }
  }

  /**
   * @param {Uint8Array} haystack
   * @param {Uint8Array} needle
   */
  countPattern(haystack, needle) {
    if (!this.ready || !(haystack instanceof Uint8Array) || !(needle instanceof Uint8Array)) {
      return null
    }
    if (needle.length === 0 || haystack.length < needle.length) return 0

    const exports = this.exports
    const memory = this._memory()
    let haystackPtr = 0
    let needlePtr = 0

    try {
      haystackPtr = exports.alloc_bytes(haystack.byteLength)
      needlePtr = exports.alloc_bytes(needle.byteLength)
      if (!haystackPtr || !needlePtr) throw new Error('WASM 内存分配失败')
      new Uint8Array(memory.buffer, haystackPtr, haystack.length).set(haystack)
      new Uint8Array(memory.buffer, needlePtr, needle.length).set(needle)
      return exports.count_pattern(haystackPtr, haystack.length, needlePtr, needle.length)
    } catch {
      return null
    } finally {
      if (haystackPtr) exports.dealloc_bytes(haystackPtr, haystack.byteLength)
      if (needlePtr) exports.dealloc_bytes(needlePtr, needle.byteLength)
    }
  }

  /**
   * 多模式扫描（Aho-Corasick，一次遍历）。
   * @param {Uint8Array} haystack
   * @param {Uint8Array[]} patterns
   * @returns {{ counts: number[], first: number[] } | null}
   */
  scanPatterns(haystack, patterns) {
    if (
      !this.ready ||
      !(haystack instanceof Uint8Array) ||
      !Array.isArray(patterns) ||
      patterns.length === 0 ||
      patterns.length > 64
    ) {
      this.scanFallbacks += 1
      return null
    }
    if (!patterns.every((pattern) => pattern instanceof Uint8Array && pattern.length > 0)) {
      this.scanFallbacks += 1
      return null
    }

    const exports = this.exports
    const memory = this._memory()
    const blobLength =
      4 + patterns.reduce((sum, pattern) => sum + 4 + pattern.byteLength, 0)
    const countsBytes = patterns.length * 4
    const firstsBytes = patterns.length * 4

    let haystackPtr = 0
    let blobPtr = 0
    let countsPtr = 0
    let firstsPtr = 0

    try {
      haystackPtr = exports.alloc_bytes(haystack.byteLength)
      blobPtr = exports.alloc_bytes(blobLength)
      countsPtr = exports.alloc_bytes(countsBytes)
      firstsPtr = exports.alloc_bytes(firstsBytes)
      if (!haystackPtr || !blobPtr || !countsPtr || !firstsPtr) {
        throw new Error('WASM 内存分配失败')
      }

      new Uint8Array(memory.buffer, haystackPtr, haystack.length).set(haystack)

      const blob = new Uint8Array(blobLength)
      const view = new DataView(blob.buffer)
      view.setUint32(0, patterns.length, true)
      let offset = 4
      for (const pattern of patterns) {
        view.setUint32(offset, pattern.byteLength, true)
        offset += 4
        blob.set(pattern, offset)
        offset += pattern.byteLength
      }
      new Uint8Array(memory.buffer, blobPtr, blobLength).set(blob)

      const ok = exports.scan_patterns(
        haystackPtr,
        haystack.length,
        blobPtr,
        blobLength,
        countsPtr,
        firstsPtr,
        patterns.length,
      )
      if (!ok) throw new Error('WASM scan_patterns 返回失败')

      const counts = new Uint32Array(memory.buffer, countsPtr, patterns.length)
      const firsts = new Int32Array(memory.buffer, firstsPtr, patterns.length)
      this.scanCalls += 1
      return {
        counts: Array.from(counts),
        first: Array.from(firsts),
      }
    } catch {
      this.scanFallbacks += 1
      return null
    } finally {
      if (haystackPtr) exports.dealloc_bytes(haystackPtr, haystack.byteLength)
      if (blobPtr) exports.dealloc_bytes(blobPtr, blobLength)
      if (countsPtr) exports.dealloc_bytes(countsPtr, countsBytes)
      if (firstsPtr) exports.dealloc_bytes(firstsPtr, firstsBytes)
    }
  }

  getStatus() {
    return {
      enabled: this.enabled,
      ready: this.ready,
      failed: this.failed,
      error: this.error,
      boundsCalls: this.boundsCalls,
      boundsFallbacks: this.boundsFallbacks,
      scanCalls: this.scanCalls,
      scanFallbacks: this.scanFallbacks,
    }
  }
}
