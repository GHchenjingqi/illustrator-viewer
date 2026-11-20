/**
 * 构建可发布的 npm 包。
 *
 * 产物（dist/）：
 *   illustrator-viewer.js      ESM 入口
 *   style.css                  组件样式
 *   wasm/ai_viewer_wasm.wasm   WASM 加速模块（可选）
 *   *.map                      源码映射
 *
 * 运行：npm run build
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const viteBin = resolve(root, 'node_modules/vite/bin/vite.js')
const config = resolve(root, 'vite.lib.config.js')

function fail(message) {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

function requireFile(relativePath, minBytes = 1) {
  const file = resolve(root, relativePath)
  if (!existsSync(file)) fail(`缺少构建产物：${relativePath}`)
  const size = statSync(file).size
  if (size < minBytes) fail(`构建产物为空：${relativePath}`)
  return size
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

if (!existsSync(viteBin)) fail('未安装 Vite，请先执行 npm install')

console.log('› 构建 npm 包（Vite library mode）')
const build = spawnSync(process.execPath, [viteBin, 'build', '--config', config], {
  cwd: root,
  stdio: 'inherit',
})

if (build.status !== 0) {
  fail(`Vite 构建失败（退出码 ${build.status ?? 'unknown'}）`)
}

const artifacts = [
  ['dist/illustrator-viewer.js', 10_000],
  ['dist/style.css', 100],
  ['dist/wasm/ai_viewer_wasm.wasm', 1_000],
]
const measured = artifacts.map(([file, min]) => [file, requireFile(file, min)])

// Worker 产物必须是自包含的：出现裸模块说明符会导致浏览器加载失败。
const bundle = readFileSync(resolve(root, 'dist/illustrator-viewer.js'), 'utf8')
if (/from\s+["']fzstd["']/.test(bundle)) {
  fail('入口产物仍包含未打包的 fzstd 依赖')
}

if (existsSync(resolve(root, 'dist/samples'))) {
  fail('发布产物不应包含演示用 public/samples')
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
if (pkg.private) fail('package.json 仍标记为 private，无法发布')
if (!pkg.exports?.['.']?.import) fail('package.json 缺少 exports["."].import')
if (!pkg.files?.includes('dist')) fail('package.json files 未包含 dist')

console.log('\n✓ npm 包构建完成')
for (const [file, size] of measured) {
  console.log(`  ${file.padEnd(38)} ${formatBytes(size)}`)
}
console.log('\n下一步：')
console.log('  npm pack --dry-run     # 检查发布内容')
console.log('  npm publish            # 发布到 npm')
