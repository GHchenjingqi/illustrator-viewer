import { describe, expect, it } from 'vitest'
import AiViewer from '../../src/components/AiViewer.vue'
import ScenePreview from '../../src/components/ScenePreview.vue'

describe('AiViewer 组件', () => {
  it('可以独立导入（模板编译通过）', () => {
    expect(AiViewer).toBeTruthy()
    expect(ScenePreview).toBeTruthy()
  })
})
