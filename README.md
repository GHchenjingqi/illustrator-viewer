# AI Viewer Engine

> 浏览器本地运行的 Adobe Illustrator `.ai` 文件解析与预览引擎。
> 自主实现 JavaScript 解析链路 + Canvas 渲染，不使用 PDF.js、Photopea、Ghostscript 等第三方预览/转换引擎。

**当前状态：阶段 2（基础解析引擎）已完成，并用 1 个真实 AI24 样本（Illustrator 29.3 导出）完成校准；矢量渲染仍待阶段 4。**

---

## 1. 当前链路

```
File / Blob / ArrayBuffer
        │  AIFileReader（流式读取、进度、取消、SHA-256）
        ▼
   BinaryParser（边界检查、字节搜索、ASCII85、zlib）
        │
        ▼
  AIFileDetector（容器 / 版本 / 私有数据 / 画板边界提示）
        │   AI24：PDF stream 分块拼接 → fzstd 解压
        ▼
 PostScriptLexer → PostScriptParser（白名单 + AI 私有操作符）
        │   跳过 %%BeginData 二进制块
        ▼
   VectorParser（路径 / 矩形 / 线段 / 颜色 / 线型 / 包围盒）
        │
        ▼
 AIArtboardExtractor（DocumentData → 原生画板）
        │
        ▼
 CompatibilityEngine + AiInspector.vue（结构化 JSON 与可视化）
```

## 2. 已支持

**文件与结构**

- `File` / `Blob` / `ArrayBuffer` / `Uint8Array` 读取，流式进度与取消。
- PDF 容器、DOS EPS、EPS、纯 PostScript 识别。
- Illustrator Creator / `%AI<n>_` / `AI8_CreatorVersion` / 图层数等元信息。
- 私有数据：
  - AI12 `%AI12_CompressedData` → zlib
  - AI9 `%AI9_PrivateDataBegin` → ASCII85（可嵌套 zlib）
  - **AI24 `%AI24_ZStandard_Data` → Zstandard，支持拆分为多个 PDF stream 的 64 KiB 分块**
  - 使用 `fzstd`（MIT，纯 JavaScript）作为 zstd 解码回退；阶段 5 将增加自研 WASM 路径
- 绘图文本中的 `%%BeginData: N` 二进制块会被安全跳过（不把图片字节当 PostScript）。
- 页面边界提示：BoundingBox / HiResBoundingBox / PageBoundingBox / MediaBox / CropBox。

**基础解析（阶段 2）**

- PostScript 词法：数字、名字、字符串、十六进制串、数组、字典、注释、过程边界。
- 标准绘图操作符 + AI 大写路径变体：
  - `m` / `l` / `L` / `c` / `C` / `v` / `V` / `y` / `Y` / `h` / `H` / `re` / `n` / `N` / `f` / `F` / `S` / `s` / `B` / `b`
  - 颜色：`rg` / `k` / `g` / `RG` / `K` / `G` / `cs` / `sc` / `scn` / `sethsbcolor` / `Xa` / `XA`
  - 线型：`w` / `J` / `j` / `M` / `d` / `D`
  - 变换：`translate` / `scale` / `rotate` / `cm` / `concat` / `gsave` / `grestore` / `q` / `Q`
- AI 私有结构（真实样本校准）：
  - 图层 / 组 / 复合路径：`Lb` / `Ln` / `LB` / `u` / `U` / `*u` / `*U`
  - 外观：`A` / `As` / `Ae` / `AE` / `Ap`
  - 渐变：`Bb` / `BB` / `Bg` / `Bc` / `Bm` / `Xm`（**标记为 gradient，不用黑色替代**）
  - 自定义颜色 `Xa` / `XA`（**标记为 custom，不猜测颜色空间**）
  - 栅格图 / 置入文件 / 图案：记录后跳过
- 提取矩形、线段、贝塞尔路径、复合子路径、RGB/CMYK/Gray、渐变/自定义颜色标记、线型、CTM 与包围盒。
- 原生画板：从 AI DocumentData 的 `ArtboardArray` 提取名称、PositionPoint1/2、矩形；另有边界提示作为回退。
- 未知操作符、裁剪、文字、图片、过程体全部记录诊断并安全跳过，不执行任意代码。

**工程**

- 10 个测试文件 / **80 项测试**，包含一个本地真实 AI24 样本集成测试（文件缺失时自动跳过）。
- Vite 8 生产构建通过。
- 结构化错误与诊断，页面不会因坏文件崩溃。
- 所有处理在浏览器本地完成，无网络请求、无文件上传。

## 3. 真实样本验证结果

本地样本：`tests/fixtures/real/lengdong-logo.ai`（默认不提交到 Git）

| 项目 | 结果 |
|---|---|
| 文件 | 569,228 B · SHA-256 `57847b69…cb588` |
| 容器 | PDF 1.6 |
| 版本 | Creator 24.0 / 应用版本 29.3.0 / AI24 私有格式 |
| 私有数据 | `%AI24_ZStandard_Data`，PDF 对象 11–18，8 个 stream 分块 |
| 解压 | 8/8 分块，7.75 MB 文本 |
| 解析 | 65,114 tokens / 12,496 个白名单操作符 / **841 个矢量对象** / 0 未知操作符 |
| 画板 | 原生画板「画板 1」`1250 × 700`（DocumentData） |
| 颜色 | 540 个渐变填充标记、252 个自定义颜色、48 个 Gray |
| 浏览器耗时 | 约 360 ms（含 zstd 解压与解析） |

## 4. 明确未实现

- Scene Graph（Document / Artboard / Group / Shape / Transform）
- Canvas 2D 矢量渲染、缩放、平移、多画板切换
- 渐变颜色表、透明度、裁剪、复合形状的实际渲染
- 可编辑文字、文字轮廓、嵌入图片解码
- AI 图层/分组完整语义、对象关系
- Zstandard 的 WASM 解压（当前为 JS 回退）
- Web Worker 后台解析、任务取消协议
- Playwright 图像对比与浏览器矩阵测试

## 5. 快速开始

要求：Node.js `>= 22.12`，npm 10+。

```bash
npm install
npm run generate:samples   # 生成合成样本
npm run dev                # 开发服务器
```

打开终端输出的地址（默认 `http://localhost:5173`，端口占用时自动顺延）。

```bash
npm test                   # 10 个测试文件 / 80 项测试
npm run build              # 生产构建
npm run preview            # 预览构建产物
npm run inspect -- tests/fixtures/real/your-file.ai --write
```

`inspect` 会输出完整解析 JSON，并在 `--write` 时生成 `<file>.report.json`。

## 6. 测试样本策略

| 目录 | 类型 | 用途 | 能否作为兼容性证据 |
|---|---|---|---|
| `tests/fixtures/synthetic/` | 脚本生成的合成结构 | 单元测试、UI 演示 | **不能** |
| `tests/fixtures/real/` | 真实 Illustrator 导出文件 | 兼容性验证 | 能（默认被 `.gitignore` 排除） |

- 合成样本在 UI 中显示黄色警告。
- 真实样本默认不提交，避免商业素材进入仓库。
- 真实样本测试位于 `tests/integration/real-ai24.test.js`，文件不存在时自动跳过。

## 7. 项目结构

```
.
├── public/samples/              # 合成样本（.bin，非真实 AI）
├── scripts/
│   ├── generate-synthetic-samples.mjs
│   └── inspect-ai.mjs
├── src/
│   ├── components/AiInspector.vue
│   ├── core/
│   │   ├── AIFileReader.js
│   │   ├── AIFileDetector.js
│   │   ├── BinaryParser.js
│   │   ├── AI24Extractor.js
│   │   ├── PostScriptLexer.js
│   │   ├── PostScriptParser.js
│   │   ├── PostScriptGraphicsState.js
│   │   ├── VectorParser.js
│   │   ├── PageBoxExtractor.js
│   │   ├── AIArtboardExtractor.js
│   │   └── AIParserEngine.js
│   ├── engine/
│   │   ├── CompatibilityEngine.js
│   │   └── TransformEngine.js
│   ├── utils/
│   │   ├── encoding.js
│   │   ├── zstd.js
│   │   ├── errors.js
│   │   └── format.js
│   ├── scene/ renderer/ worker/ wasm/   # 后续阶段预留
│   └── index.js
├── tests/
│   ├── fixtures/
│   ├── parser/
│   └── integration/
├── docs/
└── package.json
```

## 8. 阶段进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 项目初始化、格式研究、结构检测 | ✅ 完成 |
| 2 | PostScript 解析、AI24 zstd、矢量提取、原生画板 | ✅ 完成（1 个真实样本） |
| 3 | Scene Graph | ⏳ 下一步 |
| 4 | Canvas Renderer | 计划 |
| 5 | WebAssembly 加速（含 zstd） | 计划 |
| 6 | Worker 与 AiViewer.vue | 计划 |
| 7 | 兼容性与性能测试 | 计划 |

真实样本校准详情见 [`docs/STAGE-2-REPORT.md`](docs/STAGE-2-REPORT.md)。

## 9. 设计约束

- **不上传文件**，不访问外部网络，纯浏览器本地运行。
- **不引入第三方 AI 预览 SDK**，不把 PDF.js 作为解析或渲染依赖。
- **不读取 PDF 预览图冒充 AI 原生解析**。
- **不执行文件内脚本**：过程体、字典、未知操作符只记录或跳过。
- **WASM 不是运行前提**：JavaScript 链路始终可独立工作。
- **未知数据不静默丢弃**：操作符、偏移、行号、诊断均进入结构化报告。

## 10. 研究来源与第三方依赖

格式与架构研究：

- [Pilser/illustrator-rs](https://github.com/Pilser/illustrator-rs) — MIT，容器、操作符表与私有数据提取思路参考；未复制源码。
- [opendesigndev/illustrator-parser-pdfcpu](https://github.com/opendesigndev/illustrator-parser-pdfcpu) — Apache-2.0，架构参考；不引入 pdfcpu。
- [flyfish-dev/file-viewer](https://github.com/flyfish-dev/file-viewer) — Apache-2.0，兼容性诊断参考。
- Adobe Illustrator 兼容性指南（公开 PDF）。

运行依赖：

- [fzstd](https://www.npmjs.com/package/fzstd) — MIT，纯 JavaScript Zstandard 解压。仅处理压缩，不含任何 AI 解析逻辑；阶段 5 将以自研 WASM 路径替代或补充。

详见 [`docs/AI-FORMAT.md`](docs/AI-FORMAT.md)。
