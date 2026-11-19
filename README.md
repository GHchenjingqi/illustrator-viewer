# AI Viewer Engine

> 浏览器本地运行的 Adobe Illustrator `.ai` 文件解析与预览引擎。
> 自主实现 JavaScript 解析链路 + Canvas 渲染，不使用 PDF.js、Photopea、Ghostscript 等第三方预览/转换引擎。

**当前状态：阶段 2（基础解析引擎）已完成并通过测试；矢量预览仍待阶段 4。**

---

## 1. 当前链路

```
File / Blob / ArrayBuffer
        │  AIFileReader（流式读取、进度、取消、SHA-256）
        ▼
   BinaryParser（边界检查、字节搜索、ASCII85、zlib 解压）
        │
        ▼
  AIFileDetector（容器 / 版本 / 私有数据 / 画板边界提示）
        │
        ▼
 PostScriptLexer → PostScriptParser（白名单操作符 + 图形状态）
        │
        ▼
   VectorParser（路径 / 矩形 / 线段 / 颜色 / 线型 / 包围盒）
        │
        ▼
 CompatibilityEngine + AiInspector.vue（结构化 JSON 与可视化）
```

阶段 2 的图形能力是**实验性的**：已完成标准 PostScript 绘图子集的实现与单元测试，但尚未用真实 Illustrator 样本校准。

## 2. 已支持

**文件与结构**

- `File` / `Blob` / `ArrayBuffer` / `Uint8Array` 读取，流式进度与取消。
- PDF 容器、DOS EPS 二进制头、EPS、纯 PostScript 识别。
- Illustrator Creator 版本与 `%AI<n>_` 私有格式标记。
- 私有数据定位与解码：AI12 zlib、AI9 ASCII85（可嵌套 zlib）、AI24 Zstandard（取决于运行环境）。
- 页面边界提示：`%%BoundingBox` / `%%HiResBoundingBox` / `/MediaBox` / `/CropBox`。

**基础解析（阶段 2）**

- PostScript 词法：数字、名字、字符串、十六进制串、数组、字典、注释、过程边界。
- 白名单操作符：
  - 路径：`m` / `l` / `c` / `v` / `y` / `h` / `re` / `rect` / `n`
  - 绘制：`f` / `f*` / `S` / `s` / `B` / `B*` / `b` / `b*`
  - 颜色：`rg` / `k` / `g` / `RG` / `K` / `G` / `cs` / `sc` / `scn` / `sethsbcolor`
  - 线型：`w` / `J` / `j` / `M` / `d`
  - 变换与状态：`translate` / `scale` / `rotate` / `cm` / `concat` / `gsave` / `grestore` / `q` / `Q`
  - 基础栈运算：`add` / `sub` / `mul` / `div` 等
- 提取矩形、线段、贝塞尔路径、复合子路径、RGB / CMYK / Gray 颜色、线宽、端点、连接、虚线、CTM 与包围盒。
- 未知操作符、裁剪、文字、图片、过程体全部记录诊断并安全跳过，不执行任意代码。

**工程**

- 69 项单元测试；Vite 8 生产构建通过。
- 结构化错误与诊断，页面不会因坏文件崩溃。
- 所有处理在浏览器本地完成，无网络请求、无文件上传。

## 3. 明确未实现

- Scene Graph（Document / Artboard / Group / Shape / Transform）
- Canvas 2D 矢量渲染、缩放、平移、多画板切换
- 渐变、透明度组、复合形状、裁剪的实际渲染
- 可编辑文字、文字轮廓、嵌入图片
- PGF / AI 私有图层的完整原生语义（图层、画板命名、对象关系）
- Zstandard 的 WASM 回退
- Web Worker 后台解析、任务取消协议
- Playwright 图像对比与浏览器矩阵测试

## 4. 快速开始

要求：Node.js `>= 22.12`，npm 10+。

```bash
npm install
npm run generate:samples   # 生成合成样本（仅演示/测试）
npm run dev                # 开发服务器
```

打开终端输出的地址（默认 `http://localhost:5173`，端口占用时自动顺延）。

其他命令：

```bash
npm test                   # Vitest（7 个文件 / 69 项测试）
npm run build              # 生产构建
npm run preview            # 预览构建产物
npm run inspect -- tests/fixtures/real/your-file.ai --write
npm run generate:samples
```

`inspect` 会输出完整解析 JSON，并在 `--write` 时生成 `<file>.report.json`，用于登记真实样本。

## 5. 测试样本策略（重要）

| 目录 | 类型 | 用途 | 能否作为兼容性证据 |
|---|---|---|---|
| `tests/fixtures/synthetic/` | 脚本生成的合成结构 | 单元测试、UI 演示 | **不能** |
| `tests/fixtures/real/` | 真实 Illustrator 导出文件 | 兼容性验证 | 能 |

当前仓库**没有真实 AI 样本**，因此：

- 合成样本在 UI 中显示黄色警告。
- 兼容性最高只到 `PARTIAL`，不会声称完成任何 AI 版本的兼容。
- 真实样本登记方式见 [`tests/fixtures/real/README.md`](tests/fixtures/real/README.md)。

## 6. 项目结构

```
.
├── public/
│   ├── samples/                 # 合成样本（.bin，非真实 AI）
│   └── wasm/                    # 阶段 5 预留
├── scripts/
│   ├── generate-synthetic-samples.mjs
│   └── inspect-ai.mjs           # 命令行解析/检测
├── src/
│   ├── components/
│   │   └── AiInspector.vue      # 阶段 1-2 UI（阶段 6 替换为 AiViewer.vue）
│   ├── core/
│   │   ├── AIFileReader.js
│   │   ├── AIFileDetector.js
│   │   ├── BinaryParser.js
│   │   ├── PostScriptLexer.js
│   │   ├── PostScriptParser.js
│   │   ├── PostScriptGraphicsState.js
│   │   ├── VectorParser.js
│   │   ├── PageBoxExtractor.js
│   │   └── AIParserEngine.js
│   ├── engine/
│   │   ├── CompatibilityEngine.js
│   │   └── TransformEngine.js
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
└── package.json
```

职责边界：解析器不接触 Canvas；Vue 组件只调用 `AIParserEngine`；矢量对象保留局部坐标与 CTM，不做解析期栅格化。

## 7. 阶段进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 项目初始化、格式研究、结构检测 | ✅ 完成（真实样本验证待补） |
| 2 | PostScript 解析、路径/颜色提取、画板边界推断 | ✅ 完成（真实样本验证待补） |
| 3 | Scene Graph | ⏳ 下一步 |
| 4 | Canvas Renderer | 计划 |
| 5 | WebAssembly 加速 | 计划 |
| 6 | Worker 与 AiViewer.vue | 计划 |
| 7 | 兼容性与性能测试 | 计划 |

阶段 2 详细交付见 [`docs/STAGE-2-REPORT.md`](docs/STAGE-2-REPORT.md)。

## 8. 设计约束

- **不上传文件**，不访问外部网络，纯浏览器本地运行。
- **不引入第三方 AI 预览 SDK**，不把 PDF.js 作为解析或渲染依赖。
- **不读取 PDF 预览图冒充 AI 原生解析**。
- **不执行文件内脚本**：过程体、字典、未知操作符只记录或跳过。
- **WASM 不是运行前提**：JavaScript 链路始终可独立工作。
- **未知数据不静默丢弃**：操作符、偏移、行号、诊断均进入结构化报告。

## 9. 研究来源与许可

阶段 1-2 仅研究公开资料中的格式与架构思路，**没有复制第三方源码**：

- [Pilser/illustrator-rs](https://github.com/Pilser/illustrator-rs) — MIT，容器与私有数据提取思路参考。
- [opendesigndev/illustrator-parser-pdfcpu](https://github.com/opendesigndev/illustrator-parser-pdfcpu) — Apache-2.0，架构与测试组织参考；不引入 pdfcpu。
- [flyfish-dev/file-viewer](https://github.com/flyfish-dev/file-viewer) — Apache-2.0，兼容性诊断与多格式架构参考。
- Adobe Illustrator 兼容性指南（公开 PDF）。

详见 [`docs/AI-FORMAT.md`](docs/AI-FORMAT.md)。
