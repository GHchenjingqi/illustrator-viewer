# 阶段 1 交付报告

**日期：** 2026-11-19
**阶段：** 1 / 7 — 项目初始化及格式研究
**状态：** 代码与合成样本验证完成；真实 AI 样本验证待补
**引擎版本：** 0.1.0

---

## 1. 已完成模块

| 模块 | 文件 | 说明 |
|---|---|---|
| 文件读取 | `src/core/AIFileReader.js` | File / Blob / ArrayBuffer / Uint8Array；流式进度；取消；SHA-256；大小上限 |
| 二进制处理 | `src/core/BinaryParser.js` | 大小端读取、BMH 字节搜索、ASCII85、zlib 解压、边界检查 |
| 结构检测 | `src/core/AIFileDetector.js` | PDF / DOS EPS / EPS / PostScript 识别；版本标记；私有数据定位与解码；诊断 |
| 统一入口 | `src/core/AIParserEngine.js` | 读取 → 检测 → 兼容性；结构化错误 |
| 兼容性 | `src/engine/CompatibilityEngine.js` | FULL / PARTIAL / UNSUPPORTED / INVALID |
| UI | `src/components/AiInspector.vue` | 拖拽上传、更换/取消、进度、报告卡片、JSON、诊断、合成样本加载 |
| 项目骨架 | Vue 3 + Vite 8 | 开发/构建/测试脚本、公共导出、样式 |
| 样本生成 | `scripts/generate-synthetic-samples.mjs` | 4 个合成结构样本 + SHA-256 manifest |
| CLI 检测 | `scripts/inspect-ai.mjs` | 真实文件检测与 `.report.json` 登记 |
| 测试 | `tests/parser/*.test.js` | 34 项单元测试 |
| 文档 | `docs/*.md` | 格式研究、解析架构、兼容性、渲染计划、本报告 |

---

## 2. 验收对照（需求文档第 11 节 第一阶段）

| 验收项 | 状态 | 证据 / 说明 |
|---|---|---|
| 可以读取本地 AI 文件 | ✅ 代码完成 | File/Blob 流式读取 + UI 上传；真实 AI 文件尚未加入测试集 |
| 能够识别已知文件结构 | ✅ | 4 个合成样本覆盖 PDF+AI12、EPS+AI9、PostScript、截断 PDF |
| 能够输出结构检测结果 | ✅ | `report` JSON + UI 可视化 + `npm run inspect` |
| 不兼容文件不会造成页面崩溃 | ✅ | 未知文件返回 `unknown` 容器报告；空文件返回结构化错误；浏览器控制台无错误 |

> 说明：合成样本不能替代真实 Illustrator 文件。阶段 2 开始前必须补充真实样本，否则不应声明任何版本兼容性。

---

## 3. 测试证据

### 3.1 单元测试

```text
$ npm test

Test Files  4 passed (4)
     Tests  34 passed (34)
  Duration  ~359ms
```

覆盖内容：

- 整数读取、越界检查、字节搜索、ASCII85、zlib、尾部数据、解压上限、损坏数据。
- 读取进度、取消、空文件、超限文件、未知来源、SHA-256。
- PDF+AI12 / EPS+AI9 / PostScript / 截断 PDF / 未知二进制 / 空文件。
- 引擎完整调度、关闭 SHA-256、开始前取消、结构化报告。

### 3.2 构建

```text
$ npm run build

✓ 21 modules transformed.
dist/index.html                   0.57 kB │ gzip:  0.40 kB
dist/assets/index-*.css          19.91 kB │ gzip:  4.42 kB
dist/assets/index-*.js          112.55 kB │ gzip: 41.97 kB
✓ built in 149ms
```

### 3.3 浏览器验证（Chromium，Vite dev server）

加载 `synthetic-ai12-pdf.bin` 后：

- 标题：`PDF 容器`
- 摘要：`PDF 容器 · Adobe Illustrator 24 · 私有数据已定位并成功解码`
- 标签：`PDF` / `high confidence` / `AI format 12` / `PDF 1.7` / `部分支持`
- 私有数据状态：`已解码`
- 解压后预览包含 `%!PS-Adobe-3.0`、`%%Creator: Adobe Illustrator(R) 24.0`、`%AI5_BeginLayer`
- 诊断：`PRIVATE_DATA_TRAILING_DATA`（符合预期：zlib 流后紧跟文本结束标记）
- 能力矩阵：仅结构检测/私有数据定位/解压为可用；PostScript、PGF、Scene Graph、Canvas、PDF 预览图均为不可用/不采用
- 浏览器控制台：**0 个错误**
- 合成样本警告横幅正常显示

### 3.4 合成样本结果

| 样本 | 容器 | Creator | 私有数据 | 结果 |
|---|---|---|---|---|
| `synthetic-ai12-pdf.bin` | PDF 1.7 | 24.0 | AI12 / zlib / decoded | `PARTIAL`，另有 trailing-data 提示 |
| `synthetic-legacy-ps.bin` | EPS | 8.0 | absent | `PARTIAL` |
| `synthetic-ai9-eps.bin` | EPS | 11.0 | AI9 / ascii85+zlib / decoded | `PARTIAL` |
| `synthetic-truncated-pdf.bin` | PDF | — | absent | `PARTIAL` + `TRUNCATED_FILE` 警告 |

SHA-256 与文件大小见 [`COMPATIBILITY.md`](COMPATIBILITY.md)。

---

## 4. 兼容性结论

- 容器识别链路已在合成样本上验证。
- zlib / ASCII85 解码链路已在合成样本上验证。
- Zstandard 通道已实现调用与降级，但**尚未在真实 AI24 样本上验证**。
- PostScript / PGF 图形解析、Scene Graph、Canvas 渲染：**未实现**。
- 当前报告的最高等级为 `PARTIAL`，这是刻意设计，避免把结构检测伪装成完整兼容。

---

## 5. 已知问题与风险

1. **缺少真实样本**（最高优先级）：没有 Illustrator 导出的 `.ai` 文件，无法验证标记位置、私有数据布局、Creator 字符串与版本映射。
2. **AI24 Zstandard**：运行时不一定支持 `DecompressionStream('zstd')`；需要阶段 5 的 WASM 回退，并补充真实样本。
3. **标记扫描窗口**：大文件只扫描首 2 MiB + 尾 16 MiB，极端文件可能漏检首尾之外的标记。
4. **版本名映射**：只对 Creator 8–16 与私有格式 9–16 使用明确名称；更高版本仅报告数字，避免臆测。
5. **PDF 内容未处理**：阶段 1 不解析 PDF 对象/内容流；也不读取预览图。
6. **UI 仅检测面板**：`AiViewer.vue`、工具栏、缩放拖拽、全屏、多画板切换均在阶段 6 实现。
7. **主线程解压**：大文件解压仍可能阻塞 UI；阶段 6 移入 Worker。
8. **合成样本的 SHA-256 随生成脚本变化**：manifest 会在每次 `npm test` 前重新生成并覆盖；修改脚本后需同步更新文档表格。

---

## 6. 尚未实现的功能

- PostScriptLexer / PostScriptParser / GraphicsState / 白名单操作符
- PGF / AI 私有图层语法解析
- VectorParser、Document / Artboard / Group / Shape / Path / Transform
- CanvasRenderer、DPR、缩放、平移、多画板
- WebAssembly 模块与 JS/WASM 结果一致性测试
- AIWorker、任务取消协议、Transferable
- Playwright 图像对比、浏览器矩阵（Chromium / Firefox / WebKit）
- 渐变、透明度、文本、嵌入图片、复合路径
- 性能与内存测试报告

---

## 7. 下一阶段任务

1. **收集真实 AI 样本**（阻塞项）：
   - AI 8 及以前（PostScript）
   - AI 10 / CS2 / CS6（PDF + AI9/AI12）
   - CC 2020+（AI24 / Zstandard）
   - 多画板、渐变、透明、文本轮廓、嵌入图片
   - 损坏/截断文件
2. 用 `npm run inspect -- <file> --write` 登记真实样本报告。
3. 实现 `PostScriptLexer` 与基础 token 测试。
4. 实现白名单操作符执行器与图形状态栈。
5. 建立路径提取的最小闭环，输出结构化路径 JSON。
6. 根据真实样本修正格式假设，更新 `docs/AI-FORMAT.md` 与兼容性矩阵。

---

## 8. 复现命令

```bash
npm install
npm test
npm run build
npm run dev
```

浏览器打开终端输出地址，点击“加载合成样本”，即可复现阶段 1 检测报告。
