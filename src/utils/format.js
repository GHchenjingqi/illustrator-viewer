/**
 * 格式化辅助函数。
 */

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes
  let index = -1
  do {
    value /= 1024
    index += 1
  } while (value >= 1024 && index < units.length - 1)
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[index]}`
}

export function formatOffset(offset) {
  if (!Number.isInteger(offset) || offset < 0) return '—'
  return `0x${offset.toString(16).toUpperCase().padStart(8, '0')}`
}

export function formatPercent(ratio) {
  if (!Number.isFinite(ratio)) return '—'
  return `${Math.round(Math.min(Math.max(ratio, 0), 1) * 100)}%`
}

export function truncateMiddle(value, maxLength = 32) {
  const text = String(value ?? '')
  if (text.length <= maxLength) return text
  const half = Math.floor((maxLength - 1) / 2)
  return `${text.slice(0, half)}…${text.slice(-half)}`
}
