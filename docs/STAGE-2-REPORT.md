# 阶段 2 交付报告

**日期：** 2026-11-19
**阶段：** 2 / 7 — 基础解析引擎
**状态：** 已完成；使用 1 个真实 AI24 样本（Illustrator 29.3）校准
**引擎版本：** 0.2.0

---

## 1. 已完成模块

| 模块 | 文件 | 说明 |
|---|---|---|
| PostScript 词法器 | `src/core/PostScriptLexer.js` | 数字、名字、字符串、十六进制、数组、字典、过程、注释；跳过 `%%BeginData` 二进制块 |
| PostScript 解析器 | `src/core/PostScriptParser.js` | 白名单操作符、AI 私有操作符、路径、颜色、线型、变换、状态栈、诊断 |
| 图形状态 | `src/core/PostScriptGraphicsState.js` | CTM、填充/描边颜色、线宽、端点、连接、斜接、虚线 |
| 矢量对象 | `src/core/VectorParser.js` | 矩形/线段/路径分类、渐变/自定义颜色标记、包围盒、对象上限 |
| AI24 解压 | `src/core/AI24Extractor.js` + `src/utils/zstd.js` | PDF stream 分块拼接、zstd 前缀解压、fzstd JS 回退 |
| 原生画板 | `src/core/AIArtboardExtractor.js` | DocumentData ArtboardArray → 名称/坐标/矩形 |
| 页面边界 | `src/core/PageBoxExtractor.js` | BoundingBox / MediaBox 回退；内容边界与画板分离 |
| 编码工具 | `src/utils/encoding.js` | 字节保持 Latin-1、UTF-8 名称还原 |
| 矩阵工具 | `src/engine/TransformEngine.js` | 六元组仿射矩阵 |
| 引擎集成 | `src/core/AIParserEngine.js` | 检测 → 私有数据 → 绘图段 → 解析 → 画板 → 兼容性 |
| UI | `src/components/AiInspector.vue` | 分块信息、原生画板、渐变/专色标记、未支持特性、诊断 |
| 测试 | `tests/parser/` + `tests/integration/` | 10 个文件 / 80 项测试 |

---

## 2. 阶段 2 验收对照

| 验收项 | 状态 | 证据 |
|---|---|---|
| 提取基础图形对象 | ✅ | AI24 真实样本提取 841 个对象（839 path / 2 line） |
| 识别基础路径 | ✅ | `m/l/L/c/C/v/V/y/Y/h/H/re`，保留 Move/Line/Cubic/Close |
| 解析基础颜色 | ✅ | RGB / CMYK / Gray；渐变与自定义颜色明确标记，不伪装成黑色 |
| 识别画板信息 | ✅（部分） | 从 DocumentData 解析原生画板「画板 1」1250×700；其他版本待验证 |
| 输出结构化 JSON | ✅ | `report.graphics` 含 vectors / artboards / contentBounds / stats / diagnostics |
| 真实 AI 文件验证 | ✅（1 个样本） | AI24 / Illustrator 29.3；AI 8、10、CS6 等仍待补 |
| 不支持对象明确标记 | ✅ | 渐变、专色、文字、图片、裁剪、外观均有 feature/diagnostic |

---

## 3. 真实样本校准结果

样本：`tests/fixtures/real/lengdong-logo.ai`（默认不提交到 Git）

| 项目 | 结果 |
|---|---|
| 文件 | 569,228 B · SHA-256 `57847b69…cb588` |
| 容器 | PDF 1.6 |
| 版本 | Creator 24.0；应用版本 29.3.0；AI24 私有格式 |
| 私有数据 | `%AI24_ZStandard_Data`；PDF 对象 11–18，8 个 stream 块 |
| 解压 | 8/8 块；489,879 压缩字节 → 8,124,703 字节文本 |
| 解析 | 65,114 tokens；12,496 个白名单操作符；841 个矢量；0 未知操作符 |
| 图层 / 组 / 复合 | 1 图层；27 组；39 复合路径 |
| 颜色 | 540 渐变；252 自定义颜色；48 Gray；1 无填充 |
| 画板 | 原生「画板 1」，`x=0, y=-700, 1250×700` |
| 内容边界 | BoundingBox `-462,-680 → 1425,345`（不是画板） |
| 二进制块 | 6,318,105 字节嵌入栅格数据已跳过 |
| 浏览器耗时 | 约 360 ms（含 zstd 解压与解析） |

### 关键格式发现

1. **AI24 zstd 是分块的**：对象 11 以标记开头，对象 12–18 是纯续块；必须按 object 顺序拼接。
2. **`%%BeginData` 声明长度不可信**：本样本声明 4,738,564，实际块 6,318,105；按 `%%EndData` 边界跳过。
3. **AI 私有数据不是严格 PostScript**：prolog 中存在大量不闭合 `[` 数组；实际绘图从 `%AI5_BeginLayer` 开始。
4. **大写路径操作符**：`C` 是 curveto（6 参数），`L` 是 lineto（2 参数）。
5. **`Xa`/`XA` 在本样本为 7 个分量**，不是 3 个 RGB 分量；阶段 2 只保留原始分量。
6. **原生画板位于 DocumentData**：名称 + PositionPoint1/2，需按 UTF-8 还原中文名。

---

## 4. 测试证据

### 4.1 单元 / 集成测试

```text
$ npm test

Test Files  10 passed (10)
     Tests  80 passed (80)
  Duration  ~1.2s
```

覆盖：

- 词法：数字、负数、小数、科学计数、名字、字符串转义、嵌套括号、十六进制、注释、布尔、数组/字典/过程、未闭合字符串、token 上限、`%%BeginData` 跳过。
- 解析：标准与 AI 大写路径、贝塞尔、`v/y`、CMYK/RGB/Gray/HSB、自定义颜色、渐变标记、`gsave/grestore`、变换、虚线、裁剪、图层、组、复合路径、未知操作符、过程体、损坏输入、路径上限、画板边界。
- AI24：PDF stream 分块拼接、前缀 zstd 解压、单帧回退。
- 画板：原生 DocumentData 解析、中文名称、无效数据。
- 引擎：完整调度、瞬态文本清理、关闭矢量解析、未知/空文件、取消、关闭 SHA-256。
- 真实样本集成测试：文件存在时验证 841 个矢量、原生画板、渐变/专色标记；不存在时自动跳过。

### 4.2 构建

```text
$ npm run build

✓ 32 modules transformed.
dist/assets/index-*.css   22.11 kB │ gzip:  4.71 kB
dist/assets/index-*.js   169.97 kB │ gzip: 60.94 kB
✓ built in 208ms
```

### 4.3 浏览器验证

真实文件拖入后：

- 摘要：`PDF` / `high confidence` / `AI24 私有标记` / `PDF 1.6` / `部分支持` / `矢量 841` / `原生画板 1`
- 应用版本 `29.3.0`；声明图层 / 画板 `1 / 1`
- 私有数据：`zstd`，`8 / 8` 分块，PDF 对象 11
- 画板卡片：「画板 1」`0, -700 / 1250 × 700 pt`
- 内容边界：BoundingBox / HiResBoundingBox
- 矢量示例：渐变填充、自定义颜色、Gray
- 未识别操作符：0
- 控制台：0 错误、0 警告

---

## 5. 兼容性结论

- 已用 1 个真实 AI24 样本验证：分块 zstd、AI 私有操作符、路径、画板。
- 渐变/专色只标记类型，**没有猜测颜色值**；Canvas 阶段必须实现后再渲染。
- 其他 Illustrator 版本（AI 8 / 10 / CS / CS6 / 2022+）尚未验证。
- 总体等级保持 `PARTIAL`，不因单一样本升级为 `FULL`。

---

## 6. 已知问题与风险

1. 只有一个真实样本，操作符集合与布局仍需更多版本验证。
2. 渐变颜色表、停靠点、专色语义未解析。
3. 文字、图片、裁剪、透明度、画笔/图案未渲染。
4. 图层/组只记录深度，尚未恢复完整层级关系。
5. 画板坐标 Y 轴向下转换将在阶段 4 统一处理。
6. 三次曲线包围盒为控制点近似。
7. AI24 zstd 使用 JS 解压；WASM 与 Worker 待后续阶段。
8. 真实样本默认不进入 Git，CI 环境下集成测试会跳过。

---

## 7. 尚未实现

- Scene Graph（Document / Artboard / Group / Shape / Transform）
- CanvasRenderer、DPR、缩放、平移、多画板切换
- 渐变、透明度、裁剪、复合形状、图案、专色的实际渲染
- 文字轮廓 / 可编辑文字、嵌入图片
- WebAssembly、Worker、任务取消协议
- Playwright 图像对比、Firefox / WebKit 测试

---

## 8. 下一阶段任务

1. 继续收集真实样本：AI 8 / 10 / CS6 / CC 2022+ / 多画板 / 文字 / 渐变复杂文件。
2. 用 `npm run inspect -- <file> --write` 登记结构报告。
3. 建立 Scene Graph 数据模型，把扁平矢量对象组织为 Document → Artboard → Group → Path。
4. 把图层、组、复合路径标记转换为真实层级。
5. 为渐变、裁剪、文字、图片建立明确的数据结构与兼容性状态。
6. 为阶段 4 Canvas 渲染准备稳定的输入契约。

---

## 9. 复现命令

```bash
npm install
npm test
npm run build
npm run dev
```

真实样本放入 `tests/fixtures/real/` 后：

```bash
npm run inspect -- tests/fixtures/real/lengdong-logo.ai --write
```
