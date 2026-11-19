#!/usr/bin/env node
/**
 * 命令行结构检测工具（阶段 1）。
 *
 * 用法：
 *   npm run inspect -- path/to/file.ai
 *   npm run inspect -- path/to/file.ai --write
 *
 * --write 会在源文件旁生成 `<file>.report.json`，用于登记真实测试样本。
 * 该工具只读取文件，不修改源文件。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { AIParserEngine } from '../src/core/AIParserEngine.js'

const args = process.argv.slice(2)
const shouldWrite = args.includes('--write')
const target = args.find((argument) => !argument.startsWith('--'))

if (!target) {
  console.error('用法: npm run inspect -- <file.ai> [--write]')
  process.exitCode = 1
} else {
  const path = resolve(target)
  let bytes
  try {
    bytes = readFileSync(path)
  } catch (error) {
    console.error(`无法读取文件 ${path}: ${error.message}`)
    process.exitCode = 2
  }

  if (bytes) {
    const engine = new AIParserEngine()
    const result = await engine.parse(new Uint8Array(bytes), { fileName: basename(path) })

    if (!result.ok) {
      console.error(JSON.stringify(result.error, null, 2))
      process.exitCode = 3
    } else {
      console.log(JSON.stringify(result.report, null, 2))

      if (shouldWrite) {
        const outputPath = `${path}.report.json`
        writeFileSync(outputPath, `${JSON.stringify(result.report, null, 2)}\n`)
        console.error(`检测报告已写入：${outputPath}`)
      }
    }
  }
}
