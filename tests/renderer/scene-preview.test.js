import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ScenePreview from '../../src/components/ScenePreview.vue'

const scene = {
  type: 'document',
  artboards: [
    {
      type: 'artboard',
      id: 'a1',
      name: '画板 1',
      width: 100,
      height: 100,
      rect: { x: 0, y: 0, width: 100, height: 100 },
      children: [],
    },
  ],
  approximateFillCount: 2,
  unsupportedFeatures: [],
}

async function renderPreview(props) {
  const app = createSSRApp({
    render: () => h(ScenePreview, { scene, ...props }),
  })
  return renderToString(app)
}

describe('ScenePreview chrome', () => {
  it('默认显示标题、提示和统计', async () => {
    const html = await renderPreview({})
    expect(html).toContain('panel-head')
    expect(html).toContain('preview-footer')
    expect(html).toContain('canvas-hint')
    expect(html).toContain('部分预览')
    expect(html).not.toContain('preview-panel--minimal')
  })

  it('chrome=false 时只渲染画布', async () => {
    const html = await renderPreview({ chrome: false })
    expect(html).toContain('preview-panel--minimal')
    expect(html).toContain('canvas-wrap--minimal')
    expect(html).not.toContain('panel-head')
    expect(html).not.toContain('preview-footer')
    expect(html).not.toContain('canvas-hint')
    expect(html).not.toContain('部分预览')
  })
})
