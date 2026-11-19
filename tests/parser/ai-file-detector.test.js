import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ContainerKind, detectStructure } from '../../src/core/AIFileDetector.js'
import { ErrorCodes } from '../../src/utils/errors.js'

const fixture = (name) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/synthetic/${name}`, import.meta.url)))

function buildDosEps() {
  const ps = Buffer.from('%!PS-Adobe-3.0\n%%BoundingBox: 0 0 10 10\n%%EOF\n', 'latin1')
  const header = Buffer.alloc(32)
  Buffer.from([0xc5, 0xd0, 0xd3, 0xc6]).copy(header, 0)
  header.writeUInt32LE(32, 4)
  header.writeUInt32LE(ps.length, 8)
  return new Uint8Array(Buffer.concat([header, ps]))
}

describe('detectStructure - PDF + AI12 私有数据', () => {
  it('识别 PDF 容器、版本、zlib 私有数据', async () => {
    const report = await detectStructure(fixture('synthetic-ai12-pdf.bin'), {
      fileName: 'synthetic-ai12-pdf.bin',
    })

    expect(report.stage).toBe(1)
    expect(report.detection.container).toBe(ContainerKind.PDF)
    expect(report.detection.pdfVersion).toBe('1.7')
    expect(report.detection.creator).toBe('24.0')
    expect(report.detection.creatorSource).toBe('private-data')
    expect(report.detection.aiFormatVersion).toBe(12)
    expect(report.detection.aiFormatLabel).toBe('AI 私有格式标记 AI12')
    expect(report.detection.creatorLabel).toBe('Adobe Illustrator 24')
    expect(report.detection.confidence).toBe('high')

    expect(report.structure.hasPdf).toBe(true)
    expect(report.structure.hasPrivateData).toBe(true)
    expect(report.structure.hasCompressedData).toBe(true)

    expect(report.privateData.status).toBe('decoded')
    expect(report.privateData.compression).toBe('zlib')
    expect(report.privateData.decodedBytes).toBeGreaterThan(0)
    expect(report.privateData.decodedMarkers.map((marker) => marker.id)).toContain('ai5BeginLayer')
    expect(report.privateData.decodedMarkers.map((marker) => marker.id)).toContain('ai12Pgf')
    expect(report.privateData.preview).toContain('Synthetic Stage-1')

    // 阶段 1 不得声称任何图形能力
    expect(report.capabilities.postScriptParsing).toBe(false)
    expect(report.capabilities.pgfParsing).toBe(false)
    expect(report.capabilities.sceneGraph).toBe(false)
    expect(report.capabilities.canvasRendering).toBe(false)
    expect(report.capabilities.pdfPreviewImageExtraction).toBe(false)
  })

  it('同名文件包含可重复的 SHA-256（由调用方注入）', async () => {
    const report = await detectStructure(fixture('synthetic-ai12-pdf.bin'), {
      sha256: 'abc123',
    })
    expect(report.file.sha256).toBe('abc123')
  })

  it('扫描窗口覆盖整个小文件', async () => {
    const bytes = fixture('synthetic-ai12-pdf.bin')
    const report = await detectStructure(bytes)
    expect(report.scan.truncated).toBe(false)
    expect(report.scan.scannedBytes).toBe(bytes.byteLength)
  })
})

describe('detectStructure - 旧版 PostScript / EPS', () => {
  it('识别 PostScript Creator 与 BoundingBox（EPS）', async () => {
    const report = await detectStructure(fixture('synthetic-legacy-ps.bin'))
    expect(report.detection.container).toBe(ContainerKind.EPS)
    expect(report.detection.variant).toBe('eps-ps')
    expect(report.detection.creator).toBe('8.0')
    expect(report.detection.creatorLabel).toContain('Illustrator 8')
    expect(report.structure.hasPostScript).toBe(true)
    expect(report.structure.hasPrivateData).toBe(false)
    expect(report.privateData.status).toBe('absent')
    expect(report.markers.some((marker) => marker.id === 'psHeader' && marker.present)).toBe(true)
  })

  it('解析 DOS EPS 二进制头中的 PostScript 段偏移', async () => {
    const report = await detectStructure(buildDosEps())
    expect(report.detection.container).toBe(ContainerKind.EPS)
    expect(report.detection.variant).toBe('dos-eps')
    expect(report.diagnostics.some((item) => item.code === 'EPS_PS_SECTION')).toBe(true)
  })

  it('解码 AI9 ASCII85 + zlib 私有数据', async () => {
    const report = await detectStructure(fixture('synthetic-ai9-eps.bin'))
    expect(report.detection.container).toBe(ContainerKind.EPS)
    expect(report.privateData.status).toBe('decoded')
    expect(report.privateData.compression).toBe('ascii85+zlib')
    expect(report.privateData.marker).toBe('%AI9_PrivateDataBegin')
    expect(report.privateData.decodedMarkers.map((marker) => marker.id)).toContain('ai5BeginLayer')
    expect(report.detection.creator).toBe('11.0')
  })
})

describe('detectStructure - 异常与边界', () => {
  it('截断 PDF 不崩溃，并输出诊断', async () => {
    const report = await detectStructure(fixture('synthetic-truncated-pdf.bin'))
    expect(report.detection.container).toBe(ContainerKind.PDF)
    expect(report.detection.confidence).toBe('medium')
    expect(report.diagnostics.map((item) => item.code)).toContain('TRUNCATED_FILE')
    expect(report.diagnostics.map((item) => item.code)).toContain('PDF_WITHOUT_PRIVATE_DATA')
  })

  it('未知二进制返回 unknown 容器而不是抛异常', async () => {
    const report = await detectStructure(new TextEncoder().encode('not an illustrator file'))
    expect(report.detection.container).toBe(ContainerKind.UNKNOWN)
    expect(report.detection.confidence).toBe('low')
    expect(report.diagnostics.some((item) => item.code === 'UNKNOWN_CONTAINER')).toBe(true)
    expect(report.capabilities.structureDetection).toBe(true)
  })

  it('空文件抛出结构化错误', async () => {
    await expect(detectStructure(new Uint8Array([]))).rejects.toMatchObject({
      code: ErrorCodes.EMPTY_FILE,
    })
  })

  it('关闭私有数据解码时保留标记检测结果', async () => {
    const report = await detectStructure(fixture('synthetic-ai12-pdf.bin'), {
      decodePrivateData: false,
    })
    expect(report.structure.hasPrivateData).toBe(true)
    expect(report.privateData.status).toBe('skipped')
    expect(report.privateData.decodedBytes).toBe(0)
  })
})
