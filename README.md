# Illustrator Viewer

[![npm version](https://img.shields.io/npm/v/illustrator-viewer?color=5eead4&label=npm)](https://www.npmjs.com/package/illustrator-viewer)
[![npm downloads](https://img.shields.io/npm/dm/illustrator-viewer?color=8b93ff&label=downloads)](https://www.npmjs.com/package/illustrator-viewer)
[![GitHub](https://img.shields.io/badge/GitHub-GHchenjingqi%2Fillustrator--viewer-181717?logo=github&logoColor=white)](https://github.com/GHchenjingqi/illustrator-viewer)
[![GitHub issues](https://img.shields.io/github/issues/GHchenjingqi/illustrator-viewer?color=fb7185&logo=github)](https://github.com/GHchenjingqi/illustrator-viewer/issues)
[![License: MIT](https://img.shields.io/badge/license-MIT-34d399)](https://github.com/GHchenjingqi/illustrator-viewer/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-339933?logo=node.js&logoColor=white)](https://github.com/GHchenjingqi/illustrator-viewer/blob/main/package.json)
[![Vue 3](https://img.shields.io/badge/vue-3-42b883?logo=vue.js&logoColor=white)](https://vuejs.org/)
[![WASM](https://img.shields.io/badge/WASM-Rust-654ff0?logo=webassembly&logoColor=white)](https://github.com/GHchenjingqi/illustrator-viewer/blob/main/wasm-src/src/lib.rs)

[![Unit tests](https://img.shields.io/badge/tests-112%20passed-34d399)](https://github.com/GHchenjingqi/illustrator-viewer/tree/main/tests)
[![E2E tests](https://img.shields.io/badge/E2E-21%20passed-34d399)](https://github.com/GHchenjingqi/illustrator-viewer/tree/main/tests/e2e)
[![Browsers](https://img.shields.io/badge/Chromium%20%7C%20Firefox%20%7C%20WebKit-tested-5eead4)](https://github.com/GHchenjingqi/illustrator-viewer/tree/main/tests/e2e)
[![Local only](https://img.shields.io/badge/privacy-local--only-5eead4)](https://github.com/GHchenjingqi/illustrator-viewer/blob/main/README.md#12-设计约束)

> 浏览器本地运行的 Adobe Illustrator `.ai` 文件解析、Scene Graph 与 Canvas 预览引擎。
> 自主实现 JavaScript 解析链路 + Rust/WASM 加速，不使用 PDF.js、Photopea、Ghostscript 等第三方预览/转换引擎。

**English:** Illustrator Viewer is a browser-local Adobe Illustrator (`.ai`, `.eps`, `.ps`) parser, Scene Graph builder, and Canvas preview engine for Vue 3 — with a pure JavaScript pipeline and optional Rust/WASM acceleration. No file uploads, no PDF.js, no third-party AI preview SDK.

**GitHub：** <https://github.com/GHchenjingqi/illustrator-viewer>  
**npm：** <https://www.npmjs.com/package/illustrator-viewer>  
**问题反馈：** <https://github.com/GHchenjingqi/illustrator-viewer/issues>

**当前状态：阶段 1–7 已完成，可作为 npm 包发布。** 真实 AI24 样本（Illustrator 29.3）已能在 Worker 中解析并在 Canvas 中预览；841 个原始路径经 PDF `/ArtBox` 过滤后显示 259 个可见图形。

- 纯前端：文件不上传、不访问外部网络
- JavaScript 解析链路可独立运行，WASM 仅做加速
- 原生 `Canvas 2D` 渲染，支持缩放、平移、全屏、多画板
- 提供 Vue 3 组件、解析引擎、Worker 客户端与 Canvas 渲染器
- 对未完整还原的效果明确输出诊断，不静默错误渲染

**关键词 / Topics：**

`adobe-illustrator` · `illustrator` · `illustrator-viewer` · `ai-file` · `.ai` · `postscript` · `vector-graphics` · `canvas` · `canvas-renderer` · `vue3` · `vite` · `wasm` · `parser` · `preview` · `scene-graph` · `zstandard` · `file-viewer`

> GitHub 仓库可在 **About → Topics** 中填入以上关键词；npm 搜索则使用 `package.json` 的 `keywords` 字段。当前 `keywords` 已包含 Illustrator、PostScript、Canvas、Vue、WASM、parser、preview 等词。

---

## 目录

1. [特性](#1-特性)
2. [安装](#2-安装)
3. [快速开始](#3-快速开始)
4. [API](#4-api)
5. [构建与发布](#5-构建与发布)
6. [开发与测试](#6-开发与测试)
7. [兼容性与真实样本](#7-兼容性与真实样本)
8. [已实现能力](#8-已实现能力)
9. [明确未实现](#9-明确未实现)
10. [架构](#10-架构)
11. [项目结构](#11-项目结构)
12. [设计约束](#12-设计约束)
13. [依赖与研究来源](#13-依赖与研究来源)
14. [项目链接](#14-项目链接)
15. [License](#15-license)

---

## 1. 特性

| 能力 | 说明 |
|---|---|
| 容器识别 | PDF、DOS EPS、EPS、PostScript；AI 私有标记与版本识别 |
| AI24 | `%AI24_ZStandard_Data` PDF stream 分块 + Zstandard 解压 |
| 早期版本 | AI12 zlib、AI9 ASCII85 + zlib、旧版 PostScript 绘图段 |
| 绘图解析 | 标准 PostScript 子集 + Illustrator 私有操作符 |
| 矢量提取 | 路径、线段、矩形、复合子路径、RGB/CMYK/Gray、线型、CTM、包围盒 |
| Scene Graph | `Document → Artboard → Layer/Group/Compound → Shape` |
| 可见范围 | 解析 PDF `/ArtBox`，过滤范围外的隐藏/参考副本 |
| 渐变 | 解析 `%_BS` 停靠点并用 Canvas 线性渐变近似渲染 |
| 渲染 | DPR 高清、适应窗口、1:1、滚轮缩放、拖拽平移、全屏、多画板 |
| Worker | 后台解析、进度、取消、任务 ID 防旧结果覆盖、失败回退主线程 |
| WASM | Rust 多模式扫描与包围盒接口；加载失败自动回退 JS |
| 诊断 | 兼容性报告、可见性提示、近似颜色/未支持特性标注 |

---

## 2. 安装

```bash
npm install illustrator-viewer vue
```

要求：

- 浏览器：支持 ES2022、Canvas 2D、Web Worker、可选 WebAssembly
- 构建环境：Node.js `>= 22.12`（Vite 8 要求）
- Vue `^3.5` 作为 peer dependency 由宿主应用提供

> 包尚未发布时，可在本仓库执行 `npm pack`，然后在业务项目中 `npm install ../illustrator-viewer-0.9.0.tgz` 本地验证。

---

## 3. 快速开始

### 3.1 Vue 组件

```vue
<script setup>
import { ref } from 'vue'
import { AiViewer } from 'illustrator-viewer'
import 'illustrator-viewer/style.css'

const file = ref(null)

function onChange(event) {
  file.value = event.target.files?.[0] ?? null
}
</script>

<template>
  <input type="file" accept=".ai,.eps,.ps,application/postscript,application/pdf" @change="onChange" />
  <AiViewer :file="file" height="640px" />
</template>
```

#### 只渲染画布（隐藏标题、工具栏和提示）

```vue
<AiViewer :file="file" :chrome="false" height="640px" />
```

`chrome=false` 时只保留 Canvas；滚轮缩放和拖拽平移仍然可用。

组件会自动使用 Worker 解析；Worker 不可用时回退主线程。

### 3.2 解析引擎

```js
import { AIParserEngine } from 'illustrator-viewer'

const engine = new AIParserEngine({ hash: true })
const result = await engine.parse(file, {
  onProgress: ({ phase, ratio, message }) => console.log(phase, ratio, message),
})

if (!result.ok) {
  console.error(result.error.code, result.error.message)
} else {
  const { report } = result
  console.log(report.detection.container) // 'pdf' | 'eps' | 'postscript'
  console.log(report.graphics.vectorCount)
  console.log(report.scene?.stats)
  console.log(report.compatibility.overall) // 'FULL' | 'PARTIAL' | 'INVALID' ...
}
```

`parse()` 同时接受 `File`、`Blob`、`ArrayBuffer`、`Uint8Array`。

### 3.3 Canvas 渲染

```js
import { createApp, h } from 'vue'
import { CanvasRenderer } from 'illustrator-viewer'

const renderer = new CanvasRenderer(canvas, { background: '#ffffff' })
renderer.setDocument(result.report.scene)
renderer.fit()

// 交互
renderer.zoomAt(1.2, x, y)
renderer.panBy(dx, dy)
renderer.actualSize()
renderer.setArtboard(0)
```

渲染器只消费 Scene Graph，不包含解析逻辑，可单独用于已有场景数据。

### 3.4 Worker 客户端

```js
import { AIWorkerClient } from 'illustrator-viewer'

const client = new AIWorkerClient()
const result = await client.parse(file, {
  onProgress: (event) => console.log(event),
})
client.terminate()
```

默认使用内联打包的 Worker，无需额外复制 Worker 文件；Worker 加载失败时会自动回退主线程引擎。

### 3.5 WASM 加速（可选）

包内包含 `dist/wasm/ai_viewer_wasm.wasm`。不加载 WASM 也能完整解析，只是扫描速度较慢。

**Vite 项目：**

```js
import wasmUrl from 'illustrator-viewer/wasm/ai_viewer_wasm.wasm?url'
```

```vue
<AiViewer :file="file" :wasm-url="wasmUrl" />
```

**其他方式：**

- 将 `node_modules/illustrator-viewer/dist/wasm/ai_viewer_wasm.wasm` 复制到站点 `/wasm/` 目录（组件默认路径）
- 或直接传字节：

```js
const bytes = await fetch('/wasm/ai_viewer_wasm.wasm').then((response) => response.arrayBuffer())
const engine = new AIParserEngine({ wasmBytes: bytes })
```

WASM 仅用于多模式标记扫描和批量几何计算；不改变解析结果，也不作为运行前提。

### 3.6 React / 无框架用法

React 等项目使用无 Vue 的 `core` 入口：

```tsx
import { useEffect, useRef } from 'react'
import { AIWorkerClient, CanvasRenderer } from 'illustrator-viewer/core'
import wasmUrl from 'illustrator-viewer/wasm/ai_viewer_wasm.wasm?url'

export function AiPreview({ file }: { file: File | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!file || !canvasRef.current) return

    let disposed = false
    let client: AIWorkerClient | null = null
    let renderer: CanvasRenderer | null = null

    const load = async () => {
      client = new AIWorkerClient({ wasmUrl })
      const result = await client.parse(file)

      if (disposed || !result.ok || !result.report.scene) return
      if (!canvasRef.current) return

      renderer = new CanvasRenderer(canvasRef.current, { background: '#ffffff' })
      renderer.setDocument(result.report.scene)
    }

    load().catch(console.error)

    return () => {
      disposed = true
      renderer?.destroy()
      client?.terminate()
    }
  }, [file])

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 600 }} />
}
```

`illustrator-viewer/core` 不依赖 Vue，只包含解析、Worker、Scene Graph、Canvas 和工具函数。

更多示例见 [`docs/REACT.md`](https://github.com/GHchenjingqi/illustrator-viewer/blob/main/docs/REACT.md)。

---

## 4. API

### 4.1 `AiViewer` 组件

**Props**

| 名称 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `file` | `File \| Blob \| null` | `null` | 要预览的文件 |
| `width` | `Number \| String` | `'100%'` | 容器宽度 |
| `height` | `Number \| String` | `'auto'` | 容器高度；`auto` 时画布高度 520px |
| `zoom` | `Boolean` | `true` | 显示缩放工具栏 |
| `draggable` | `Boolean` | `true` | 允许拖拽平移 |
| `fullscreen` | `Boolean` | `true` | 显示全屏按钮 |
| `maxFileSize` | `Number` | `512 * 1024 * 1024` | 最大文件字节数 |
| `worker` | `Boolean` | `true` | 是否使用 Worker |
| `wasmUrl` | `String` | `''` | 可选 WASM 地址；为空时使用默认 `/wasm/...` |
| `chrome` | `Boolean` | `true` | 显示标题、工具栏、提示和统计；设为 `false` 时只渲染画布 |

**Events**

| 事件 | 参数 | 说明 |
|---|---|---|
| `file-change` | `{ file }` | 开始加载新文件 |
| `progress` | `{ phase, ratio, message }` | 解析进度 |
| `loaded` | `{ report, scene }` | 解析完成 |
| `error` | `{ code, message, details }` | 解析失败 |
| `compatibility` | `compatibility` | 兼容性报告 |
| `zoom-change` | `number` | 缩放百分比 |
| `artboard-change` | `{ index, artboard }` | 画板切换 |

**Expose**

`load(file)`、`clear()`、`cancel()`、`fit()`、`actualSize()`、`getReport()`

### 4.2 `AIParserEngine`

```js
new AIParserEngine({
  maxFileSize,   // number，默认 512 MiB
  chunkSize,     // 读取分块
  hash,          // 是否计算 SHA-256，默认 true
  wasm,          // 是否启用 WASM，默认 true
  wasmBytes,     // 直接提供 WASM 字节
  wasmUrl,       // WASM URL
})
```

`parse(source, options)` 返回：

```ts
{
  ok: boolean,
  stage: number,
  report?: {
    schemaVersion,
    file: { name, size, sha256 },
    detection: { container, aiFormatVersion, creator, ... },
    structure: { markers, aiTags, pageBoxHints },
    privateData: { status, compression, decodedBytes, chunkCount, ... },
    graphics: { status, tokenCount, vectorCount, vectors, artboards, ... },
    scene: { artboards, stats, compatibility },
    compatibility: { overall, features, note },
    diagnostics: Diagnostic[],
    durationMs
  },
  error?: { code, message, details },
  aborted: boolean
}
```

### 4.3 主要导出

| 导出 | 用途 |
|---|---|
| `AIParserEngine` | 完整解析入口 |
| `AiViewer` | Vue 3 预览组件（完整入口） |
| `illustrator-viewer/core` | 无 Vue 的解析 / 渲染入口，供 React 等使用 |
| `AIWorkerClient` | Worker 解析客户端 |
| `CanvasRenderer` | Scene Graph 渲染器 |
| `buildScene` / `cmykToRgb` | 场景构建与颜色转换 |
| `detectStructure` | 容器与结构检测 |
| `extractAi24Zstd` | AI24 zstd 私有数据解码 |
| `parsePostScript` / `tokenizePostScript` | 绘图文本解析 |
| `WasmBridge` / `loadWasmModule` | WASM 加载与桥接 |
| `AiViewerError` / `ErrorCodes` / `createDiagnostic` | 错误与诊断模型 |
| 矩阵工具 | `concatMatrix`、`multiplyMatrix`、`transformPoint` 等 |

完整导出见 [`src/index.js`](https://github.com/GHchenjingqi/illustrator-viewer/blob/main/src/index.js)。

---

## 5. 构建与发布

### 5.1 构建 npm 包

```bash
npm install
npm run build
```

`npm run build` 执行 `scripts/build-package.mjs`，使用 Vite library mode 输出：

```text
dist/
├── illustrator-viewer.js          # Vue / 完整入口（含内联 Worker）
├── illustrator-viewer-core.js     # 无 Vue 的 core 入口，供 React 等使用
├── AIWorkerClient-*.js            # 两个入口共享的解析 / Worker 代码
├── style.css                      # AiViewer / ScenePreview 样式
└── wasm/ai_viewer_wasm.wasm       # 可选 WASM 加速模块
```

构建脚本会校验：

- 入口、core 入口、样式、WASM 产物存在且非空
- `core` 入口不包含 Vue 依赖
- 没有残留未打包的 `fzstd` 裸模块说明符
- 没有把演示用 `public/samples` 打进包
- `package.json` 的 `private`、`exports`、`files` 配置正确

### 5.2 发布前检查

```bash
npm pack --dry-run
```

当前发布内容约 8 个文件、100 KB（压缩后），只包含 `dist/`、`README.md`、`LICENSE` 和 `package.json`。

### 5.3 发布

```bash
npm version patch   # 或 minor / major
npm publish
```

`prepack` 会在 `npm pack` / `npm publish` 前自动重新构建，避免发布旧产物。

包配置要点：

- `"type": "module"`，只提供 ESM
- `vue` 是完整入口的 peer dependency；`illustrator-viewer/core` 不需要 Vue
- `fzstd` 已打进产物，不需要宿主安装
- `exports` 提供 `illustrator-viewer/core`、`illustrator-viewer/style.css` 与 `illustrator-viewer/wasm/ai_viewer_wasm.wasm`
- `files` 白名单只发布构建产物与文档

### 5.4 演示站构建

```bash
npm run build:demo   # 输出 dist-demo/
npm run preview      # 预览 dist-demo/
```

---

## 6. 开发与测试

```bash
npm install
npm run generate:samples   # 生成合成样本
npm run dev                # 开发服务器（默认 5173）
```

### 6.1 命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动演示页开发服务器 |
| `npm run build` | 构建可发布 npm 包到 `dist/` |
| `npm run build:demo` | 构建演示站到 `dist-demo/` |
| `npm run build:wasm` | 重新构建 Rust/WASM 并复制到 `public/wasm` |
| `npm run benchmark:wasm` | WASM vs JS 基准 |
| `npm test` | Vitest：19 个文件 / 112 项 |
| `npm run test:watch` | Vitest watch |
| `npm run test:e2e` | Playwright：Chromium / Firefox / WebKit 21 项 |
| `npm run test:e2e:update` | 更新截图基线 |
| `npm run inspect -- file.ai --write` | 输出结构/解析报告 JSON |

真实样本缺失时，相关集成与 E2E 测试自动跳过。

### 6.2 测试样本策略

| 目录 | 类型 | 用途 | 作为兼容性证据 |
|---|---|---|---|
| `tests/fixtures/synthetic/` | 脚本生成的合成结构 | 单元测试、UI 演示 | **不能** |
| `tests/fixtures/real/` | 真实 Illustrator 导出文件 | 真实校准与回归 | 能（默认 gitignore） |

真实 `.ai` 可能包含商业素材，默认不提交。请自行放入 `tests/fixtures/real/` 后运行：

```bash
npm run inspect -- tests/fixtures/real/your-file.ai --write
npm test
npm run test:e2e
```

---

## 7. 兼容性与真实样本

### 7.1 样本结果

| 样本 | 应用版本 | 容器 | 私有数据 | 解析结果 | 画板 | 兼容性 |
|---|---|---|---|---|---|---|
| `lengdong-logo.ai` | Illustrator 29.3 / AI24 | PDF 1.6 | 8 个 stream 分块 → 8,124,703 B | 841 原始 / 259 可见 | 1250 × 700 | `PARTIAL` |
| `wuyingying.ai` | Illustrator 28.1 / AI24 | PDF 1.6 | 1 个 stream → 248,803 B | 82 矢量 | A4 595.276 × 841.890 | `PARTIAL` |

第一个样本：

- 65,114 tokens / 12,496 操作符 / 0 未知操作符
- PDF `/ArtBox` 过滤 582 个隐藏/参考副本
- 540 渐变 / 252 专色或自定义 / 48 Gray / 1 无填充
- Canvas 实际绘制 258 个对象（1 个剪裁蒙版合并）
- 完整解析约 350 ms（Node 环境）

第二个样本验证了两个边界情况：

- zstd stream 尾部带 `\r`：解码器会裁剪尾随空白后重试
- 绘图文本使用 **CR-only 换行**：词法器同时识别 `\n`、`\r\n`、`\r`

**关于重复 Logo：** AI 私有层实际包含多份参考/隐藏副本（共 841 个路径），PDF `/ArtBox` 只覆盖可见内容（259 个路径）。我们解析 `ArtBox` 并过滤范围外图形，报告标注 `PDF_ARTBOX_VISIBILITY`。这是可见范围提示，不代表已完整还原 Illustrator 原生隐藏/裁剪语义。

**关于剪裁蒙版：** 真实样本中 `R` 是“黑色外轮廓 + 渐变内容”的复合组，PDF 将其导出为 `W n` 剪裁路径 + 渐变填充。当前渲染器按剪裁蒙版处理，并把内孔路径合并为 even-odd 复合路径，保留镂空。该规则是启发式，仍需更多真实样本验证。

### 7.2 功能矩阵

| 能力 | 状态 | 说明 |
|---|---|---|
| PDF / EPS / PostScript 识别 | ✅ | 含 DOS EPS 二进制头 |
| AI24 zstd 私有数据 | ✅ | 多 stream 分块、尾部空白容错 |
| AI12 zlib / AI9 ASCII85 | ✅ | 合成样本与真实结构验证 |
| 标准 PostScript 子集 | ✅ | 白名单操作符，不执行过程体 |
| 路径 / 复合路径 / evenodd | ✅ | Canvas Path2D |
| RGB / CMYK / Gray | ✅ | CMYK 使用近似转换 |
| 渐变 | ⚠️ | 停靠点真实，方向/几何近似 |
| 专色 | ⚠️ | 近似 RGB，`Xa` 7 分量语义待确认 |
| Scene Graph | ✅ | 相对变换由逆矩阵计算 |
| 原生画板 | ✅ | DocumentData `ArtboardArray`，边界校验 |
| PDF `/ArtBox` 可见范围 | ✅ | 过滤隐藏/参考副本，显式诊断 |
| 剪裁蒙版 | ⚠️ | 启发式识别“黑色外轮廓 + 渐变” |
| 嵌入图片 | ❌ | 未解码 |
| 文字对象 | ❌ | 常见导出为轮廓路径；可编辑文字未渲染 |
| 透明度 / 混合模式 | ❌ | 未渲染，界面提示 |
| 图案 / 画笔 | ❌ | 未渲染 |
| PDF 预览图 | ❌ | 明确不使用预览图冒充原生解析 |
| 超大文件（>100 MB） | ⚠️ | 受浏览器内存限制 |

### 7.3 浏览器验证

| 浏览器 | E2E | 真实样本耗时 |
|---|---|---|
| Chromium (Playwright) | ✅ 7/7 | ~2.2 s |
| Firefox | ✅ 7/7 | ~2.1 s |
| WebKit | ✅ 7/7 | ~4–8 s |

---

## 8. 已实现能力

### 阶段 1–2：文件与解析

- File / Blob / ArrayBuffer / Uint8Array，流式进度、取消、SHA-256。
- PDF / DOS EPS / EPS / PostScript 容器识别。
- AI12 zlib、AI9 ASCII85+zlib、AI24 分块 Zstandard。
- 绘图段识别：`%AI5_BeginLayer`、`%%BeginData` 二进制块跳过。
- 标准 PostScript + AI 私有操作符：`C/L/H/V/Y/F/N`、`Lb/Ln`、`u/U/*u/*U`、`Bb/BB/Bg/Xm/Bc/Bm`、`Xa/XA` 等。
- 提取路径、线段、矩形、复合子路径、RGB/CMYK/Gray、渐变/专色标记、线型、CTM、包围盒。
- 可见范围：解析 PDF `/ArtBox`，过滤范围外隐藏/参考副本（诊断 `PDF_ARTBOX_VISIBILITY`）。
- 渐变停靠点：解析 `%_BS` 行的位置与 RGB/CMYK，Canvas 用线性渐变渲染。
- 原生画板：DocumentData `ArtboardArray` 名称 / PositionPoint1/2 / 矩形；BoundingBox/MediaBox 回退。

### 阶段 3：Scene Graph

- `Document → Artboard → Layer / Group / Compound → Shape` 层级。
- 用逆矩阵把绝对 CTM 转换为组内相对变换，避免重复变换。
- 图层事件、组事件、复合路径事件、画板归属。
- 渐变/专色标记 `approximate` + 停靠点/近似 RGB，不冒充完整还原。

### 阶段 4：Canvas 预览

- 原生 Canvas 2D、DPR 高清适配。
- 适应窗口、1:1、滚轮缩放、拖拽平移、全屏、多画板切换。
- 填充 / 描边 / 虚线 / evenodd / 复合路径 / 非打印跳过。
- 明确“部分预览”提示：渐变/专色使用近似几何/颜色，嵌入图片/裁剪/透明度未渲染。
- 剪裁蒙版：黑色外轮廓 + 渐变内容按 clip 处理，内孔参与 even-odd 复合路径。

### 阶段 5：WASM 加速

- 自研 Rust 模块（`wasm-src/`）：Aho-Corasick 多模式扫描、仿射包围盒、批量坐标变换。
- 主链路使用 WASM 多模式标记扫描，一次遍历所有标记。
- JS 始终保留完整回退；WASM 加载失败不影响预览。
- 16 MB 扫描基准：**JS 56.8 ms → WASM 31.2 ms（约 1.8×）**，结果一致。
- 512 KB 扫描：约 **1.8×**。
- 包围盒 WASM 接口已实现并测试；逐对象调用受内存拷贝开销影响，主链路默认仍用 JS。

### 阶段 6：Worker 与组件

- `AIWorker` + `AIWorkerClient`：后台解析、进度、取消、任务 ID 防旧结果覆盖。
- Worker 以内联方式打包，发布后无需额外复制 Worker 文件；加载失败回退主线程。
- 可复用 `AiViewer.vue`：file/width/height/zoom/draggable/fullscreen/maxFileSize/worker/wasmUrl/chrome props。
- ScenePreview 支持 zoom/draggable/fullscreen 开关与 zoom/artboard 事件。

### 阶段 7：兼容性与性能

- Playwright 三浏览器 21 项 E2E，含滚轮缩放、文件切换、损坏文件、两个真实样本。
- Canvas 图像对比基线（合成 AI12）。
- 性能报告：[`docs/PERFORMANCE.md`](https://github.com/GHchenjingqi/illustrator-viewer/blob/main/docs/PERFORMANCE.md)。

---

## 9. 明确未实现

- 渐变几何（方向/径向/矩阵）的精确还原（当前使用停靠点 + 近似线性渐变）
- 专色颜色空间的精确还原（`Xa` 7 分量语义待确认）
- 嵌入图片解码、可编辑文字、图案/画笔
- 透明度组、混合模式、完整裁剪路径语义
- 自研 WASM zstd 解压（当前使用 `fzstd` JS）
- 超大文件（>100 MB）与更多历史 AI 版本
- 跨平台自动化图像基线（当前基线在 Windows 生成）

---

## 10. 架构

```
File / Blob / ArrayBuffer
        │  AIFileReader（流式读取 / 进度 / 取消 / SHA-256）
        ▼
   BinaryParser（边界检查 / ASCII85 / zlib）
        ▼
  AIFileDetector（容器 / 版本 / 私有数据 / 页面边界）
        │   AI24：PDF stream 分块 + fzstd 解压
        │   WASM：多模式标记扫描（失败自动回退 JS）
        ▼
 PostScriptLexer → PostScriptParser（白名单 + AI 私有操作符）
        │   跳过 %%BeginData 二进制块
        ▼
   VectorParser（路径 / 颜色 / 线型 / 包围盒）
        ▼
   SceneBuilder（Document → Artboard → Layer/Group/Compound → Shape）
        │   DocumentData 原生画板 + 渐变/专色近似色
        ▼
 CanvasRenderer（DPR / 适应 / 缩放 / 平移 / 复合路径）
        ▼
 ScenePreview.vue（画布 / 工具栏 / 全屏 / 部分预览提示）
```

设计原则：

1. **解析与渲染分离**：`CanvasRenderer` 只消费 Scene Graph。
2. **JS 独立可运行**：WASM 只加速，不改变结果语义。
3. **Worker 可回退**：Worker 失败时主线程继续解析。
4. **显式降级**：近似或未支持的效果通过 `diagnostics` / `compatibility` / UI 明确提示。

---

## 11. 项目结构

```text
.
├── public/
│   ├── samples/                 # 合成样本（演示用，不进入 npm 包）
│   └── wasm/ai_viewer_wasm.wasm # 自研 WASM 产物
├── wasm-src/                    # Rust WASM 源码
│   ├── Cargo.toml
│   └── src/lib.rs
├── scripts/
│   ├── build-package.mjs        # npm 包构建与产物校验
│   ├── build-wasm.mjs
│   ├── benchmark-wasm.mjs
│   ├── generate-synthetic-samples.mjs
│   └── inspect-ai.mjs
├── src/
│   ├── components/
│   │   ├── AiInspector.vue
│   │   ├── AiViewer.vue
│   │   ├── ScenePreview.vue
│   │   └── viewer-base.css
│   ├── core/
│   │   ├── AIFileReader.js
│   │   ├── AIFileDetector.js
│   │   ├── BinaryParser.js
│   │   ├── AI24Extractor.js
│   │   ├── AIArtboardExtractor.js
│   │   ├── AIGradientExtractor.js
│   │   ├── PostScriptLexer.js
│   │   ├── PostScriptParser.js
│   │   ├── PostScriptGraphicsState.js
│   │   ├── VectorParser.js
│   │   ├── PageBoxExtractor.js
│   │   └── AIParserEngine.js
│   ├── scene/SceneBuilder.js
│   ├── renderer/
│   │   ├── CanvasRenderer.js
│   │   ├── PathRenderer.js
│   │   └── TextRenderer.js（预留）
│   ├── engine/
│   │   ├── ColorEngine.js
│   │   ├── CompatibilityEngine.js
│   │   └── TransformEngine.js
│   ├── wasm/
│   │   ├── WasmLoader.js
│   │   └── WasmBridge.js
│   ├── worker/
│   │   ├── AIWorker.js
│   │   └── AIWorkerClient.js
│   ├── utils/
│   ├── index.js                 # npm 包入口
│   └── styles.css               # 演示页全局样式
├── tests/
│   ├── parser/
│   ├── renderer/
│   ├── wasm/
│   ├── integration/
│   └── fixtures/
├── docs/
├── vite.config.js               # 演示站 + Vitest
├── vite.lib.config.js           # npm 包 library mode
├── package.json
└── LICENSE
```

---

## 12. 设计约束

- 不上传文件、不访问外部网络。
- 不引入第三方 AI 预览 SDK，不使用 PDF.js。
- 不读取 PDF 预览图冒充原生解析。
- 不执行 AI/PostScript 过程体、文件/网络/系统操作。
- 渐变/专色未完整还原时使用近似几何/颜色并明确标注。
- WASM 只做加速，JavaScript 基础链路始终可独立运行。
- 真实商业样本默认不提交 Git。

---

## 13. 依赖与研究来源

运行时依赖：

- [Vue 3](https://vuejs.org/) — peer dependency
- [fzstd](https://www.npmjs.com/package/fzstd) — MIT，Zstandard JS 解压；已打包进产物，不含 AI 解析逻辑

研究参考（未复制源码）：

- [Pilser/illustrator-rs](https://github.com/Pilser/illustrator-rs) — MIT，格式/操作符表研究参考
- [opendesigndev/illustrator-parser-pdfcpu](https://github.com/opendesigndev/illustrator-parser-pdfcpu) — Apache-2.0，架构参考
- [flyfish-dev/file-viewer](https://github.com/flyfish-dev/file-viewer) — Apache-2.0，兼容性诊断参考

自研 WASM：`wasm-src/src/lib.rs`。

更多文档：

- [`docs/AI-FORMAT.md`](https://github.com/GHchenjingqi/illustrator-viewer/blob/main/docs/AI-FORMAT.md)
- [`docs/REACT.md`](https://github.com/GHchenjingqi/illustrator-viewer/blob/main/docs/REACT.md)
- [`docs/PARSER-ARCHITECTURE.md`](https://github.com/GHchenjingqi/illustrator-viewer/blob/main/docs/PARSER-ARCHITECTURE.md)
- [`docs/RENDERER-ARCHITECTURE.md`](https://github.com/GHchenjingqi/illustrator-viewer/blob/main/docs/RENDERER-ARCHITECTURE.md)
- [`docs/COMPATIBILITY.md`](https://github.com/GHchenjingqi/illustrator-viewer/blob/main/docs/COMPATIBILITY.md)
- [`docs/PERFORMANCE.md`](https://github.com/GHchenjingqi/illustrator-viewer/blob/main/docs/PERFORMANCE.md)

---

## 14. 项目链接

- **GitHub 仓库：** <https://github.com/GHchenjingqi/illustrator-viewer>
- **npm 包：** <https://www.npmjs.com/package/illustrator-viewer>
- **问题反馈 / Issues：** <https://github.com/GHchenjingqi/illustrator-viewer/issues>
- **Releases：** <https://github.com/GHchenjingqi/illustrator-viewer/releases>
- **完整文档：** <https://github.com/GHchenjingqi/illustrator-viewer/tree/main/docs>

在 GitHub 仓库的 **About → Topics** 中建议填写：

```text
illustrator, adobe-illustrator, illustrator-viewer, ai-file,
postscript, canvas, vue3, wasm, parser, preview, scene-graph
```

---

## 15. License

[MIT](https://github.com/GHchenjingqi/illustrator-viewer/blob/main/LICENSE)
