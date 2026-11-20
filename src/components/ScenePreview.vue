<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CanvasRenderer } from '../renderer/CanvasRenderer.js'

const props = defineProps({
  scene: { type: Object, default: null },
  report: { type: Object, default: null },
  zoom: { type: Boolean, default: true },
  draggable: { type: Boolean, default: true },
  fullscreen: { type: Boolean, default: true },
  canvasHeight: { type: [String, Number], default: 520 },
})

const emit = defineEmits(['zoom-change', 'artboard-change'])

const canvas = ref(null)
const wrapper = ref(null)
const renderer = ref(null)
const artboardIndex = ref(0)
const scalePercent = ref(100)
const renderStats = ref({})
const dragging = ref(false)
const lastPointer = ref({ x: 0, y: 0 })
let resizeObserver = null
let lastZoomPercent = null

const artboards = computed(() => props.scene?.artboards ?? [])
const artboard = computed(() => artboards.value[artboardIndex.value] ?? null)

const approximate = computed(() => {
  const approximateFills = props.scene?.approximateFillCount ?? 0
  const unsupported = props.scene?.unsupportedFeatures?.length ?? 0
  const raster = props.report?.graphics?.stats?.rasterImages ?? 0
  return approximateFills > 0 || raster > 0 || unsupported > 0
})

const previewNote = computed(() => {
  const notes = []
  if ((props.scene?.approximateFillCount ?? 0) > 0) {
    notes.push(`${props.scene.approximateFillCount} 个渐变/专色使用近似颜色`)
  }
  if ((props.report?.graphics?.stats?.rasterImages ?? 0) > 0) {
    notes.push(`${props.report.graphics.stats.rasterImages} 个嵌入图片未渲染`)
  }
  if ((props.report?.graphics?.stats?.clipOperators ?? 0) > 0) {
    notes.push('裁剪路径未生效')
  }
  if ((props.report?.graphics?.unsupportedFeatures ?? []).some((item) => item.feature === 'appearance')) {
    notes.push('透明度/外观效果未渲染')
  }
  return notes
})

function updateStats() {
  if (!renderer.value) return
  renderStats.value = { ...renderer.value.stats }
  scalePercent.value = renderer.value.getScalePercent()
  if (scalePercent.value !== lastZoomPercent) {
    lastZoomPercent = scalePercent.value
    emit('zoom-change', scalePercent.value)
  }
}

function render() {
  if (!renderer.value) return
  renderer.value.render()
  updateStats()
}

function fit() {
  renderer.value?.fit()
  updateStats()
}

function actualSize() {
  renderer.value?.actualSize()
  updateStats()
}

function zoomBy(factor) {
  if (!renderer.value || !wrapper.value) return
  const rect = canvas.value.getBoundingClientRect()
  renderer.value.zoomAt(factor, rect.width / 2, rect.height / 2)
  updateStats()
}

function changeArtboard() {
  renderer.value?.setArtboard(artboardIndex.value)
  updateStats()
  emit('artboard-change', {
    index: artboardIndex.value,
    artboard: artboards.value[artboardIndex.value] ?? null,
  })
}

function onWheel(event) {
  if (!renderer.value || !props.zoom) return
  const rect = canvas.value.getBoundingClientRect()
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
  renderer.value.zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top)
  updateStats()
}

function onPointerDown(event) {
  if (event.button !== 0 || !props.draggable) return
  dragging.value = true
  lastPointer.value = { x: event.clientX, y: event.clientY }
  canvas.value.setPointerCapture?.(event.pointerId)
}

function onPointerMove(event) {
  if (!dragging.value || !renderer.value) return
  const dx = event.clientX - lastPointer.value.x
  const dy = event.clientY - lastPointer.value.y
  lastPointer.value = { x: event.clientX, y: event.clientY }
  renderer.value.panBy(dx, dy)
  updateStats()
}

function onPointerUp(event) {
  dragging.value = false
  canvas.value.releasePointerCapture?.(event.pointerId)
}

async function toggleFullscreen() {
  if (!wrapper.value) return
  if (document.fullscreenElement) {
    await document.exitFullscreen()
  } else {
    await wrapper.value.requestFullscreen?.()
  }
}

function onFullscreenChange() {
  nextTick(() => {
    renderer.value?.resize()
    updateStats()
  })
}

function setupRenderer() {
  if (!canvas.value || !props.scene) return
  if (renderer.value) renderer.value.destroy()
  renderer.value = new CanvasRenderer(canvas.value, { padding: 36 })
  renderer.value.setDocument(props.scene)
  artboardIndex.value = 0
  updateStats()
}

onMounted(() => {
  setupRenderer()
  if (typeof ResizeObserver !== 'undefined' && wrapper.value) {
    resizeObserver = new ResizeObserver(() => {
      renderer.value?.resize()
      updateStats()
    })
    resizeObserver.observe(wrapper.value)
  }
  document.addEventListener('fullscreenchange', onFullscreenChange)
})

watch(
  () => props.scene,
  () => {
    setupRenderer()
  },
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  renderer.value?.destroy()
  renderer.value = null
})

defineExpose({
  fit,
  actualSize,
  zoomBy,
  render,
})
</script>

<template>
  <section class="panel preview-panel">
    <div class="panel-head">
      <div>
        <h2 class="panel-title">Canvas 预览（阶段 4）</h2>
        <p class="panel-sub">
          {{ artboard?.name ?? '无画板' }} · {{ artboard ? `${artboard.width} × ${artboard.height} pt` : '—' }}
        </p>
      </div>
      <div class="preview-actions">
        <select
          v-if="artboards.length > 1"
          v-model.number="artboardIndex"
          class="artboard-select"
          @change="changeArtboard"
        >
          <option v-for="(item, index) in artboards" :key="item.id" :value="index">
            {{ item.name }}
          </option>
        </select>
        <button v-if="zoom" class="mini-btn" title="缩小" @click="zoomBy(1 / 1.2)">−</button>
        <span v-if="zoom" class="zoom-label mono">{{ scalePercent }}%</span>
        <button v-if="zoom" class="mini-btn" title="放大" @click="zoomBy(1.2)">＋</button>
        <button v-if="zoom" class="mini-btn" @click="fit">适应</button>
        <button v-if="zoom" class="mini-btn" @click="actualSize">1:1</button>
        <button v-if="fullscreen" class="mini-btn" @click="toggleFullscreen">全屏</button>
      </div>
    </div>

    <div v-if="approximate" class="banner banner-warning inline-banner">
      <strong>部分预览</strong>
      <span>{{ previewNote.join('；') || '部分效果未完整还原' }}</span>
    </div>

    <div ref="wrapper" class="canvas-wrap" :style="{ height: typeof canvasHeight === 'number' ? `${canvasHeight}px` : canvasHeight }">
      <canvas
        ref="canvas"
        class="preview-canvas"
        :class="{ dragging }"
        @wheel.prevent="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      ></canvas>
      <span class="canvas-hint">
        {{ zoom && draggable ? '滚轮缩放 · 拖拽平移' : zoom ? '滚轮缩放' : draggable ? '拖拽平移' : '' }}
      </span>
    </div>

    <div class="preview-footer">
      <span class="muted small">
        已绘制 {{ renderStats.shapesDrawn ?? 0 }} 个图形 ·
        {{ renderStats.groupsVisited ?? 0 }} 个组 ·
        {{ renderStats.compoundGroups ?? 0 }} 个复合路径 ·
        {{ renderStats.clipMaskGroups ?? 0 }} 个剪裁蒙版
      </span>
      <span v-if="renderStats.approximateShapes" class="approx-note">
        其中 {{ renderStats.approximateShapes }} 个使用近似颜色
      </span>
    </div>
  </section>
</template>

<style scoped>
.preview-panel {
  margin-top: 16px;
}

.preview-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.artboard-select {
  max-width: 150px;
  padding: 4px 8px;
  border-radius: 7px;
  border: 1px solid var(--border-strong);
  background: var(--panel-solid);
  color: var(--text);
  font-size: 11px;
}

.zoom-label {
  min-width: 44px;
  text-align: center;
  font-size: 11px;
  color: var(--text-dim);
}

.canvas-wrap {
  position: relative;
  height: 520px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background:
    linear-gradient(45deg, rgba(255, 255, 255, 0.025) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.025) 75%),
    linear-gradient(45deg, rgba(255, 255, 255, 0.025) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.025) 75%),
    #0a0f1b;
  background-position: 0 0, 12px 12px;
  background-size: 24px 24px;
  overflow: hidden;
}

.canvas-wrap:fullscreen {
  height: 100%;
  border: none;
  border-radius: 0;
  background-color: #0a0f1b;
}

.preview-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
}

.preview-canvas.dragging {
  cursor: grabbing;
}

.canvas-hint {
  position: absolute;
  right: 12px;
  bottom: 10px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(6, 8, 15, 0.7);
  border: 1px solid var(--border);
  color: var(--text-faint);
  font-size: 10px;
  pointer-events: none;
}

.preview-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.approx-note {
  color: var(--amber);
  font-size: 11px;
}

.inline-banner {
  margin-bottom: 12px;
}

@media (max-width: 700px) {
  .canvas-wrap {
    height: 380px;
  }
}
</style>
