import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const syntheticPath = fileURLToPath(
  new URL('../fixtures/synthetic/synthetic-ai12-pdf.bin', import.meta.url),
)
const legacyPath = fileURLToPath(
  new URL('../fixtures/synthetic/synthetic-legacy-ps.bin', import.meta.url),
)
const truncatedPath = fileURLToPath(
  new URL('../fixtures/synthetic/synthetic-truncated-pdf.bin', import.meta.url),
)
const realPath = fileURLToPath(new URL('../fixtures/real/lengdong-logo.ai', import.meta.url))
const hasRealSample = existsSync(realPath)

async function upload(page, path) {
  await page.goto('/')
  await page.addStyleTag({
    content: 'html { scrollbar-width: none; } ::-webkit-scrollbar { display: none; }',
  })
  const input = page.locator('input[type="file"]')
  await input.setInputFiles(path)
  await expect(page.getByText('Canvas 预览')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.summary-text')).toBeVisible()
}

async function canvasNonWhitePixels(page) {
  return page.locator('.preview-canvas').evaluate((canvas) => {
    const context = canvas.getContext('2d')
    const width = canvas.width
    const height = canvas.height
    const data = context.getImageData(0, 0, width, height).data
    let nonWhite = 0
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245) {
        nonWhite += 1
      }
    }
    return { width, height, nonWhite }
  })
}

test('合成 AI12 样本：解析、Worker、Canvas 渲染与图像对比', async ({ page }) => {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await upload(page, syntheticPath)
  await expect(page.getByText('部分支持').first()).toBeVisible()
  await expect(page.locator('.summary-tags')).toContainText('矢量 2')
  await expect(page.locator('.summary-tags')).toContainText('Worker')

  const pixels = await canvasNonWhitePixels(page)
  expect(pixels.width).toBeGreaterThan(0)
  expect(pixels.nonWhite).toBeGreaterThan(0)

  await expect(page.locator('.canvas-wrap')).toHaveScreenshot('synthetic-ai12.png')
  expect(errors).toEqual([])
})

test('工具栏：缩放、适应、1:1', async ({ page }) => {
  await upload(page, syntheticPath)
  const zoomLabel = page.locator('.zoom-label')
  const original = await zoomLabel.innerText()

  await page.getByRole('button', { name: '＋' }).click()
  await expect(zoomLabel).not.toHaveText(original)

  await page.getByRole('button', { name: '适应' }).click()
  await expect(zoomLabel).toContainText('%')

  await page.getByRole('button', { name: '1:1' }).click()
  await expect(zoomLabel).toContainText('%')
})

test('文件切换：旧结果不覆盖新结果', async ({ page }) => {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await upload(page, syntheticPath)
  const input = page.locator('input[type="file"]')
  await input.setInputFiles(legacyPath)
  await expect(page.locator('.kv').first()).toContainText('synthetic-legacy-ps.bin', { timeout: 30_000 })
  await expect(page.locator('.summary-text')).toContainText('EPS')

  await input.setInputFiles(syntheticPath)
  await expect(page.locator('.kv').first()).toContainText('synthetic-ai12-pdf.bin', { timeout: 30_000 })
  expect(errors).toEqual([])
})

test('截断 PDF：输出诊断而不崩溃', async ({ page }) => {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(truncatedPath)
  await expect(page.getByText('诊断信息')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.diagnostic-code', { hasText: 'TRUNCATED_FILE' })).toBeVisible()
  await expect(page.locator('.error-panel')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('真实 AI24 样本：841 图形、原生画板、近似颜色提示', async ({ page }) => {
  test.skip(!hasRealSample, '真实样本未提供')
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  const started = Date.now()
  await upload(page, realPath)
  const elapsed = Date.now() - started

  await expect(page.locator('.summary-tags')).toContainText('原生画板 1')
  await expect(page.locator('.summary-tags')).toContainText('WASM 扫描')
  await expect(page.locator('.summary-tags')).toContainText('Worker')
  await expect(page.locator('.summary-tags')).toContainText('矢量 841')
  await expect(page.locator('.preview-panel .inline-banner')).toContainText('部分预览')
  await expect(page.locator('.preview-footer')).toContainText('841')

  const pixels = await canvasNonWhitePixels(page)
  expect(pixels.nonWhite).toBeGreaterThan(1000)
  expect(elapsed).toBeLessThan(20_000)
  test.info().annotations.push({ type: 'parse+render', description: `${elapsed} ms` })
  expect(errors).toEqual([])
})
