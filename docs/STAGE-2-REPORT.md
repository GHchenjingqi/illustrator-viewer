# 阶段 2 交付报告

**日期：** 2026-11-19
**阶段：** 2 / 7 — 基础解析引擎
**状态：** 标准 PostScript 绘图子集实现完成；真实 AI 样本验证待补
**引擎版本：** 0.2.0

---

## 1. 已完成模块

| 模块 | 文件 | 说明 |
|---|---|---|
| PostScript 词法器 | `src/core/PostScriptLexer.js` | 数字、名字、字符串、十六进制串、数组、字典、过程、注释；token 上限与诊断 |
| PostScript 解析器 | `src/core/PostScriptParser.js` | 白名单操作符、路径构建、颜色、线型、变换、状态栈、未知操作符记录 |
| 图形状态 | `src/core/PostScriptGraphicsState.js` | CTM、填充/描边颜色、线宽、端点、连接、斜接、虚线 |
| 矢量对象 | `src/core/VectorParser.js` | 矩形 / 线段 / 路径分类、颜色规范化、包围盒、对象上限 |
| 页面边界 | `src/core/PageBoxExtractor.js` | BoundingBox / HiResBoundingBox / PageBoundingBox / MediaBox / CropBox |
| 矩阵工具 | `src/engine/TransformEngine.js` | 六元组仿射矩阵、平移/缩放/旋转、坐标变换 |
| 引擎集成 | `src/core/AIParserEngine.js` | 检测 → 私有数据/绘图段 → 解析 → 兼容性报告；瞬态文本返回前移除 |
| UI | `src/components/AiInspector.vue` | 阶段 2 指标、矢量对象表、画板候选、未知操作符、解析诊断 |
| 测试 | `tests/parser/*.test.js` | 7 个文件 / 69 项测试 |

---

## 2. 阶段 2 验收对照

| 验收项 | 状态 | 证据 / 说明 |
|---|---|---|
| 能够提取基础图形对象 | ✅（合成样本） | AI12 / AI9 / PostScript 样本均提取到矩形与线段 |
| 能够识别基础路径 | ✅ | `m/l/c/v/y/h/re/rect`，保留 Move/Line/Cubic/Close |
| 能够解析基础颜色 | ✅ | RGB / CMYK / Gray；`rg/k/g/RG/K/G/cs/sc/scn/sethsbcolor` |
| 能够识别画板信息 | ⚠️ 部分 | 仅从 BoundingBox / MediaBox 推断，**不是** Illustrator 原生 Artboard 数据 |
| 能够输出结构化 JSON | ✅ | `report.graphics` 含 vectors / artboards / unknownOperators / stats / diagnostics |
| 真实 AI 文件验证 | ❌ 未完成 | 仓库无真实样本；这是阶段 3 前的阻塞项 |

---

## 3. 解析能力

### 3.1 白名单操作符

- **路径**：`moveto/m`、`lineto/l`、`curveto/c`、`v`、`y`、`closepath/h`、`newpath/n`、`re`、`rect`
- **绘制**：`fill/f`、`eofill/f*`、`stroke/S`、`s`、`B/B*`、`b/b*`、`fillstroke`
- **裁剪**：`clip/W/W*`（仅记录，不参与渲染）
- **颜色**：`setrgbcolor/rg`、`setgray/g`、`setcmykcolor/k`、`RG/G/K`、`cs/CS/sc/scn/SC/SCN`、`sethsbcolor`
- **线型**：`setlinewidth/w`、`setlinecap/J`、`setlinejoin/j`、`setmiterlimit/M`、`setdash/d`
- **状态**：`gsave/grestore`、`q/Q`、`translate/scale/rotate/concat/cm`
- **栈与算术**：`add/sub/mul/div/idiv/mod/neg/dup/pop/exch/copy/index/clear`
- **定义类**：`def/bind/dict/begin/end/currentdict`（安全跳过，不执行）

### 3.2 安全策略

- 过程体 `{ ... }` 整体跳过，不执行。
- 字典 `<< ... >>` 不求值。
- 未知操作符：记录名称、次数、首次偏移与行号；不猜测参数与效果。
- 文字 / 图片 / ExtGState / 图案：记录为未支持，不绘制。
- 所有数组、路径、栈、对象、诊断均有数量上限。

### 3.3 矢量对象

- 保留局部坐标 + 绘制时 CTM（六元组）。
- 保留子路径与闭合标记，不栅格化。
- 类型：`rect` / `line` / `path`。
- 包围盒：直线/路径基于端点与控制点，三次曲线为近似值（`boundsApproximate`）。
- 填充规则：`nonzero` / `evenodd`。
- 颜色：`rgb` / `cmyk` / `gray` / `named` / `none` / `unknown`。

---

## 4. 测试证据

### 4.1 单元测试

```text
$ npm test

Test Files  7 passed (7)
     Tests  69 passed (69)
  Duration  ~608ms
```

新增覆盖：

- 词法：数字、负数、小数、科学计数、名字、字符串转义、嵌套括号、十六进制、注释、布尔、数组/字典/过程、未闭合字符串、token 上限。
- 解析：矩形/线段/贝塞尔、`v/y`、CMYK/RGB/Gray/HSB、`gsave/grestore`、`cm/translate/rotate`、虚线、裁剪、未知操作符、过程体、文字、损坏输入、路径上限、画板边界。
- 矢量：分类、颜色规范化、变换包围盒、对象上限。
- 引擎：完整调度、瞬态文本清理、关闭矢量解析、未知文件、空文件、取消、关闭 SHA-256。

### 4.2 构建

```text
$ npm run build

✓ 27 modules transformed.
dist/assets/index-*.css   21.80 kB │ gzip:  4.65 kB
dist/assets/index-*.js   149.69 kB │ gzip: 53.16 kB
✓ built in 160ms
```

### 4.3 浏览器验证（Chromium，Vite dev）

加载 `synthetic-ai12-pdf.bin` 后：

- 摘要标签：`PDF` / `high confidence` / `AI12 私有标记` / `PDF 1.7` / `部分支持` / `矢量 2` / `Artboard 1（推断）`
- 基础矢量解析：`解析完成`，来源 `AI 私有数据`
- Tokens：80；白名单操作符：12；矢量对象：2；未识别操作符：0；画板候选：1
- 对象类型：矩形 ×1（CMYK 填充）、线段 ×1（RGB 描边，2pt）
- 画板：`MediaBox` 推断 `595 × 842 pt`，置信度 low，明确提示非原生画板
- 兼容性：PostScript / 基础绘图解析 `部分支持`；基础矢量对象提取 `部分支持`；画板信息 `部分支持`
- 浏览器控制台：**0 个错误**

### 4.4 合成样本结果

| 样本 | 来源 | Tokens | 矢量 | 画板 | 未知操作符 |
|---|---|---|---|---|---|
| `synthetic-ai12-pdf.bin` | AI 私有数据 | 80 | 2（矩形、线段） | MediaBox 595×842 | 0 |
| `synthetic-legacy-ps.bin` | PostScript 绘图段 | 24 | 2（矩形、线段） | BoundingBox 595×842 | `showpage` |
| `synthetic-ai9-eps.bin` | AI 私有数据 | 18 | 1（矩形） | BoundingBox 300×200 | 0 |
| `synthetic-truncated-pdf.bin` | — | 0 | 0 | 0 | — |

---

## 5. 兼容性结论

- 标准 PostScript 绘图子集在合成样本上工作正常。
- 画板信息仅来自页面边界推断，不能称为“已识别 Illustrator 画板”。
- PGF 原生图层语义：**未实现**。
- Scene Graph / Canvas 渲染：**未实现**。
- 真实 Illustrator 样本：**未验证**，因此所有图形能力保持 `PARTIAL`。

---

## 6. 已知问题与风险

1. **真实样本缺失**（最高优先级）：AI 私有操作符可能大量不在白名单中；当前 0 个未知操作符仅代表合成样本。
2. **画板数据**：真实 AI 画板可能位于私有数据中，MediaBox 不等于画板。
3. **分组层级丢失**：阶段 2 输出扁平对象列表，无法表达组变换与顺序语义。
4. **裁剪未生效**：裁剪路径只记录，渲染阶段必须补齐，否则会错误显示超出裁剪区的内容。
5. **文字/图片未处理**：包含文字或置入图的设计稿会缺少内容，必须在兼容性报告中明确提示。
6. **渐变/透明度/专色**：尚未建模。
7. **矩阵与坐标**：AI 私有数据可能使用非标准坐标系；真实样本到位后需校准 Y 轴与画板原点。
8. **包围盒近似**：三次曲线使用控制点包围盒。
9. **主线程解析**：大文件仍可能阻塞 UI，阶段 6 移入 Worker。

---

## 7. 尚未实现

- Scene Graph（Document / Artboard / Group / Shape / Transform）
- CanvasRenderer、DPR、缩放、平移、多画板切换
- 裁剪、渐变、透明度、复合形状、图案、专色
- 文字轮廓与可编辑文字、嵌入图片
- WebAssembly、Worker、任务取消协议
- Playwright 图像对比、Firefox / WebKit 测试

---

## 8. 下一阶段任务

1. **收集真实 AI 样本**（阻塞项）：AI 8 / 10 / CS6 / CC 2020+ / 多画板 / 文字 / 图片 / 损坏文件。
2. 用 `npm run inspect -- <file> --write` 登记解析报告。
3. 根据真实操作符分布扩展白名单与诊断。
4. 建立 `src/scene/` 数据模型：Document、Artboard、Group、Shape、Path、Transform、Fill、Stroke。
5. 将扁平矢量对象组织为层级 Scene Graph，保留分组顺序与变换。
6. 为画板、裁剪、未知效果建立明确的兼容性状态。

---

## 9. 复现命令

```bash
npm install
npm test
npm run build
npm run dev
```

浏览器打开终端输出地址，点击“加载合成样本”，即可查看阶段 2 的结构检测与基础矢量提取结果。
