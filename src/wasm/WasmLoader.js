/**
 * WasmLoader
 * ----------------
 * 加载 public/wasm/ai_viewer_wasm.wasm。
 * 加载失败必须允许 JS 解析链路继续，不抛出到 UI。
 */

let cache = null

function defaultUrl() {
  if (typeof document !== 'undefined' && document.baseURI) {
    return new URL('wasm/ai_viewer_wasm.wasm', document.baseURI).href
  }
  return '/wasm/ai_viewer_wasm.wasm'
}

/**
 * @param {{ url?: string, bytes?: ArrayBuffer | Uint8Array }} [options]
 * @returns {Promise<WebAssembly.Exports>}
 */
export async function loadWasmModule(options = {}) {
  if (options.bytes) {
    const result = await WebAssembly.instantiate(
      options.bytes instanceof Uint8Array ? options.bytes : new Uint8Array(options.bytes),
      {},
    )
    return result.instance.exports
  }

  if (cache) return cache

  const url = options.url ?? defaultUrl()
  cache = (async () => {
    const response = await fetch(url, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`WASM HTTP ${response.status}`)
    const buffer = await response.arrayBuffer()
    const result = await WebAssembly.instantiate(buffer, {})
    return result.instance.exports
  })()

  try {
    return await cache
  } catch (error) {
    cache = null
    throw error
  }
}

export function clearWasmCache() {
  cache = null
}
