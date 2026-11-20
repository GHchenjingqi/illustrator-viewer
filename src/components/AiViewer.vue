<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { AIParserEngine } from '../core/AIParserEngine.js'
import { AIWorkerClient } from '../worker/AIWorkerClient.js'
import ScenePreview from './ScenePreview.vue'
import './viewer-base.css'

const props = defineProps({
  file: { type: Object, default: null },
  width: { type: [Number, String], default: '100%' },
  height: { type: [Number, String], default: 'auto' },
  zoom: { type: Boolean, default: true },
  draggable: { type: Boolean, default: true },
  fullscreen: { type: Boolean, default: true },
  maxFileSize: { type: Number, default: 512 * 1024 * 1024 },
  worker: { type: Boolean, default: true },
  wasmUrl: { type: String, default: '' },
  chrome: { type: Boolean, default: true },
})

const emit = defineEmits([
  'loaded',
  'error',
  'progress',
  'file-change',
  'zoom-change',
  'artboard-change',
  'compatibility',
])

const preview = ref(null)
const engine = new AIParserEngine({
  maxFileSize: props.maxFileSize,
  wasmUrl: props.wasmUrl || undefined,
})
const workerClient = new AIWorkerClient({
  fallbackEngine: engine,
  wasmUrl: props.wasmUrl || undefined,
})
const report = ref(null)
const error = ref(null)
const busy = ref(false)
const progress = ref({ phase: 'idle', ratio: 0, message: '' })
let controller = null

function styleSize(value) {
  return typeof value === 'number' ? `${value}px` : value
}

function reset() {
  controller?.abort()
  controller = null
  report.value = null
  error.value = null
  busy.value = false
  progress.value = { phase: 'idle', ratio: 0, message: '' }
}

async function load(file) {
  if (!file) {
    reset()
    return
  }

  controller?.abort()
  controller = new AbortController()
  busy.value = true
  report.value = null
  error.value = null
  progress.value = { phase: 'read', ratio: 0, message: '读取文件…' }
  emit('file-change', { file })

  const runner = props.worker ? workerClient : engine
  const result = await runner.parse(file, {
    signal: controller.signal,
    maxFileSize: props.maxFileSize,
    onProgress: (event) => {
      progress.value = { ...event }
      emit('progress', { ...event })
    },
  })

  if (controller.signal.aborted) return
  busy.value = false

  if (result.ok) {
    report.value = result.report
    progress.value = { phase: 'done', ratio: 1, message: '解析完成' }
    emit('loaded', { report: result.report, scene: result.report.scene })
    emit('compatibility', result.report.compatibility ?? null)
  } else if (!result.aborted) {
    error.value = result.error
    emit('error', result.error)
  }
}

function clear() {
  reset()
}

function cancel() {
  controller?.abort()
  controller = null
  busy.value = false
  progress.value = { phase: 'cancelled', ratio: 0, message: '已取消' }
}

function fit() {
  preview.value?.fit()
}

function actualSize() {
  preview.value?.actualSize()
}

watch(
  () => props.file,
  (file) => {
    if (file) load(file)
    else reset()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  controller?.abort()
  workerClient.terminate()
})

defineExpose({ load, clear, cancel, fit, actualSize, getReport: () => report.value })
</script>

<template>
  <div
    class="ai-viewer"
    :class="{ 'ai-viewer--minimal': !chrome }"
    :style="{ width: styleSize(width), height: styleSize(height) }"
  >
    <div v-if="busy" class="ai-viewer-state">
      <div class="ai-viewer-spinner"></div>
      <p>{{ progress.message || '解析中…' }}</p>
      <div class="ai-viewer-progress">
        <span :style="{ width: `${Math.round((progress.ratio ?? 0) * 100)}%` }"></span>
      </div>
    </div>

    <div v-else-if="error" class="ai-viewer-state ai-viewer-error">
      <strong>解析失败</strong>
      <p class="mono">{{ error.code }}</p>
      <p>{{ error.message }}</p>
      <button class="ai-viewer-btn" @click="clear">关闭</button>
    </div>

    <ScenePreview
      v-else-if="report?.scene"
      ref="preview"
      :scene="report.scene"
      :report="report"
      :zoom="zoom"
      :draggable="draggable"
      :fullscreen="fullscreen"
      :chrome="chrome"
      :canvas-height="height === 'auto' ? 520 : height"
      @zoom-change="(value) => emit('zoom-change', value)"
      @artboard-change="(value) => emit('artboard-change', value)"
    />

    <div v-else class="ai-viewer-state">
      <p>选择一个 AI 文件以预览</p>
    </div>
  </div>
</template>

<style scoped>
.ai-viewer {
  position: relative;
  min-height: 320px;
}

.ai-viewer-state {
  min-height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  background: rgba(10, 15, 27, 0.5);
  color: var(--text-dim);
  text-align: center;
}

.ai-viewer-state p {
  margin: 0;
  font-size: 13px;
}

.ai-viewer-error {
  border-color: rgba(251, 113, 133, 0.35);
  color: var(--red);
}

.ai-viewer-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid rgba(94, 234, 212, 0.2);
  border-top-color: var(--accent);
  animation: ai-viewer-spin 0.8s linear infinite;
}

@keyframes ai-viewer-spin {
  to {
    transform: rotate(360deg);
  }
}

.ai-viewer-progress {
  width: min(320px, 100%);
  height: 4px;
  border-radius: 999px;
  background: rgba(125, 155, 220, 0.12);
  overflow: hidden;
}

.ai-viewer-progress span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--violet));
  transition: width 0.2s ease;
}

.ai-viewer-btn {
  margin-top: 6px;
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  background: var(--panel-solid);
  color: var(--text);
  cursor: pointer;
}
</style>
