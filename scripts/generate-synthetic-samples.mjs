/**
 * 生成“合成样本”（synthetic fixtures）。
 *
 * 这些文件只用于验证二进制检测链路，不是真实 Illustrator 导出文件，
 * 不得计入兼容性测试结果，也不得作为“支持某版本 AI”的证据。
 *
 * 生成目标：
 * - public/samples/*.bin      供开发页面按钮加载
 * - tests/fixtures/synthetic/ 供单元测试使用
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sampleDir = join(root, 'public', 'samples')
const fixtureDir = join(root, 'tests', 'fixtures', 'synthetic')

function buildPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>',
  ]

  let pdf = '%PDF-1.7\n%âãÏÓ\n'
  const offsets = [0]
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

const SYNTHETIC_PRIVATE_TEXT = [
  '%!PS-Adobe-3.0',
  '%%Creator: Adobe Illustrator(R) 24.0',
  '%%Title: Synthetic Stage-1 Structure Sample',
  '%AI9_FileData',
  '%AI12_PGF',
  '%AI5_BeginLayer',
  '1 0 0 1 0 0 0 1 0 0 1 0 0 1 0 0 0 0 0 0 0 0 1 0 0 1 0 0 0 0 0 0 1 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0',
  '% 合成样本：以下绘图指令仅用于检测演示，不是真实 PGF 数据',
  '0 0 m',
  '200 0 l',
  '200 120 l',
  '0 120 l',
  'h',
  '0 0 0 1 k',
  'f',
  '%AI5_EndLayer--',
  '%%EOF',
  '',
].join('\n')

const LEGACY_POSTSCRIPT = [
  '%!PS-Adobe-3.0',
  '%%Creator: Adobe Illustrator(R) 8.0',
  '%%Title: Synthetic Stage-1 Legacy Sample',
  '%%BoundingBox: 0 0 595 842',
  '%%Pages: 1',
  '%%EndComments',
  '%%EndProlog',
  '%%EndSetup',
  '%AI5_BeginLayer',
  '% 合成样本：PostScript 结构演示',
  '0 0 m 200 0 l 200 120 l 0 120 l h',
  '%AI5_EndLayer--',
  'showpage',
  '%%EOF',
  '',
].join('\n')

function encodeAscii85(bytes) {
  const chunks = ['<~']
  let line = ''
  const flush = () => {
    if (line) chunks.push(line)
    line = ''
  }

  for (let i = 0; i < bytes.length; i += 4) {
    const group = [bytes[i] ?? 0, bytes[i + 1] ?? 0, bytes[i + 2] ?? 0, bytes[i + 3] ?? 0]
    const remaining = Math.min(4, bytes.length - i)

    if (remaining === 4 && group.every((byte) => byte === 0)) {
      line += 'z'
      if (line.length >= 76) flush()
      continue
    }

    let value =
      ((group[0] << 24) >>> 0) + (group[1] << 16) + (group[2] << 8) + group[3]
    const digits = new Array(5)
    for (let index = 4; index >= 0; index -= 1) {
      digits[index] = String.fromCharCode(33 + (value % 85))
      value = Math.floor(value / 85)
    }
    line += digits.slice(0, remaining + 1).join('')
    if (line.length >= 76) flush()
  }

  flush()
  chunks.push('~>')
  return chunks.join('\n')
}

function buildAi9Eps() {
  const privateText = [
    '%AI9_PrivateData',
    '%AI5_BeginLayer',
    '% 合成样本：AI9 私有数据（ASCII85 + zlib）',
    '0 0 m 100 0 l 100 100 l 0 100 l h',
    '%AI5_EndLayer--',
    '',
  ].join('\n')
  const compressed = deflateSync(Buffer.from(privateText, 'latin1'))
  const encoded = encodeAscii85(compressed)
  const wrapped = encoded
    .split('\n')
    .map((line, index) => (index === 0 || line === '~>' ? line : `% ${line}`))
    .join('\n')

  const eps = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    '%%Creator: Adobe Illustrator(R) 11.0',
    '%%Title: Synthetic Stage-1 AI9 EPS Sample',
    '%%BoundingBox: 0 0 300 200',
    '%%EndComments',
    '%%EndProlog',
    '%%EndSetup',
    '%AI9_PrivateDataBegin',
    wrapped,
    '%AI9_PrivateDataEnd',
    '%%EOF',
    '',
  ].join('\n')

  return Buffer.from(eps, 'latin1')
}

function buildAi12Pdf() {
  const pdf = buildPdf()
  const compressed = deflateSync(Buffer.from(SYNTHETIC_PRIVATE_TEXT, 'latin1'))
  return Buffer.concat([
    pdf,
    Buffer.from('\n%AI12_CompressedData\n', 'latin1'),
    compressed,
    Buffer.from('\n%AI12_EndCompressedData\n%%EOF\n', 'latin1'),
  ])
}

function buildTruncatedPdf() {
  return Buffer.from(
    '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% 文件在此处被截断，没有 xref 结束标记\n',
    'latin1',
  )
}

const samples = [
  {
    name: 'synthetic-ai12-pdf.bin',
    kind: 'pdf-ai12',
    description: '合成 PDF 容器 + AI12 zlib 私有数据块（仅结构检测演示）',
    bytes: buildAi12Pdf(),
  },
  {
    name: 'synthetic-legacy-ps.bin',
    kind: 'eps-postscript8',
    description: '合成 Illustrator 8 风格 PostScript / EPS 文本（仅结构检测演示）',
    bytes: Buffer.from(LEGACY_POSTSCRIPT, 'latin1'),
  },
  {
    name: 'synthetic-ai9-eps.bin',
    kind: 'eps-ai9-ascii85-zlib',
    description: '合成 EPS + AI9 ASCII85/zlib 私有数据（仅结构检测演示）',
    bytes: buildAi9Eps(),
  },
  {
    name: 'synthetic-truncated-pdf.bin',
    kind: 'pdf-truncated',
    description: '合成截断 PDF（用于验证错误处理，不崩溃）',
    bytes: buildTruncatedPdf(),
  },
]

for (const directory of [sampleDir, fixtureDir]) {
  mkdirSync(directory, { recursive: true })
}

const manifest = {
  warning:
    'SYNTHETIC FIXTURES ONLY. 这些文件由 scripts/generate-synthetic-samples.mjs 生成，不是 Illustrator 导出文件，不能作为兼容性证据。',
  generatedBy: 'scripts/generate-synthetic-samples.mjs',
  samples: [],
}

for (const sample of samples) {
  for (const directory of [sampleDir, fixtureDir]) {
    writeFileSync(join(directory, sample.name), sample.bytes)
  }
  manifest.samples.push({
    name: sample.name,
    kind: sample.kind,
    description: sample.description,
    size: sample.bytes.byteLength,
    sha256: createHash('sha256').update(sample.bytes).digest('hex'),
  })
}

writeFileSync(join(fixtureDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(join(sampleDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(
  join(sampleDir, 'README.md'),
  [
    '# 合成样本（非真实 AI 文件）',
    '',
    '本目录文件由 `npm run generate:samples` 生成，只用于验证结构检测流程。',
    '它们**不是** Adobe Illustrator 导出的真实文件，不能作为解析兼容性证据。',
    '真实样本请放入 `tests/fixtures/real/`，登记方式见该目录 README。',
    '',
    `样本清单见 [manifest.json](./manifest.json)。`,
    '',
  ].join('\n'),
)

console.log(`已生成 ${samples.length} 个合成样本 → public/samples, tests/fixtures/synthetic`)
for (const sample of manifest.samples) {
  console.log(`  - ${sample.name} (${sample.size} bytes, ${sample.sha256.slice(0, 12)}…)`)
}
