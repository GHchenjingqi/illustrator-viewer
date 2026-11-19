# AI Viewer Engine

> 浏览器本地运行的 Adobe Illustrator `.ai` 文件解析与预览引擎。
> 自主实现 JavaScript 解析链路 + Canvas 渲染，不使用 PDF.js、Photopea、Ghostscript 等第三方预览/转换引擎。

**当前状态：阶段 1（项目初始化与文件结构检测）已完成，矢量解析与渲染尚未实现。**

---

## 1. 当前能做什么

阶段 1 实现了一条可独立运行的 JavaScript 结构检测链路：

```
File / Blob / ArrayBuffer
        │  AIFileReader（流式读取、进度、取消、SHA-256）
        ▼
   BinaryParser（边界检查、字节搜索、ASCII85、zlib 解压）
        │
        ▼
  AIFileDetector（容器识别 + 版本 + 私有数据 + 诊断）
        │
        ▼
 CompatibilityEngine（FULL / PARTIAL / UNSUPPORTED / INVALID）
        │
        ▼
   AiInspector.vue（拖拽上传、结构报告可视化）
```

已支持：

- 读取 `File` / `Blob` / `ArrayBuffer` / `Uint8Array`，流式进度与取消。
- 识别 PDF 容器（`%PDF-1.x`）、DOS EPS 二进制头（`0xC5D0D3C6`）、PostScript（`%!PS-Adobe`）与 EPS（`%%BoundingBox`）。
- 识别 Illustrator Creator 版本与 `%AI<n>_` 私有格式标记。
- 定位并解码：
  - `%AI12_CompressedData` → zlib
  - `%AI24_ZStandard_Data` → Zstandard（取决于运行环境是否支持 `DecompressionStream('zstd')`）
  - `%AI9_PrivateDataBegin` → ASCII85（可嵌套 zlib）
- 输出结构化检测报告：文件信息、容器、版本、标记偏移、私有数据预览、能力矩阵、诊断信息。
- 所有解析异常转换为结构化错误，页面不会崩溃。
- 34 项单元测试，覆盖读取、二进制边界、ASCII85、zlib、容器识别与引擎调度。

尚未实现（故意不标记为支持）：

- PostScript / PGF 词法与语法解析
- 路径、颜色、填充、描边的提取
- Scene Graph
- Canvas 渲染与预览交互
- 多画板、文本、图片、渐变
- WASM 加速、Web Worker 后台解析

---

## 2. 快速开始

要求：Node.js `>= 22.12`（Vite 8 要求），npm 10+。

```bash
npm install
npm run generate:samples   # 生成合成样本（仅结构检测演示）
npm run dev                # 开发服务器
```

打开终端输出的地址（默认 `http://localhost:5173`，端口被占用时会自动顺延）。

其他命令：

```bash
npm test                   # Vitest 单元测试（自动生成合成样本）
npm run build              # 生产构建
npm run preview            # 预览构建产物
npm run inspect -- tests/fixtures/real/your-file.ai --write   # 命令行检测真实文件
npm run generate:samples   # 重新生成合成样本与 manifest
```

---

## 3. 测试样本策略（重要）

需求文档明确禁止用改扩展名的方式伪造样本。本项目将样本分为两类：

| 目录 | 类型 | 用途 | 能否作为兼容性证据 |
|---|---|---|---|
| `tests/fixtures/synthetic/` | 脚本生成的合成结构 | 单元测试、UI 演示 | **不能** |
| `tests/fixtures/real/` | 真实 Illustrator 导出文件 | 兼容性验证 | 能 |

当前仓库**没有真实 AI 样本**，因此：

- 合成样本在 UI 中会显示醒目的黄色警告。
- 所有结果最多标记为“部分支持”，不会声称完成某种 AI 版本的兼容。
- 真实样本的登记方式见 [`tests/fixtures/real/README.md`](tests/fixtures/real/README.md)。

---

## 4. 项目结构

```
.
├── public/
│   ├── samples/                 # 合成样本（.bin，非真实 AI）
│   └── wasm/                    # 阶段 5 预留
├── scripts/
│   ├── generate-synthetic-samples.mjs
│   └── inspect-ai.mjs           # 命令行结构检测
├── src/
│   ├── components/
│   │   └── AiInspector.vue      # 阶段 1 UI（后续阶段替换为 AiViewer.vue）
│   ├── core/
│   │   ├── AIFileReader.js
│   │   ├── AIFileDetector.js
│   │   ├── BinaryParser.js
│   │   └── AIParserEngine.js
│   ├── engine/
│   │   └── CompatibilityEngine.js
│   ├── scene/                   # 阶段 3 预留
│   ├── renderer/                # 阶段 4 预留
│   ├── worker/                  # 阶段 6 预留
│   ├── wasm/                    # 阶段 5 预留
│   ├── utils/
│   ├── App.vue
│   ├── main.js
│   ├── styles.css
│   └── index.js                 # 公共导出
├── tests/
│   ├── fixtures/
│   └── parser/
├── docs/
│   ├── AI-FORMAT.md
│   ├── PARSER-ARCHITECTURE.md
│   ├── COMPATIBILITY.md
│   ├── RENDERER-ARCHITECTURE.md
│   └── STAGE-1-REPORT.md
├── plan.md
└── package.json
```

职责边界：解析器不直接接触 Canvas；Vue 组件只调用 `AIParserEngine`；兼容性判定独立于检测器。

---

## 5. 阶段进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 项目初始化、格式研究、结构检测 | ✅ 完成（真实样本验证待补） |
| 2 | 基础解析引擎（PostScript / PGF） | ⏳ 下一步 |
| 3 | Scene Graph | 计划 |
| 4 | Canvas Renderer | 计划 |
| 5 | WebAssembly 加速 | 计划 |
| 6 | Worker 与 AiViewer.vue | 计划 |
| 7 | 兼容性与性能测试 | 计划 |

阶段 1 的详细交付信息见 [`docs/STAGE-1-REPORT.md`](docs/STAGE-1-REPORT.md)。

---

## 6. 设计约束

- **不上传文件**，不访问外部网络，纯浏览器本地运行。
- **不引入第三方 AI 预览 SDK**，不把 PDF.js 作为解析或渲染依赖。
- **不读取 PDF 预览图冒充 AI 原生解析**；结构报告会区分“容器识别”和“图形解析”。
- **WASM 不是运行前提**：JavaScript 基础链路始终可独立工作（阶段 5 才接入 WASM）。
- **未知数据不静默丢弃**：检测阶段即输出标记、偏移与诊断；后续解析阶段将继续保留操作符与失败位置。

---

## 7. 研究来源与许可

阶段 1 仅研究公开资料中的格式思路，**没有复制第三方源码**：

- [Pilser/illustrator-rs](https://github.com/Pilser/illustrator-rs) — MIT，容器与私有数据提取思路参考。
- [opendesigndev/illustrator-parser-pdfcpu](https://github.com/opendesigndev/illustrator-parser-pdfcpu) — Apache-2.0，架构与测试组织参考；其 pdfcpu 依赖不进入本项目。
- [flyfish-dev/file-viewer](https://github.com/flyfish-dev/file-viewer) — Apache-2.0，兼容性诊断与多格式架构参考。
- Adobe Illustrator 兼容性指南（公开 PDF）。

详见 [`docs/AI-FORMAT.md`](docs/AI-FORMAT.md)。
