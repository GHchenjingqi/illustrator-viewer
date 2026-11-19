<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { AIParserEngine } from '../core/AIParserEngine.js'
import ScenePreview from './ScenePreview.vue'
import { formatBytes, formatOffset, formatPercent, truncateMiddle } from '../utils/format.js'

const engine = new AIParserEngine()
const fileInput = ref(null)
const report = ref(null)
const error = ref(null)
const busy = ref(false)
const synthetic = ref(false)
const dragging = ref(false)
const sampleLoading = ref(false)
const showAllMarkers = ref(false)
const copied = ref(false)
const progress = ref({ phase: 'idle', ratio: 0, message: '' })
const abortController = ref(null)

const CAPABILITY_DEFS = [
  { key: 'structureDetection', label: '文件结构检测', note: '阶段 1 已实现' },
  { key: 'privateDataExtraction', label: 'AI 私有数据定位', note: '阶段 1 已实现' },
  { key: 'privateDataDecode', label: '私有数据解压', note: 'zlib / ASCII85（Zstd 取决于环境）' },
  { key: 'postScriptParsing', label: 'PostScript 基础解析', note: '阶段 2：白名单操作符' },
  { key: 'vectorExtraction', label: '基础矢量提取', note: '阶段 2：路径 / 颜色 / 线型' },
  { key: 'artboardDetection', label: '画板边界识别', note: '阶段 2：仅边界推断' },
  { key: 'pgfParsing', label: 'PGF 原生图层解析', note: '实验性，未真实样本验证' },
  { key: 'sceneGraph', label: 'Scene Graph 构建', note: '阶段 3：图层/组/复合路径' },
  { key: 'canvasRendering', label: 'Canvas 矢量渲染', note: '阶段 4：渐变使用近似色' },
  { key: 'pdfPreviewImageExtraction', label: 'PDF 预览图提取', note: '明确不采用' },
]

const ROADMAP = [
  { n: 1, title: '初始化与格式研究', desc: '结构检测 / 版本识别 / 二进制读取', state: 'done' },
  { n: 2, title: '基础解析引擎', desc: 'PostScript / AI 私有操作符 / zstd', state: 'done' },
  { n: 3, title: 'Scene Graph', desc: '图层 / 组 / 复合路径 / 画板', state: 'done' },
  { n: 4, title: 'Canvas Renderer', desc: '矢量预览 / 缩放平移 / 部分颜色', state: 'done' },
  { n: 5, title: 'WebAssembly', desc: '多模式扫描加速 / JS 回退', state: 'done' },
  { n: 6, title: 'Worker 与组件', desc: '后台解析 / AiViewer.vue', state: 'next' },
  { n: 7, title: '兼容性与性能', desc: '多版本 / 多浏览器测试', state: 'todo' },
]

const statusText = computed(() => {
  if (busy.value) {
    if (progress.value.phase === 'graphics') return '提取矢量'
    return progress.value.phase === 'detect' ? '检测结构' : '读取文件'
  }
  if (error.value) return '解析失败'
  if (report.value) return '解析完成'
  return '等待文件'
})

const statusClass = computed(() => {
  if (busy.value) return 'busy'
  if (error.value) return 'error'
  if (report.value) return 'ok'
  return 'idle'
})

const presentMarkers = computed(() => {
  if (!report.value) return []
  return showAllMarkers.value
    ? report.value.markers
    : report.value.markers.filter((marker) => marker.present)
})

const structureFlags = computed(() => {
  const structure = report.value?.structure
  if (!structure) return []
  return [
    { label: 'PDF 容器', value: structure.hasPdf },
    { label: 'PostScript 数据', value: structure.hasPostScript },
    { label: 'AI 私有数据', value: structure.hasPrivateData },
    { label: 'PGF 层标记', value: structure.hasPgfLayer },
    { label: '压缩数据', value: structure.hasCompressedData },
    { label: '%%BeginData 块', value: structure.hasBinaryDataBlocks },
  ]
})

const aiTags = computed(() => report.value?.structure?.aiTags ?? [])

const jsonText = computed(() => (report.value ? JSON.stringify(report.value, null, 2) : ''))

const graphics = computed(() => report.value?.graphics ?? null)

const graphicsStatusLabel = computed(() => {
  const status = graphics.value?.status
  return (
    {
      parsed: '解析完成',
      empty: '无绘图指令',
      skipped: '已跳过',
      failed: '解析失败',
    }[status] ?? '—'
  )
})

const graphicsSourceLabel = computed(() => {
  const source = graphics.value?.source
  return (
    {
      'private-data': 'AI 私有数据',
      'postscript-body': 'PostScript 绘图段',
    }[source] ?? '无可用来源'
  )
})

const vectorTypeSummary = computed(() => {
  const vectors = graphics.value?.vectors ?? []
  const labels = { rect: '矩形', line: '线段', path: '路径' }
  const counts = new Map()
  for (const vector of vectors) {
    counts.set(vector.type, (counts.get(vector.type) ?? 0) + 1)
  }
  return [...counts.entries()].map(([type, count]) => ({
    type,
    label: labels[type] ?? type,
    count,
  }))
})

const previewVectors = computed(() => graphics.value?.vectors?.slice(0, 20) ?? [])

const topUnknownOperators = computed(() => graphics.value?.unknownOperators?.slice(0, 15) ?? [])

const graphicsDiagnostics = computed(() => graphics.value?.diagnostics?.slice(0, 12) ?? [])

const gradientFillCount = computed(
  () => (graphics.value?.vectors ?? []).filter((vector) => vector.fill?.type === 'gradient').length,
)

const customFillCount = computed(
  () => (graphics.value?.vectors ?? []).filter((vector) => vector.fill?.type === 'custom').length,
)

const graphicsHasWarning = computed(() => {
  if (!graphics.value) return false
  return (
    graphics.value.truncated ||
    (graphics.value.unknownOperators?.length ?? 0) > 0 ||
    graphics.value.stats?.suppressedPaths > 0
  )
})

const progressPercent = computed(() => formatPercent(progress.value.ratio ?? 0))

const privateStatusLabel = computed(() => {
  const status = report.value?.privateData?.status
  return (
    {
      decoded: '已解码',
      failed: '解码失败',
      unsupported: '环境不支持',
      skipped: '已跳过',
      absent: '未发现',
    }[status] ?? '—'
  )
})

function pick() {
  fileInput.value?.click()
}

function onInputChange(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (file) handleFile(file)
}

async function handleFile(file, meta = {}) {
  if (!file) return
  abortController.value?.abort()
  const controller = new AbortController()
  abortController.value = controller

  busy.value = true
  report.value = null
  error.value = null
  synthetic.value = Boolean(meta.synthetic)
  copied.value = false
  progress.value = { phase: 'read', ratio: 0, message: '读取文件…' }

  const result = await engine.parse(file, {
    signal: controller.signal,
    onProgress: (event) => {
      progress.value = { ...event }
    },
  })

  if (controller.signal.aborted) return
  busy.value = false

  if (result.ok) {
    report.value = result.report
    progress.value = { phase: 'done', ratio: 1, message: '结构检测完成' }
  } else if (!result.aborted) {
    error.value = result.error
  }
}

function cancel() {
  abortController.value?.abort()
  abortController.value = null
  busy.value = false
  progress.value = { phase: 'idle', ratio: 0, message: '已取消' }
}

function reset() {
  cancel()
  report.value = null
  error.value = null
  synthetic.value = false
  copied.value = false
  if (fileInput.value) fileInput.value.value = ''
}

function onDragEnter(event) {
  event.preventDefault()
  if (event.dataTransfer?.types?.includes('Files')) dragging.value = true
}

function onDragOver(event) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(event) {
  if (event.currentTarget === event.target) dragging.value = false
}

function onDrop(event) {
  event.preventDefault()
  event.stopPropagation()
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) handleFile(file)
}

async function loadSample() {
  sampleLoading.value = true
  error.value = null
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}samples/synthetic-ai12-pdf.bin`, {
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob()
    const file = new File([blob], 'synthetic-ai12-pdf.bin', {
      type: 'application/octet-stream',
    })
    await handleFile(file, { synthetic: true })
  } catch (cause) {
    error.value = {
      code: 'SAMPLE_LOAD_FAILED',
      message: `加载合成样本失败：${cause instanceof Error ? cause.message : String(cause)}`,
      details: { hint: '请先运行 npm run generate:samples' },
    }
  } finally {
    sampleLoading.value = false
  }
}

async function copySha() {
  const sha = report.value?.file?.sha256
  if (!sha) return
  try {
    await navigator.clipboard.writeText(sha)
    copied.value = true
    window.setTimeout(() => {
      copied.value = false
    }, 1600)
  } catch {
    copied.value = false
  }
}

function severityClass(severity) {
  return `severity-${severity ?? 'info'}`
}

function paintLabel(paint) {
  if (!paint || paint.type === 'none') return '无'
  if (paint.type === 'named') return paint.name
  if (paint.type === 'unknown') return '未知'
  if (paint.type === 'gradient') return `渐变（${paint.name ?? '未命名'}）`
  if (paint.type === 'custom') {
    const values = (paint.values ?? []).slice(0, 4).map((value) => Math.round(value * 1000) / 1000)
    const suffix = (paint.values ?? []).length > 4 ? '…' : ''
    return `custom(${values.join(', ')}${suffix})`
  }
  const values = (paint.values ?? []).map((value) => {
    const rounded = Math.round(value * 1000) / 1000
    return String(rounded)
  })
  return `${paint.type}(${values.join(', ')})`
}

function formatBounds(bounds) {
  if (!bounds) return '—'
  return `${Math.round(bounds.x * 100) / 100}, ${Math.round(bounds.y * 100) / 100} · ${Math.round(bounds.width * 100) / 100}×${Math.round(bounds.height * 100) / 100}`
}

function formatRect(rect) {
  if (!rect) return '—'
  return `${Math.round(rect.x * 100) / 100}, ${Math.round(rect.y * 100) / 100} / ${Math.round(rect.width * 100) / 100} × ${Math.round(rect.height * 100) / 100} pt`
}

function vectorTypeLabel(type) {
  return { rect: '矩形', line: '线段', path: '路径' }[type] ?? type
}

function formatMatrix(matrix) {
  return (matrix ?? []).map((value) => Math.round(value * 1000) / 1000).join(' ')
}

function roadmapStateLabel(state) {
  return { done: '完成', current: '当前', next: '下一步' }[state] ?? '计划'
}

function severityMark(severity) {
  return { error: '✕', warning: '▲', info: '●' }[severity] ?? '●'
}

function compatibilityClass(level) {
  return `level-${String(level ?? '').toLowerCase()}`
}

function preventWindowFileDrop(event) {
  if (event.dataTransfer?.types?.includes('Files')) event.preventDefault()
}

onMounted(() => {
  window.addEventListener('dragover', preventWindowFileDrop)
  window.addEventListener('drop', preventWindowFileDrop)
})

onBeforeUnmount(() => {
  window.removeEventListener('dragover', preventWindowFileDrop)
  window.removeEventListener('drop', preventWindowFileDrop)
  abortController.value?.abort()
})
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="logo" aria-hidden="true">◈</div>
        <div>
          <div class="brand-title">
            AI Viewer Engine
            <span class="stage-badge">STAGE 5 / 7</span>
          </div>
          <div class="brand-sub">Illustrator .ai 解析 · Scene Graph · Canvas 预览 · WASM</div>
        </div>
      </div>

      <div class="topbar-actions">
        <span class="engine-status" :class="statusClass"><i></i>{{ statusText }}</span>
        <button v-if="busy" class="btn danger" @click="cancel">取消</button>
        <button v-if="report || error" class="btn ghost" @click="reset">清空</button>
        <button v-if="report" class="btn" @click="pick">更换文件</button>
        <button v-else class="btn" @click="pick">选择文件</button>
      </div>

      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept=".ai,.pdf,.eps,.ps,application/postscript,application/pdf,application/illustrator"
        @change="onInputChange"
      />
    </header>

    <main class="main">
      <!-- 解析中 -->
      <section v-if="busy" class="panel progress-panel">
        <div class="progress-head">
          <span class="pulse-dot"></span>
          <strong>{{ progress.message || '正在处理…' }}</strong>
          <span class="mono progress-percent">{{ progressPercent }}</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: progressPercent }"></div>
        </div>
        <p class="muted small">
          {{
            progress.phase === 'read' && progress.total
              ? `${formatBytes(progress.loaded ?? 0)} / ${formatBytes(progress.total)}`
              : '阶段 1 仅执行二进制读取与结构检测，不进行矢量解析。'
          }}
        </p>
      </section>

      <!-- 错误 -->
      <section v-if="error && !busy" class="panel error-panel">
        <div class="error-head">
          <span class="error-icon">✕</span>
          <div>
            <h2>无法完成结构检测</h2>
            <p class="muted">解析失败已转换为结构化错误，页面不会崩溃。</p>
          </div>
        </div>
        <dl class="kv">
          <div>
            <dt>错误代码</dt>
            <dd class="mono">{{ error.code }}</dd>
          </div>
          <div>
            <dt>错误信息</dt>
            <dd>{{ error.message }}</dd>
          </div>
        </dl>
        <pre v-if="Object.keys(error.details ?? {}).length" class="code-block">{{
          JSON.stringify(error.details, null, 2)
        }}</pre>
        <div class="error-actions">
          <button class="btn" @click="reset">重新选择文件</button>
          <button class="btn ghost" @click="loadSample">加载合成样本</button>
        </div>
      </section>

      <!-- 检测结果 -->
      <template v-if="report && !busy">
        <section v-if="synthetic" class="banner banner-warning">
          <strong>合成样本</strong>
          <span>
            当前文件由本项目脚本生成，仅用于验证检测链路，<b>不是真实 Illustrator 导出文件</b>，不能作为兼容性证据。
          </span>
        </section>

        <section class="panel summary-panel">
          <div class="summary-main">
            <p class="eyebrow">STRUCTURE REPORT</p>
            <h1>{{ report.detection.containerLabel }}</h1>
            <p class="summary-text">{{ report.summary }}</p>
            <div class="summary-tags">
              <span class="chip" :class="`container-${report.detection.container}`">
                {{ report.detection.container.toUpperCase() }}
              </span>
              <span class="chip">{{ report.detection.confidence }} confidence</span>
              <span v-if="report.detection.aiFormatVersion" class="chip accent">
                AI{{ report.detection.aiFormatVersion }} 私有标记
              </span>
              <span v-if="report.detection.pdfVersion" class="chip">
                PDF {{ report.detection.pdfVersion }}
              </span>
              <span v-if="report.compatibility?.overall" class="chip" :class="compatibilityClass(report.compatibility?.overall)">
                {{ report.compatibility?.overallLabel }}
              </span>
              <span v-if="graphics?.status === 'parsed'" class="chip accent">
                矢量 {{ report.graphics.vectorCount }}
              </span>
              <span v-if="report.graphics?.artboards?.length" class="chip">
                {{ report.graphics.artboardSource === 'native-artboard' ? '原生画板' : 'Artboard' }}
                {{ report.graphics.artboards.length }}
              </span>
              <span v-if="report.scene" class="chip accent">场景 {{ report.scene.stats.shapes }} 图形</span>
              <span v-if="report.engine?.wasmUsed" class="chip accent">WASM 扫描</span>
            </div>
          </div>
          <div class="summary-metrics">
            <div class="metric">
              <span class="metric-label">文件大小</span>
              <span class="metric-value">{{ formatBytes(report.file.size) }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">私有数据</span>
              <span class="metric-value">{{ privateStatusLabel }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">解压后大小</span>
              <span class="metric-value">
                {{ report.privateData.decodedBytes ? formatBytes(report.privateData.decodedBytes) : '—' }}
              </span>
            </div>
            <div class="metric">
              <span class="metric-label">矢量对象</span>
              <span class="metric-value">{{ report.graphics?.vectorCount ?? 0 }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">画板候选</span>
              <span class="metric-value">{{ report.graphics?.artboards?.length ?? 0 }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">解析耗时</span>
              <span class="metric-value">{{ report.durationMs ?? 0 }} ms</span>
            </div>
          </div>
        </section>

        <ScenePreview v-if="report.scene" :scene="report.scene" :report="report" />

        <div class="grid">
          <section class="panel">
            <h2 class="panel-title">文件信息</h2>
            <dl class="kv">
              <div>
                <dt>文件名</dt>
                <dd class="break">{{ report.file.name ?? '（未命名）' }}</dd>
              </div>
              <div>
                <dt>容器类型</dt>
                <dd>{{ report.detection.containerLabel }} / {{ report.detection.variant }}</dd>
              </div>
              <div>
                <dt>Creator 版本</dt>
                <dd class="mono">{{ report.detection.creator ?? '未检测到' }}</dd>
              </div>
              <div>
                <dt>Creator 标识</dt>
                <dd>{{ report.detection.creatorLabel ?? '—' }}</dd>
              </div>
              <div>
                <dt>应用版本</dt>
                <dd class="mono">{{ report.detection.applicationVersion ?? '—' }}</dd>
              </div>
              <div>
                <dt>声明图层 / 画板</dt>
                <dd>
                  {{ report.detection.declaredLayerCount ?? '—' }} /
                  {{ report.detection.declaredArtboardCount ?? '—' }}
                </dd>
              </div>
              <div>
                <dt>AI 私有格式</dt>
                <dd>{{ report.detection.aiFormatLabel ?? '未检测到' }}</dd>
              </div>
              <div>
                <dt>AI 版本标记</dt>
                <dd class="mono">
                  {{ report.detection.aiFormatVersions.length ? report.detection.aiFormatVersions.join(', ') : '—' }}
                </dd>
              </div>
              <div>
                <dt>SHA-256</dt>
                <dd class="sha-row">
                  <span class="mono break">{{ report.file.sha256 ?? '不可用' }}</span>
                  <button v-if="report.file.sha256" class="mini-btn" @click="copySha">
                    {{ copied ? '已复制' : '复制' }}
                  </button>
                </dd>
              </div>
            </dl>
          </section>

          <section class="panel">
            <h2 class="panel-title">结构特征</h2>
            <ul class="flag-list">
              <li v-for="flag in structureFlags" :key="flag.label" :class="{ on: flag.value }">
                <span class="flag-icon">{{ flag.value ? '✓' : '·' }}</span>
                {{ flag.label }}
              </li>
            </ul>
            <div class="divider"></div>
            <div class="mini-head">
              <span class="label">AI 版本标记</span>
              <span class="muted small">{{ aiTags.length }} 种</span>
            </div>
            <div v-if="aiTags.length" class="tag-cloud">
              <span v-for="tag in aiTags.slice(0, 18)" :key="tag.tag" class="tag mono">
                {{ tag.tag }}<em v-if="tag.count > 1">×{{ tag.count }}</em>
              </span>
            </div>
            <p v-else class="muted small">未在扫描窗口中发现 %AI&lt;n&gt;_ 标记。</p>
          </section>

          <section class="panel">
            <h2 class="panel-title">当前解析能力</h2>
            <ul class="capability-list">
              <li v-for="cap in CAPABILITY_DEFS" :key="cap.key">
                <span class="cap-dot" :class="report.capabilities[cap.key] ? 'on' : 'off'"></span>
                <span class="cap-label">{{ cap.label }}</span>
                <span class="cap-note">{{ cap.note }}</span>
              </li>
            </ul>
            <p class="muted small footnote">
              阶段 1 不产生任何图形解析结果；能力未实现前不会标记为支持。
            </p>
          </section>

          <section class="panel">
            <h2 class="panel-title">兼容性报告</h2>
            <div class="compat-head">
              <span class="level-badge" :class="compatibilityClass(report.compatibility?.overall)">
                {{ report.compatibility?.overallLabel }}
              </span>
              <span class="muted small">{{ report.compatibility?.note }}</span>
            </div>
            <ul class="compat-list">
              <li v-for="item in report.compatibility?.items ?? []" :key="item.feature">
                <span class="compat-feature">{{ item.feature }}</span>
                <span class="level-pill" :class="compatibilityClass(item.level)">{{ item.label }}</span>
                <span class="compat-detail">{{ item.detail }}</span>
              </li>
            </ul>
          </section>
        </div>

        <section class="panel">
          <div class="panel-head">
            <h2 class="panel-title">Illustrator 私有数据</h2>
            <span class="status-pill" :class="`private-${report.privateData.status}`">
              {{ privateStatusLabel }}
            </span>
          </div>
          <dl class="kv kv-inline">
            <div>
              <dt>格式标记</dt>
              <dd class="mono">{{ report.privateData.marker ?? '—' }}</dd>
            </div>
            <div>
              <dt>压缩方式</dt>
              <dd class="mono">{{ report.privateData.compression }}</dd>
            </div>
            <div>
              <dt>数据偏移</dt>
              <dd class="mono">{{ formatOffset(report.privateData.dataOffset) }}</dd>
            </div>
            <div>
              <dt>数据长度</dt>
              <dd>{{ report.privateData.declaredDataLength ? formatBytes(report.privateData.declaredDataLength) : '—' }}</dd>
            </div>
            <div>
              <dt>解压后长度</dt>
              <dd>{{ report.privateData.decodedBytes ? formatBytes(report.privateData.decodedBytes) : '—' }}</dd>
            </div>
            <div>
              <dt>尾部额外数据</dt>
              <dd>{{ report.privateData.trailingData ? '是' : '否' }}</dd>
            </div>
            <div v-if="report.privateData.chunkCount">
              <dt>PDF 分块</dt>
              <dd class="mono">
                {{ report.privateData.chunksUsed }} / {{ report.privateData.chunkCount }} · 对象
                {{ report.privateData.streamObject }}
              </dd>
            </div>
          </dl>

          <div v-if="report.privateData.decodedMarkers?.length" class="decoded-markers">
            <span class="label">解码后结构标记</span>
            <span
              v-for="marker in report.privateData.decodedMarkers"
              :key="marker.id"
              class="tag mono"
            >
              {{ marker.needle }}<em>×{{ marker.count }}</em>
            </span>
          </div>

          <p v-if="report.privateData.error" class="inline-error">
            {{ report.privateData.error }}
          </p>

          <pre v-if="report.privateData.preview" class="code-block preview">{{
            report.privateData.preview
          }}</pre>
          <p v-else class="muted small">无可用文本预览（数据可能被压缩、跳过或不存在）。</p>
        </section>

        <section v-if="graphics" class="panel graphics-panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">基础矢量解析（阶段 2）</h2>
              <p class="panel-sub">
                来源：{{ graphicsSourceLabel }} · 模式 <span class="mono">{{ graphics.mode }}</span>
              </p>
            </div>
            <span class="status-pill" :class="`graphics-${graphics.status}`">
              {{ graphicsStatusLabel }}
            </span>
          </div>

          <div class="vector-metrics">
            <div class="metric">
              <span class="metric-label">Tokens</span>
              <span class="metric-value">{{ graphics.tokenCount }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">白名单操作符</span>
              <span class="metric-value">{{ graphics.stats?.operatorsExecuted ?? 0 }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">矢量对象</span>
              <span class="metric-value">{{ graphics.vectorCount }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">未识别操作符</span>
              <span class="metric-value">{{ graphics.unknownOperators?.length ?? 0 }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">画板候选</span>
              <span class="metric-value">{{ graphics.artboards?.length ?? 0 }}</span>
            </div>
            <div class="metric">
              <span class="metric-label">结果截断</span>
              <span class="metric-value">{{ graphics.truncated ? '是' : '否' }}</span>
            </div>
          </div>

          <p v-if="graphics.status === 'skipped'" class="muted small">
            {{
              graphics.reason === 'no-private-data'
                ? '该 PDF 未包含可解析的 AI 私有数据；阶段 2 不解析 PDF 内容流，因此没有矢量结果。'
                : '本次请求已关闭矢量解析。'
            }}
          </p>

          <div v-if="graphicsHasWarning" class="banner banner-warning inline-banner">
            <strong>部分内容未还原</strong>
            <span>存在未识别操作符、截断或不可见路径，当前结果仅覆盖已支持的标准绘图子集。</span>
          </div>

          <div class="graphics-grid">
            <div class="graphics-block">
              <h3 class="subsection-title">对象类型</h3>
              <div class="tag-cloud">
                <span v-for="item in vectorTypeSummary" :key="item.type" class="tag">
                  {{ item.label }} ×{{ item.count }}
                </span>
                <span v-if="gradientFillCount" class="tag tag-muted">渐变填充 ×{{ gradientFillCount }}</span>
                <span v-if="customFillCount" class="tag tag-muted">专色/自定义 ×{{ customFillCount }}</span>
                <span v-if="!vectorTypeSummary.length" class="muted small">没有矢量对象</span>
              </div>
            </div>
            <div class="graphics-block">
              <h3 class="subsection-title">未支持特性</h3>
              <div class="tag-cloud">
                <span
                  v-for="feature in graphics.unsupportedFeatures"
                  :key="feature.feature"
                  class="tag tag-muted"
                >
                  {{ feature.feature }} ×{{ feature.count }}
                </span>
                <span v-if="!graphics.unsupportedFeatures?.length" class="muted small">无</span>
              </div>
            </div>
          </div>

          <div class="divider"></div>
          <div class="mini-head">
            <h3 class="subsection-title">画板候选</h3>
            <span class="muted small">
              {{
                graphics.artboardSource === 'native-artboard'
                  ? '来自 AI DocumentData 原生画板'
                  : '来自 BoundingBox / MediaBox，非原生画板'
              }}
            </span>
          </div>
          <div v-if="graphics.artboards?.length" class="artboard-list">
            <article v-for="artboard in graphics.artboards" :key="artboard.id" class="artboard-card">
              <div class="artboard-head">
                <strong>{{ artboard.name }}</strong>
                <span class="chip">{{ artboard.source }}</span>
              </div>
              <p class="mono">{{ formatRect(artboard.rect) }}</p>
              <p class="muted small">{{ artboard.note }}</p>
            </article>
          </div>
          <p v-else class="muted small">未找到画板边界提示。</p>

          <div v-if="graphics.contentBounds?.length" class="content-bounds">
            <span class="label">内容边界</span>
            <span v-for="(bounds, index) in graphics.contentBounds" :key="`${bounds.kind}-${index}`" class="tag mono">
              {{ bounds.kind }} · {{ formatRect(bounds.rect) }}
            </span>
          </div>

          <div class="divider"></div>
          <div class="mini-head">
            <h3 class="subsection-title">矢量对象</h3>
            <span v-if="graphics.vectorCount > previewVectors.length" class="muted small">
              显示前 {{ previewVectors.length }} / 共 {{ graphics.vectorCount }}
            </span>
          </div>
          <div v-if="previewVectors.length" class="table-wrap">
            <table class="marker-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>类型</th>
                  <th>填充</th>
                  <th>描边</th>
                  <th>变换 [a b c d e f]</th>
                  <th>包围盒 x, y · w×h</th>
                  <th>子路径</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="vector in previewVectors" :key="vector.id">
                  <td class="mono">{{ vector.id }}</td>
                  <td>
                    {{ vectorTypeLabel(vector.type) }}
                    <span v-if="vector.compound" class="mini-flag">复合</span>
                    <span v-if="vector.nonPrinting" class="mini-flag">非打印</span>
                  </td>
                  <td class="mono">{{ paintLabel(vector.fill) }}</td>
                  <td class="mono">
                    {{ paintLabel(vector.stroke)
                    }}<span v-if="vector.stroke.type !== 'none'"> · {{ vector.strokeWidth }}pt</span>
                  </td>
                  <td class="mono">{{ formatMatrix(vector.transform) }}</td>
                  <td class="mono">{{ formatBounds(vector.bounds) }}</td>
                  <td class="mono">{{ vector.subpaths.length }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="muted small">没有可展示的矢量对象。</p>

          <template v-if="topUnknownOperators.length">
            <div class="divider"></div>
            <div class="mini-head">
              <h3 class="subsection-title">未识别操作符</h3>
              <span class="muted small">
                共 {{ graphics.unknownOperators.length }} 种 · 显示前 {{ topUnknownOperators.length }}
              </span>
            </div>
            <div class="table-wrap">
              <table class="marker-table">
                <thead>
                  <tr>
                    <th>操作符</th>
                    <th>次数</th>
                    <th>首次偏移</th>
                    <th>行号</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="operator in topUnknownOperators" :key="operator.operator">
                    <td class="mono">{{ operator.operator }}</td>
                    <td>{{ operator.count }}</td>
                    <td class="mono">{{ formatOffset(operator.firstOffset) }}</td>
                    <td>{{ operator.firstLine }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <template v-if="graphicsDiagnostics.length">
            <div class="divider"></div>
            <h3 class="subsection-title">解析诊断</h3>
            <ul class="diagnostic-list compact">
              <li v-for="(diagnostic, index) in graphicsDiagnostics" :key="`${diagnostic.code}-${index}`">
                <span class="severity-icon" :class="severityClass(diagnostic.severity)">
                  {{ severityMark(diagnostic.severity) }}
                </span>
                <div>
                  <div class="diagnostic-head">
                    <span class="mono diagnostic-code">{{ diagnostic.code }}</span>
                  </div>
                  <p>{{ diagnostic.message }}</p>
                </div>
              </li>
            </ul>
          </template>

          <p class="muted small footnote">
            阶段 2 不渲染图形；Canvas 预览将在阶段 4 接入。当前结果只覆盖白名单操作符子集，且尚未用真实
            AI 样本校准。
          </p>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2 class="panel-title">结构标记位置</h2>
            <label class="toggle">
              <input v-model="showAllMarkers" type="checkbox" />
              显示未出现的标记
            </label>
          </div>
          <div class="table-wrap">
            <table class="marker-table">
              <thead>
                <tr>
                  <th>标记</th>
                  <th>原文</th>
                  <th>偏移</th>
                  <th>次数</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="marker in presentMarkers" :key="marker.id" :class="{ absent: !marker.present }">
                  <td>{{ marker.label }}</td>
                  <td class="mono">{{ marker.needle }}</td>
                  <td class="mono">{{ marker.present ? formatOffset(marker.offset) : '—' }}</td>
                  <td class="mono">
                    {{ marker.count }}<span v-if="marker.countCapped">+</span>
                  </td>
                  <td>
                    <span class="dot" :class="marker.present ? 'on' : 'off'"></span>
                    {{ marker.present ? '存在' : '未发现' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <h2 class="panel-title">诊断信息</h2>
          <ul v-if="report.diagnostics.length" class="diagnostic-list">
            <li v-for="(diagnostic, index) in report.diagnostics" :key="`${diagnostic.code}-${index}`">
              <span class="severity-icon" :class="severityClass(diagnostic.severity)">
                {{ severityMark(diagnostic.severity) }}
              </span>
              <div>
                <div class="diagnostic-head">
                  <span class="mono diagnostic-code">{{ diagnostic.code }}</span>
                  <span class="severity-label">{{ diagnostic.severity }}</span>
                </div>
                <p>{{ diagnostic.message }}</p>
              </div>
            </li>
          </ul>
          <p v-else class="muted small">没有任何诊断信息。</p>
        </section>

        <details class="panel json-panel">
          <summary>
            <span class="panel-title">完整 JSON 报告</span>
            <span class="muted small">schema v{{ report.schemaVersion }} · stage {{ report.stage }}</span>
          </summary>
          <pre class="code-block json">{{ jsonText }}</pre>
        </details>
      </template>

      <!-- 初始状态 -->
      <template v-if="!report && !busy && !error">
        <section class="hero">
          <p class="eyebrow">ZERO UPLOAD · LOCAL ONLY · NO PDF.JS</p>
          <h1>在浏览器里读懂 <span>.ai</span> 的内部结构</h1>
          <p class="lede">
            自主实现的 Illustrator 解析链路：二进制读取 → 容器识别 → 私有数据解压 →
            Scene Graph → Canvas 预览。阶段 5 已加入 WASM 扫描加速；渐变/专色使用明确标注的近似色。
          </p>

          <div
            class="dropzone"
            :class="{ dragging }"
            role="group"
            aria-label="AI 文件上传区域"
            @click="pick"
            @dragenter="onDragEnter"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
          >
            <div class="drop-icon" aria-hidden="true">↓</div>
            <p class="drop-title">拖入 .ai 文件，或点击选择</p>
            <p class="drop-hint">
              支持 PDF 包裹型 / EPS / 纯 PostScript · 单文件上限 512 MB · 支持取消
            </p>
            <div class="drop-actions">
              <button class="btn primary" @click.stop="pick">选择文件</button>
              <button class="btn ghost" :disabled="sampleLoading" @click.stop="loadSample">
                {{ sampleLoading ? '加载中…' : '加载合成样本' }}
              </button>
            </div>
            <p class="privacy">🔒 文件只在本机内存中读取，不上传、不访问外部网络。</p>
          </div>
        </section>

        <section class="feature-grid">
          <article class="panel feature">
            <span class="feature-index">01</span>
            <h2>先识别，再解析</h2>
            <p>
              不根据扩展名猜测格式。分别检测 PDF 容器、DOS EPS 头、PostScript 头与 Illustrator
              私有数据标记，输出结构化检测报告。
            </p>
          </article>
          <article class="panel feature">
            <span class="feature-index">02</span>
            <h2>不伪装解析能力</h2>
            <p>
              PDF 里可能存在预览图或 PDF 绘制指令，但阶段 1 不读取它们冒充 AI 原生解析；兼容性报告会明确列出未实现项。
            </p>
          </article>
          <article class="panel feature">
            <span class="feature-index">03</span>
            <h2>阶段 3–5：预览与加速</h2>
            <p>
              已建立 Scene Graph、原生 Canvas 渲染与缩放/平移交互，并加入自研 Rust/WASM
              多模式扫描；WASM 失败时自动回退 JavaScript。
            </p>
          </article>
        </section>

        <section class="panel roadmap">
          <div class="panel-head">
            <h2 class="panel-title">开发路线</h2>
            <span class="muted small">阶段 6 下一步</span>
          </div>
          <ol class="roadmap-list">
            <li v-for="stage in ROADMAP" :key="stage.n" :class="stage.state">
              <span class="roadmap-n">{{ String(stage.n).padStart(2, '0') }}</span>
              <div class="roadmap-text">
                <strong>{{ stage.title }}</strong>
                <span>{{ stage.desc }}</span>
              </div>
              <span class="roadmap-state">
                {{ roadmapStateLabel(stage.state) }}
              </span>
            </li>
          </ol>
        </section>
      </template>
    </main>

    <footer class="footer">
      <span>AI Viewer Engine v0.5.0 · Stage 5 · JS 解析 + Canvas + WASM</span>
      <span class="footer-sep">·</span>
      <span>WASM 仅作为后续加速项，不是运行前提</span>
    </footer>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 28px;
  border-bottom: 1px solid var(--border);
  background: rgba(6, 8, 15, 0.82);
  backdrop-filter: blur(16px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.logo {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: linear-gradient(145deg, rgba(94, 234, 212, 0.2), rgba(139, 147, 255, 0.18));
  border: 1px solid rgba(94, 234, 212, 0.3);
  color: var(--accent);
  font-size: 18px;
  box-shadow: 0 0 30px rgba(94, 234, 212, 0.12);
}

.brand-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.brand-sub {
  color: var(--text-faint);
  font-size: 12px;
  margin-top: 1px;
}

.stage-badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid rgba(94, 234, 212, 0.25);
  white-space: nowrap;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.engine-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--text-dim);
  border: 1px solid var(--border);
  background: rgba(10, 15, 27, 0.6);
  white-space: nowrap;
}

.engine-status i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-faint);
}

.engine-status.busy i {
  background: var(--amber);
  box-shadow: 0 0 0 4px rgba(251, 191, 36, 0.12);
  animation: blink 1s ease-in-out infinite;
}

.engine-status.ok i {
  background: var(--green);
  box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.12);
}

.engine-status.error i {
  background: var(--red);
  box-shadow: 0 0 0 4px rgba(251, 113, 133, 0.12);
}

@keyframes blink {
  50% {
    opacity: 0.35;
  }
}

.btn {
  appearance: none;
  border: 1px solid var(--border-strong);
  background: rgba(19, 28, 47, 0.9);
  color: var(--text);
  border-radius: 9px;
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 550;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.15s ease;
  white-space: nowrap;
}

.btn:hover:not(:disabled) {
  border-color: rgba(94, 234, 212, 0.42);
  background: rgba(25, 36, 58, 0.95);
}

.btn:active:not(:disabled) {
  transform: translateY(1px);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.primary {
  background: linear-gradient(135deg, rgba(94, 234, 212, 0.92), rgba(66, 200, 210, 0.88));
  border-color: transparent;
  color: #06221f;
  font-weight: 650;
}

.btn.primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #7df3e1, #56d7df);
}

.btn.ghost {
  background: transparent;
}

.btn.danger {
  border-color: rgba(251, 113, 133, 0.35);
  color: var(--red);
  background: rgba(251, 113, 133, 0.08);
}

.file-input {
  display: none;
}

.main {
  width: min(1280px, 100%);
  margin: 0 auto;
  padding: 34px 28px 56px;
  flex: 1;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 22px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.18);
}

.panel + .panel,
.panel + .grid,
.grid + .panel,
.banner + .panel {
  margin-top: 16px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.panel-title {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.grid .panel {
  margin-top: 0;
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--accent);
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.16em;
}

h1 {
  margin: 0;
  font-size: clamp(26px, 3.4vw, 40px);
  line-height: 1.15;
  letter-spacing: -0.025em;
}

h1 span {
  color: var(--accent);
}

.lede {
  max-width: 720px;
  margin: 12px 0 0;
  color: var(--text-dim);
  font-size: 14.5px;
}

.muted {
  color: var(--text-dim);
}

.small {
  font-size: 12px;
}

.mono {
  font-family: var(--mono);
}

.break {
  word-break: break-all;
}

/* ---------- 初始状态 ---------- */

.hero {
  padding: 26px 0 8px;
  text-align: center;
}

.hero .lede {
  margin-left: auto;
  margin-right: auto;
}

.dropzone {
  margin: 30px auto 0;
  max-width: 780px;
  padding: 36px 28px 26px;
  border: 1.5px dashed rgba(125, 155, 220, 0.32);
  border-radius: 20px;
  background:
    radial-gradient(500px 200px at 50% 0%, rgba(94, 234, 212, 0.06), transparent 70%),
    rgba(11, 17, 30, 0.65);
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.dropzone:hover,
.dropzone.dragging {
  border-color: rgba(94, 234, 212, 0.65);
  box-shadow:
    0 0 0 4px rgba(94, 234, 212, 0.07),
    0 30px 70px rgba(0, 0, 0, 0.3);
  transform: translateY(-1px);
}

.drop-icon {
  width: 54px;
  height: 54px;
  margin: 0 auto 16px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  font-size: 24px;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid rgba(94, 234, 212, 0.25);
}

.drop-title {
  margin: 0;
  font-size: 17px;
  font-weight: 620;
}

.drop-hint {
  margin: 6px 0 0;
  color: var(--text-faint);
  font-size: 12.5px;
}

.drop-actions {
  margin-top: 20px;
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}

.privacy {
  margin: 18px 0 0;
  color: var(--text-faint);
  font-size: 12px;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 28px;
}

.feature h2 {
  margin: 8px 0 8px;
  font-size: 15px;
}

.feature p {
  margin: 0;
  color: var(--text-dim);
  font-size: 13px;
}

.feature-index {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--accent);
  letter-spacing: 0.1em;
}

.roadmap {
  margin-top: 18px;
}

.roadmap-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 18px;
}

.roadmap-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  border-radius: 11px;
  border: 1px solid transparent;
  color: var(--text-faint);
}

.roadmap-list li.current {
  border-color: rgba(94, 234, 212, 0.24);
  background: var(--accent-soft);
  color: var(--text);
}

.roadmap-list li.next {
  color: var(--text-dim);
}

.roadmap-n {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-faint);
}

.roadmap-list li.current .roadmap-n {
  color: var(--accent);
}

.roadmap-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.roadmap-text strong {
  font-size: 12.5px;
  font-weight: 600;
}

.roadmap-text span {
  font-size: 11.5px;
  color: var(--text-faint);
}

.roadmap-state {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
}

/* ---------- 解析中 / 错误 ---------- */

.progress-panel {
  border-color: rgba(251, 191, 36, 0.22);
}

.progress-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pulse-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--amber);
  box-shadow: 0 0 0 6px rgba(251, 191, 36, 0.1);
  animation: blink 1s ease-in-out infinite;
}

.progress-percent {
  margin-left: auto;
  color: var(--text-dim);
  font-size: 12px;
}

.progress-track {
  height: 6px;
  margin: 16px 0 10px;
  border-radius: 999px;
  background: rgba(125, 155, 220, 0.12);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), var(--violet));
  transition: width 0.2s ease;
}

.error-panel {
  border-color: rgba(251, 113, 133, 0.3);
  background:
    radial-gradient(600px 200px at 10% 0%, rgba(251, 113, 133, 0.08), transparent 70%),
    var(--panel);
}

.error-head {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  margin-bottom: 18px;
}

.error-head h2 {
  margin: 0 0 3px;
  font-size: 17px;
}

.error-head p {
  margin: 0;
  font-size: 12.5px;
}

.error-icon {
  width: 36px;
  height: 36px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--red-soft);
  color: var(--red);
  border: 1px solid rgba(251, 113, 133, 0.3);
}

.error-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.banner {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 12.5px;
  border: 1px solid rgba(251, 191, 36, 0.28);
  background: var(--amber-soft);
  color: #f8dfa4;
  margin-bottom: 16px;
}

.banner strong {
  white-space: nowrap;
  color: var(--amber);
}

/* ---------- 结果 ---------- */

.summary-panel {
  display: flex;
  gap: 28px;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  background:
    radial-gradient(700px 260px at 100% 0%, rgba(94, 234, 212, 0.07), transparent 65%),
    var(--panel);
}

.summary-main {
  min-width: 280px;
  flex: 1;
}

.summary-main h1 {
  font-size: clamp(24px, 3vw, 32px);
}

.summary-text {
  margin: 8px 0 0;
  color: var(--text-dim);
  font-size: 13px;
}

.summary-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 16px;
}

.chip {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-dim);
  background: rgba(10, 15, 27, 0.55);
}

.chip.accent {
  color: var(--accent);
  border-color: rgba(94, 234, 212, 0.28);
  background: var(--accent-soft);
}

.chip.container-pdf {
  color: #fca5a5;
  border-color: rgba(252, 165, 165, 0.3);
  background: rgba(252, 165, 165, 0.1);
}

.chip.container-postscript,
.chip.container-eps {
  color: #c4b5fd;
  border-color: rgba(196, 181, 253, 0.3);
  background: rgba(196, 181, 253, 0.1);
}

.chip.container-unknown {
  color: var(--red);
  border-color: rgba(251, 113, 133, 0.3);
  background: var(--red-soft);
}

.summary-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(110px, auto));
  gap: 8px 26px;
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.metric-label {
  font-size: 10.5px;
  color: var(--text-faint);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.metric-value {
  font-family: var(--mono);
  font-size: 15px;
  color: var(--text);
}

.kv {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.kv > div {
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
}

.kv dt {
  color: var(--text-faint);
  font-size: 11.5px;
}

.kv dd {
  margin: 0;
  font-size: 12.5px;
  color: var(--text);
}

.kv-inline {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 18px;
}

.kv-inline > div {
  grid-template-columns: 86px minmax(0, 1fr);
}

.sha-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mini-btn {
  appearance: none;
  border: 1px solid var(--border);
  background: rgba(10, 15, 27, 0.6);
  color: var(--text-dim);
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 6px;
  cursor: pointer;
}

.mini-btn:hover {
  border-color: rgba(94, 234, 212, 0.4);
  color: var(--accent);
}

.flag-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.flag-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-faint);
  padding: 7px 9px;
  border-radius: 8px;
  border: 1px solid transparent;
}

.flag-list li.on {
  color: var(--text);
  border-color: rgba(52, 211, 153, 0.18);
  background: rgba(52, 211, 153, 0.06);
}

.flag-icon {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-faint);
  width: 12px;
  text-align: center;
}

.flag-list li.on .flag-icon {
  color: var(--green);
}

.divider {
  height: 1px;
  background: var(--border);
  margin: 15px 0;
}

.mini-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 9px;
}

.label {
  font-size: 11px;
  color: var(--text-faint);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  font-size: 10.5px;
  padding: 3px 7px;
  border-radius: 6px;
  background: rgba(139, 147, 255, 0.1);
  border: 1px solid rgba(139, 147, 255, 0.2);
  color: #c8ccff;
  word-break: break-all;
}

.tag em {
  font-style: normal;
  color: var(--text-faint);
  margin-left: 3px;
}

.capability-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.capability-list li {
  display: grid;
  grid-template-columns: 14px minmax(0, 1.2fr) minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 7px 4px;
  border-bottom: 1px dashed rgba(125, 155, 220, 0.09);
  font-size: 12.5px;
}

.capability-list li:last-child {
  border-bottom: none;
}

.cap-dot,
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  background: rgba(125, 155, 220, 0.28);
}

.cap-dot.on,
.dot.on {
  background: var(--green);
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.1);
}

.cap-note {
  color: var(--text-faint);
  font-size: 11px;
  text-align: right;
}

.footnote {
  margin: 12px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.compat-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.level-badge {
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.06em;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  white-space: nowrap;
}

.level-full {
  color: var(--green);
  border-color: rgba(52, 211, 153, 0.3);
  background: var(--green-soft);
}

.level-partial {
  color: var(--amber);
  border-color: rgba(251, 191, 36, 0.3);
  background: var(--amber-soft);
}

.level-unsupported {
  color: var(--text-dim);
  border-color: var(--border);
  background: rgba(125, 155, 220, 0.06);
}

.level-invalid {
  color: var(--red);
  border-color: rgba(251, 113, 133, 0.3);
  background: var(--red-soft);
}

.compat-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.compat-list li {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 82px;
  gap: 4px 10px;
  padding: 8px 2px;
  border-bottom: 1px dashed rgba(125, 155, 220, 0.09);
}

.compat-list li:last-child {
  border-bottom: none;
}

.compat-feature {
  font-size: 12.5px;
}

.level-pill {
  justify-self: end;
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  white-space: nowrap;
}

.compat-detail {
  grid-column: 1 / -1;
  font-size: 11px;
  color: var(--text-faint);
}

.private-panel .kv-inline {
  margin-bottom: 16px;
}

.decoded-markers {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  margin-bottom: 14px;
}

.status-pill {
  font-size: 10.5px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-dim);
}

.status-pill.private-decoded {
  color: var(--green);
  border-color: rgba(52, 211, 153, 0.3);
  background: var(--green-soft);
}

.status-pill.private-failed,
.status-pill.private-unsupported {
  color: var(--red);
  border-color: rgba(251, 113, 133, 0.3);
  background: var(--red-soft);
}

.status-pill.private-skipped {
  color: var(--amber);
  border-color: rgba(251, 191, 36, 0.3);
  background: var(--amber-soft);
}

.status-pill.graphics-parsed {
  color: var(--green);
  border-color: rgba(52, 211, 153, 0.3);
  background: var(--green-soft);
}

.status-pill.graphics-failed {
  color: var(--red);
  border-color: rgba(251, 113, 133, 0.3);
  background: var(--red-soft);
}

.status-pill.graphics-skipped,
.status-pill.graphics-empty {
  color: var(--amber);
  border-color: rgba(251, 191, 36, 0.3);
  background: var(--amber-soft);
}

.panel-sub {
  margin: 4px 0 0;
  color: var(--text-faint);
  font-size: 11.5px;
}

.vector-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px 18px;
  margin-bottom: 16px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: rgba(3, 6, 12, 0.36);
}

.graphics-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.subsection-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  letter-spacing: 0.02em;
}

.graphics-block {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(10, 15, 27, 0.42);
}

.graphics-block .subsection-title {
  margin-bottom: 9px;
}

.tag-muted {
  color: var(--text-dim);
  border-color: var(--border);
  background: rgba(125, 155, 220, 0.07);
}

.inline-banner {
  margin: 0 0 16px;
}

.artboard-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.artboard-card {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(10, 15, 27, 0.42);
}

.artboard-card p {
  margin: 4px 0 0;
  font-size: 11.5px;
}

.artboard-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.artboard-head strong {
  font-size: 12.5px;
}

.content-bounds {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  margin-top: 12px;
}

.mini-flag {
  display: inline-block;
  margin-left: 5px;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid var(--border);
  color: var(--text-faint);
  font-size: 9.5px;
  line-height: 1.6;
  vertical-align: 1px;
}

.diagnostic-list.compact li {
  padding: 8px 10px;
}

.inline-error {
  margin: 0 0 12px;
  color: var(--red);
  font-size: 12px;
}

.code-block {
  margin: 0;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(3, 6, 12, 0.72);
  color: #b9c7e2;
  font-size: 11.5px;
  line-height: 1.65;
  overflow: auto;
  max-height: 320px;
  white-space: pre-wrap;
  word-break: break-word;
}

.code-block.preview {
  max-height: 220px;
  color: #93a8c9;
}

.code-block.json {
  max-height: 560px;
}

.table-wrap {
  overflow: auto;
  border-radius: 10px;
  border: 1px solid var(--border);
}

.marker-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  min-width: 620px;
}

.marker-table th {
  text-align: left;
  font-weight: 550;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
  background: rgba(10, 15, 27, 0.72);
  padding: 9px 13px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.marker-table td {
  padding: 8px 13px;
  border-bottom: 1px solid rgba(125, 155, 220, 0.07);
  color: var(--text-dim);
}

.marker-table tbody tr:last-child td {
  border-bottom: none;
}

.marker-table tbody tr:hover td {
  background: rgba(125, 155, 220, 0.04);
}

.marker-table tr.absent td {
  color: var(--text-faint);
  opacity: 0.65;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
}

.toggle input {
  accent-color: #5eead4;
}

.diagnostic-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.diagnostic-list li {
  display: flex;
  gap: 11px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(10, 15, 27, 0.4);
}

.severity-icon {
  flex: none;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  font-size: 10px;
  margin-top: 1px;
}

.severity-error {
  color: var(--red);
  background: var(--red-soft);
}

.severity-warning {
  color: var(--amber);
  background: var(--amber-soft);
}

.severity-info {
  color: var(--violet);
  background: var(--violet-soft);
}

.diagnostic-head {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 2px;
}

.diagnostic-code {
  font-size: 10.5px;
  color: var(--text-dim);
}

.severity-label {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}

.diagnostic-list p {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}

.json-panel summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  list-style: none;
}

.json-panel summary::-webkit-details-marker {
  display: none;
}

.json-panel summary::before {
  content: '▸';
  color: var(--text-faint);
  margin-right: 8px;
  transition: transform 0.15s ease;
}

.json-panel[open] summary::before {
  transform: rotate(90deg);
}

.json-panel summary .panel-title {
  flex: 1;
}

.json-panel .code-block {
  margin-top: 14px;
}

.footer {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 18px 28px 26px;
  color: var(--text-faint);
  font-size: 11.5px;
  border-top: 1px solid rgba(125, 155, 220, 0.08);
}

.footer-sep {
  opacity: 0.5;
}

@media (max-width: 900px) {
  .topbar {
    padding: 12px 16px;
    flex-wrap: wrap;
  }

  .brand-sub {
    display: none;
  }

  .main {
    padding: 22px 16px 40px;
  }

  .grid,
  .feature-grid,
  .roadmap-list,
  .graphics-grid,
  .artboard-list {
    grid-template-columns: 1fr;
  }

  .vector-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .summary-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
  }

  .kv-inline {
    grid-template-columns: 1fr;
  }

  .summary-panel {
    align-items: flex-start;
  }
}

@media (max-width: 560px) {
  .brand-title {
    font-size: 13.5px;
  }

  .stage-badge {
    display: none;
  }

  .engine-status {
    display: none;
  }

  .flag-list {
    grid-template-columns: 1fr;
  }

  .kv > div {
    grid-template-columns: 84px minmax(0, 1fr);
  }

  .dropzone {
    padding: 26px 16px 22px;
  }
}
</style>
