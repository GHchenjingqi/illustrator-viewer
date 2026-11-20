# AI Viewer Engine

> 浏览器本地运行的 Adobe Illustrator `.ai` 文件解析、Scene Graph 与 Canvas 预览引擎。
> 自主实现 JavaScript 解析链路 + Rust/WASM 加速，不使用 PDF.js、Photopea、Ghostscript 等第三方预览/转换引擎。

**当前状态：阶段 1–7 已完成。真实 AI24 样本（Illustrator 29.3）已能在 Worker 中解析，并在 Canvas 中预览；841 个原始路径经 PDF ArtBox 过滤后显示 259 个可见图形。**

开发页面：`npm run dev` 后打开终端输出地址（默认 `http://localhost:5173`）。

---

## 1. 当前链路

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

## 2. 已实现能力

### 阶段 1–2：文件与解析

- File / Blob / ArrayBuffer / Uint8Array，流式进度、取消、SHA-256。
- PDF / DOS EPS / EPS / PostScript 容器识别。
- AI12 zlib、AI9 ASCII85+zlib、**AI24 分块 Zstandard**。
- 绘图段识别：`%AI5_BeginLayer`、`%%BeginData` 二进制块跳过。
- 标准 PostScript + AI 私有操作符：`C/L/H/V/Y/F/N`、`Lb/Ln`、`u/U/*u/*U`、`Bb/BB/Bg/Xm/Bc/Bm`、`Xa/XA` 等。
- 提取路径、线段、矩形、复合子路径、RGB/CMYK/Gray、渐变/专色标记、线型、CTM、包围盒。
- 可见范围：解析 PDF `/ArtBox`，过滤 ArtBox 之外的隐藏/参考副本（诊断 `PDF_ARTBOX_VISIBILITY`）。
- 渐变停靠点：解析 `%_BS` 行的位置与 RGB/CMYK，Canvas 用线性渐变渲染；方向/几何仍标记为近似。
- 原生画板：DocumentData `ArtboardArray` 名称 / PositionPoint1/2 / 矩形；BoundingBox/MediaBox 回退。

### 阶段 3：Scene Graph

- `Document` → `Artboard` → `Layer` / `Group` / `Compound` → `Shape` 层级。
- 相对变换：用逆矩阵把绝对 CTM 转换为组内相对变换，避免重复变换。
- 图层事件、组事件、复合路径事件、画板归属。
- 渐变/专色标记 `approximate` + 停靠点/近似 RGB；**不冒充完整还原**。

### 阶段 4：Canvas 预览

- 原生 Canvas 2D、DPR 高清适配。
- 适应窗口、1:1、滚轮缩放、拖拽平移、全屏、多画板切换。
- 填充 / 描边 / 虚线 / evenodd / 复合路径 / 非打印跳过。
- 明确“部分预览”提示：渐变/专色使用近似几何/颜色，嵌入图片/裁剪/透明度未渲染。
- 剪裁蒙版：黑色外轮廓 + 渐变内容按 clip 处理（本样本的 `R` 已恢复为渐变字）。

### 阶段 5：WASM 加速

- 自研 Rust 模块（`wasm-src/`）：Aho-Corasick 多模式扫描、仿射包围盒、批量坐标变换。
- 当前主链路使用 **WASM 多模式标记扫描**；单次遍历所有标记。
- JS 始终保留完整回退；WASM 加载失败不影响预览。
- 16 MB 扫描基准：**JS 56.8 ms → WASM 31.2 ms（约 1.8×）**，结果一致。
- 512 KB 扫描：约 **1.8×**。
- 包围盒 WASM 接口已实现并测试，但逐对象调用受内存拷贝开销影响，主链路默认仍用 JS；后续可做批量接口。

### 阶段 6：Worker 与组件

- `AIWorker` + `AIWorkerClient`：后台解析、进度、取消、任务 ID 防旧结果覆盖。
- Worker 失败自动回退主线程。
- 可复用 `AiViewer.vue`：file/width/height/zoom/draggable/fullscreen/maxFileSize/worker props，完整事件。
- ScenePreview 支持 zoom/draggable/fullscreen 开关与 zoom/artboard 事件。

### 阶段 7：兼容性与性能

- Playwright：Chromium / Firefox / WebKit 三浏览器，15 项 E2E。
- Canvas 图像对比基线（合成 AI12）。
- 真实 AI24 样本在三种浏览器均渲染 841 图形。
- 文件切换连续测试：旧结果不覆盖新结果。
- 性能报告：`docs/PERFORMANCE.md`。

## 3. 真实样本验证

本地样本：`tests/fixtures/real/lengdong-logo.ai`（默认不提交 Git）

| 项目 | 结果 |
|---|---|
| 文件 | 569,228 B · SHA-256 `57847b69…cb588` |
| 容器 / 版本 | PDF 1.6 · Creator 24.0 · 应用 29.3.0 · AI24 |
| 私有数据 | 对象 11–18，8 个 stream 分块 → 8,124,703 字节 |
| 解析 | 65,114 tokens / 12,496 操作符 / **841 矢量（原始）** / 0 未知操作符 |
| Scene Graph | 1 画板 / 2 图层 / 27 组 / 39 复合路径 / **259 可见图形**（PDF ArtBox 过滤 582 个隐藏/参考副本） |
| 画板 | 原生「画板 1」`1250 × 700` |
| 颜色 | 540 渐变 / 252 专色或自定义 / 48 Gray / 1 无填充 |
| 渲染 | Canvas 259 场景图形（实际绘制 258，1 个剪裁蒙版）；近似渐变/颜色明确提示 || 性能 | 完整解析约 350 ms；WASM 扫描 569 KB 一次调用 |

> 只有 1 个 AI24 真实样本；AI 8 / 10 / CS / CS6 / 其他 CC 版本仍需补充。

**关于图二中的重复 Logo：** AI 私有层实际包含多份参考/隐藏副本（共 841 个路径），PDF `/ArtBox` 只覆盖中间那份可见内容（259 个路径）。我们解析 `ArtBox` 并过滤范围外图形，报告标注 `PDF_ARTBOX_VISIBILITY`。这是可见范围提示，不代表已完整还原 Illustrator 原生隐藏/裁剪语义。

## 4. 明确未实现

- 渐变几何（方向/径向/矩阵）与真实渐变完全还原（当前使用停靠点 + 近似几何）
- 专色颜色空间精确还原（`Xa` 7 分量语义待确认）
- 嵌入图片解码、文字对象、裁剪路径、透明度组、图案/画笔的最终渲染
- 自研 WASM zstd 解压（当前 fzstd JS）
- 超大文件（>100 MB）、更多 AI 版本、跨平台自动化图像基线

## 5. 快速开始

要求：Node.js `>= 22.12`，npm 10+；Rust + `wasm32-unknown-unknown` 仅在重新构建 WASM 时需要。

```bash
npm install
npm run generate:samples
npm run dev
```

其他命令：

```bash
npm test                    # 16 个测试文件 / 105 项测试
npm run test:e2e            # Playwright 三浏览器 15 项 E2E
npm run test:e2e:update     # 重新生成截图基线
npm run build               # 前端生产构建
npm run build:wasm          # 重新构建 Rust/WASM 并复制到 public/wasm
npm run benchmark:wasm      # WASM vs JS 基准
npm run inspect -- tests/fixtures/real/your-file.ai --write
```

## 6. 测试样本策略

| 目录 | 类型 | 用途 | 是否作为兼容性证据 |
|---|---|---|---|
| `tests/fixtures/synthetic/` | 脚本生成的合成结构 | 单元测试、UI 演示 | **不能** |
| `tests/fixtures/real/` | 真实 Illustrator 导出文件 | 真实校准 | 能（默认 gitignore） |

真实样本默认不提交，避免商业素材进入仓库。真实样本集成测试位于 `tests/integration/real-ai24.test.js`，文件不存在时自动跳过。

## 7. 项目结构

```
.
├── public/
│   ├── samples/                 # 合成样本
│   └── wasm/ai_viewer_wasm.wasm # 自研 WASM 产物
├── wasm-src/                    # Rust WASM 源码
│   ├── Cargo.toml
│   └── src/lib.rs
├── scripts/
│   ├── build-wasm.mjs
│   ├── benchmark-wasm.mjs
│   ├── generate-synthetic-samples.mjs
│   └── inspect-ai.mjs
├── src/
│   ├── components/
│   │   ├── AiInspector.vue
│   │   ├── AiViewer.vue
│   │   └── ScenePreview.vue
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
│   ├── index.js
│   └── styles.css
├── tests/
│   ├── parser/
│   ├── renderer/
│   ├── wasm/
│   ├── integration/
│   └── fixtures/
├── docs/
└── package.json
```

## 8. 阶段进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 项目初始化、格式研究、结构检测 | ✅ |
| 2 | PostScript / AI24 zstd / 矢量提取 / 原生画板 | ✅ |
| 3 | Scene Graph | ✅ |
| 4 | Canvas Renderer 与预览交互 | ✅（部分颜色近似） |
| 5 | WebAssembly 扫描加速 | ✅（JS 回退） |
| 6 | Worker 与 AiViewer.vue 组件化 | ✅ |
| 7 | 兼容性与性能测试 | ✅（三浏览器 E2E） |

阶段报告：

- [`docs/STAGE-1-REPORT.md`](docs/STAGE-1-REPORT.md)
- [`docs/STAGE-2-REPORT.md`](docs/STAGE-2-REPORT.md)
- [`docs/STAGE-3-REPORT.md`](docs/STAGE-3-REPORT.md)
- [`docs/STAGE-4-REPORT.md`](docs/STAGE-4-REPORT.md)
- [`docs/STAGE-5-REPORT.md`](docs/STAGE-5-REPORT.md)
- [`docs/STAGE-6-REPORT.md`](docs/STAGE-6-REPORT.md)
- [`docs/STAGE-7-REPORT.md`](docs/STAGE-7-REPORT.md)
- [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md)

## 9. 设计约束

- 不上传文件、不访问外部网络。
- 不引入第三方 AI 预览 SDK，不使用 PDF.js。
- 不读取 PDF 预览图冒充原生解析。
- 不执行 AI/PostScript 过程体、文件/网络/系统操作。
- 渐变/专色未完整还原时使用近似几何/颜色并明确标注，不声称完整还原。
- WASM 只做加速，JavaScript 基础链路始终可独立运行。

## 10. 研究来源与第三方依赖

- [Pilser/illustrator-rs](https://github.com/Pilser/illustrator-rs) — MIT，格式/操作符表研究参考，未复制源码。
- [opendesigndev/illustrator-parser-pdfcpu](https://github.com/opendesigndev/illustrator-parser-pdfcpu) — Apache-2.0，架构参考。
- [flyfish-dev/file-viewer](https://github.com/flyfish-dev/file-viewer) — Apache-2.0，兼容性诊断参考。
- [fzstd](https://www.npmjs.com/package/fzstd) — MIT，Zstandard JS 解压；不含 AI 解析逻辑。
- 自研 WASM：`wasm-src/src/lib.rs`（本项目代码）。

详见 [`docs/AI-FORMAT.md`](docs/AI-FORMAT.md)、[`docs/PARSER-ARCHITECTURE.md`](docs/PARSER-ARCHITECTURE.md)、[`docs/RENDERER-ARCHITECTURE.md`](docs/RENDERER-ARCHITECTURE.md)。
