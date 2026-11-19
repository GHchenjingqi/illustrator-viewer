/**
 * 字节保持型 Latin-1 解码。
 *
 * 注意：WHATWG 的 TextDecoder('latin1') 实际按 windows-1252 解码，
 * 会把 0x80–0x9F 映射成 U+201C 之类的字符，破坏 Illustrator 私有数据中的
 * UTF-8 名称字节。这里逐字节映射 0x00–0xFF，确保后续可以还原原始字节。
 */

const CHUNK_SIZE = 8192

/**
 * @param {ArrayBuffer | ArrayBufferView} input
 * @returns {string}
 */
export function decodeLatin1(input) {
  const bytes =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)

  let result = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length))
    result += String.fromCharCode.apply(null, chunk)
  }
  return result
}

/**
 * 把“按字节保存的字符串”按 UTF-8 重新解码；失败时返回原字符串。
 * 用于 AI 私有数据中的图层名、画板名、渐变名等。
 * @param {string} value
 */
export function decodeMaybeUtf8(value) {
  if (typeof value !== 'string' || value.length === 0) return value
  let canBeUtf8 = false
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) >= 0x80) {
      canBeUtf8 = true
      break
    }
  }
  if (!canBeUtf8) return value

  const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return value
  }
}
