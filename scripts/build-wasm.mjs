#!/usr/bin/env node
/**
 * 构建自研 WASM 模块并复制到 public/wasm/。
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = join(root, 'wasm-src', 'Cargo.toml')
const target = join(
  root,
  'wasm-src',
  'target',
  'wasm32-unknown-unknown',
  'release',
  'ai_viewer_wasm.wasm',
)
const outputDir = join(root, 'public', 'wasm')
const output = join(outputDir, 'ai_viewer_wasm.wasm')

const result = spawnSync(
  'cargo',
  ['build', '--manifest-path', manifest, '--target', 'wasm32-unknown-unknown', '--release'],
  { stdio: 'inherit' },
)

if (result.status !== 0) {
  console.error('WASM 构建失败。请确认已安装 wasm32-unknown-unknown target。')
  process.exit(result.status ?? 1)
}

if (!existsSync(target)) {
  console.error(`未找到构建产物：${target}`)
  process.exit(1)
}

mkdirSync(outputDir, { recursive: true })
copyFileSync(target, output)
console.log(`WASM 已输出：public/wasm/ai_viewer_wasm.wasm (${statSync(output).size} bytes)`)
