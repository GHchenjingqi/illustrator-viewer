# AI Viewer Engine
# Vue 3 原生 AI 文件解析与 Canvas 渲染引擎开发需求文档

> 历史计划文档：项目现已更名为 **Illustrator Viewer**，npm 包名为 `illustrator-viewer`。以下内容保留原始规划背景。

**项目版本：** V2.0  
**项目类型：** 独立前端文件解析引擎  
**开发语言：** JavaScript + WebAssembly  
**运行环境：** 浏览器本地  
**前端框架：** Vue 3 + Vite  
**渲染技术：** Canvas 2D  
**核心目标：** 自主解析 Adobe Illustrator `.ai` 源文件，实现浏览器高清预览。

---

# 1. 项目目标

开发一套独立的 AI 文件解析与预览引擎，能够在浏览器环境下直接读取 Illustrator `.ai` 文件，解析其内部图形数据，并通过原生 Canvas API 绘制设计稿。

本项目不采用 PDF.js、Photopea、Ghostscript 等第三方文件预览或转换引擎。

不依赖 Adobe Illustrator 客户端，不依赖后端服务，不上传用户文件。

核心工作流程：

AI 文件 → 二进制读取 → 文件结构识别 → 原生数据解析 → Scene Graph → Canvas 渲染 → Vue 3 预览。

## 1.1 核心开发原则

1. 自主实现 JavaScript AI 文件解析引擎。
2. 自主实现图形数据模型。
3. 自主实现 Canvas 渲染器。
4. 使用 WebAssembly 加速高耗时的数据处理。
5. 使用 Web Worker 实现后台解析。
6. 支持浏览器本地运行。
7. 采用模块化架构，方便持续扩展。
8. 不允许使用第三方 AI 文件预览 SDK。
9. 不允许将 PDF.js 作为解析或渲染依赖。
10. 不允许通过重命名、在线转换或后端转换绕过 AI 文件解析。

---

# 2. 技术选型

| 技术 | 选型 | 用途 |
|---|---|---|
| 前端框架 | Vue 3 | 组件展示 |
| 开发语言 | JavaScript ES Modules | 核心解析 |
| 构建工具 | Vite | 项目构建 |
| 渲染引擎 | Canvas 2D | 矢量绘制 |
| 后台线程 | Web Worker | 文件解析 |
| 二进制处理 | ArrayBuffer / Uint8Array / DataView | 文件读取 |
| 加速引擎 | WebAssembly | 性能热点处理 |
| WASM 开发 | Rust 或其他可编译为 WASM 的自有实现 | 自主性能模块 |
| 数据模型 | Scene Graph | 图形对象组织 |
| 单元测试 | Vitest | 解析测试 |
| 浏览器测试 | Playwright | 实际预览测试 |

## 2.1 技术使用边界

### JavaScript 负责

- 文件读取。
- AI 文件结构识别。
- 版本检测。
- 解析流程调度。
- 词法分析。
- 语法分析。
- 图形对象提取。
- Scene Graph 构建。
- Canvas 渲染调度。
- 预览交互。

### WebAssembly 负责

初期只负责经过性能分析确认的计算密集型任务：

- 大文件二进制扫描。
- 数据解压。
- 大量路径坐标处理。
- 数值计算。
- 大规模图形数据预处理。

禁止为了使用 WASM 而将所有解析逻辑强行迁移到 WASM。

JavaScript 解析器必须始终保留独立运行能力。

WASM 加载失败时，必须允许 JavaScript 基础解析流程继续工作。

---

# 3. AI 文件格式研究与解析策略

这是整个项目最重要的技术模块。

AI 文件不是单一结构，不同 Illustrator 版本的文件结构存在差异。

必须先识别文件类型，再选择对应的解析流程。

## 3.1 文件类型识别

开发 AIFileDetector 模块。

负责：

1. 读取文件头。
2. 检测文件编码。
3. 检测 PostScript 特征。
4. 检测 PDF 容器结构。
5. 检测 Illustrator 私有数据。
6. 检测 PGF 数据。
7. 检测压缩数据。
8. 识别文件版本及相关标记。

不得只根据 `.ai` 扩展名判断文件内部结构。

不得仅根据 `%PDF` 文件头就判断文件一定可以完整解析。

## 3.2 现代 AI 文件解析

重点研究 Illustrator 9.0 及以上版本的文件结构。

重点分析：

- PDF 基础结构。
- Illustrator 私有编辑数据。
- PGF 数据。
- Artboard 信息。
- 页面和画板尺寸。
- 图形对象描述。
- 路径及坐标数据。
- 文字相关数据。
- 嵌入式图像数据。

特别注意：

本项目不使用 PDF.js，也不直接依赖第三方 PDF 渲染器。

如果现代 AI 文件中存在 PDF 结构，可以自行分析其中必要的对象、流和图形绘制指令，但必须将其纳入自主实现的解析架构，而不是调用 PDF.js。

对于 Illustrator 原生编辑数据，应优先研究 PGF 和私有数据结构。

## 3.3 旧版 AI 文件解析

针对旧版本 AI 文件，研究 PostScript 数据结构。

开发独立 PostScript Parser。

第一阶段重点支持：

- 基本绘图指令。
- 路径移动。
- 直线绘制。
- 贝塞尔曲线。
- 路径闭合。
- 填充。
- 描边。
- 颜色。
- 基本坐标变换。

后续逐步扩展复杂 PostScript 指令。

不得执行文件中任意脚本或系统命令。

对于不支持的指令，应记录并安全跳过，不能导致整个解析过程崩溃。

## 3.4 文件版本兼容性

建立独立的格式兼容性注册表。

建议按照以下方向划分：

- Illustrator 8 及以前：重点研究 PostScript 原生格式。
- Illustrator 9 至 CS 系列：重点研究 PDF、PGF 及私有数据结构。
- Illustrator CC 系列：重点研究现代 AI 容器和私有数据。
- Illustrator 2020 至当前版本：持续测试结构变化和新图形操作。

上述版本仅为研究和测试分组，不代表已经实现对应版本的兼容能力。

实际支持范围必须以真实文件测试结果为准。

---

# 4. 核心解析引擎设计

建立统一解析入口：

AIParserEngine.js

解析引擎采用模块化设计。

## 4.1 AIFileReader

负责读取用户上传的 AI 文件。

要求：

- 支持 File 对象。
- 支持 ArrayBuffer。
- 支持 Uint8Array。
- 支持大文件分块读取。
- 不修改原始文件。
- 支持取消读取。
- 支持文件切换。
- 提供读取进度。

## 4.2 AIFileDetector

负责文件类型检测。

输出：

- 文件类型。
- 文件版本。
- 文件结构。
- 是否包含 PGF 数据。
- 是否包含 PDF 数据。
- 是否包含 PostScript 数据。
- 是否包含压缩数据。
- 当前可解析能力。

## 4.3 BinaryParser

负责二进制数据处理。

实现：

- 字节读取。
- 数据偏移定位。
- 数据长度识别。
- 数据块提取。
- 编码处理。
- 压缩块识别。
- 异常边界检查。

所有数据读取必须执行长度校验，禁止无边界内存分配。

## 4.4 PGFParser

这是现代 AI 文件解析的重点模块。

研究并实现：

- PGF 数据结构识别。
- PGF 数据提取。
- PGF 数据解码。
- 画板数据提取。
- 图形对象识别。
- 路径数据提取。
- 颜色信息提取。
- 图形对象之间的关系还原。

注意：

PGF 内部结构存在未公开或版本相关的实现细节。

必须通过真实 AI 样本进行结构分析，不得假定所有版本使用完全相同的数据布局。

## 4.5 PostScriptParser

实现 PostScript 词法和语法解析。

建议分成：

- PostScriptLexer.js
- PostScriptParser.js
- PostScriptOperator.js
- PostScriptGraphicsState.js

重点支持：

- 数字。
- 字符串。
- 数组。
- 字典。
- 操作符。
- 栈式计算。
- 图形状态。
- 坐标变换。
- 路径构建。

PostScript 执行必须限制为白名单操作，不执行文件系统、网络或进程相关操作。

## 4.6 VectorParser

负责将不同来源的矢量数据转换为统一对象。

需要支持：

- Path。
- Line。
- Rectangle。
- Ellipse。
- Polygon。
- CompoundPath。
- Group。
- Transform。
- Fill。
- Stroke。

## 4.7 AIParserEngine

统一调度所有解析模块。

执行流程：

1. 读取文件。
2. 检测文件结构。
3. 判断解析路径。
4. 提取可用数据。
5. 解析图形对象。
6. 构建 Scene Graph。
7. 输出解析报告。
8. 将数据传递给渲染器。

解析失败时返回结构化错误，不得直接让 Vue 页面报错崩溃。

---

# 5. Scene Graph 图形数据模型

必须建立统一的图形场景树。

文件解析器不能直接操作 Canvas。

所有解析结果必须先转换为统一的数据结构。

建议支持以下对象：

## 5.1 Document

保存整个设计稿信息：

- 文件名称。
- 文件版本。
- 画板数量。
- 画板尺寸。
- 坐标系统。
- 图形对象。
- 字体信息。
- 解析状态。
- 兼容性报告。

## 5.2 Artboard

保存画板信息：

- 画板 ID。
- 画板名称。
- 宽度。
- 高度。
- 坐标范围。
- 背景颜色。
- 对象列表。

## 5.3 Shape

保存基础图形：

- 类型。
- 坐标。
- 宽高。
- 路径。
- 填充。
- 描边。
- 透明度。
- 变换矩阵。

## 5.4 Path

支持：

- MoveTo。
- LineTo。
- CubicBezier。
- QuadraticBezier。
- ClosePath。

路径数据必须保留矢量坐标，不允许在解析阶段提前栅格化。

## 5.5 Group

支持：

- 子对象。
- 对象顺序。
- 坐标变换。
- 透明度。
- 可见性。

## 5.6 Text

预留文字对象数据结构：

- 文本内容。
- 字体名称。
- 字号。
- 字体样式。
- 颜色。
- 字距。
- 行距。
- 文字区域。

第一阶段可以优先支持已转换为轮廓的文字。

## 5.7 Image

预留嵌入式图像对象：

- 图片格式。
- 图片尺寸。
- 图片二进制数据。
- 图像坐标。
- 图像变换矩阵。

---

# 6. Canvas 渲染引擎

开发独立 CanvasRenderer。

不允许解析器直接在 Canvas 上绘制。

## 6.1 渲染基本能力

支持：

- 直线。
- 矩形。
- 圆形。
- 椭圆。
- 贝塞尔曲线。
- 复合路径。
- 填充。
- 描边。
- 颜色。
- 透明度。
- 图形变换。
- 图形分组。

## 6.2 渲染要求

1. 使用原生 Canvas 2D API。
2. 保持矢量坐标精度。
3. 根据设备像素比适配高清屏幕。
4. 支持大尺寸画板。
5. 支持动态缩放。
6. 支持画布平移。
7. 支持多画板切换。
8. 支持重新渲染。
9. 支持清理 Canvas 资源。

禁止使用低分辨率预览图代替矢量渲染。

## 6.3 坐标系统

必须统一：

- AI 原始坐标。
- Scene Graph 坐标。
- Canvas 坐标。
- 屏幕坐标。

建立 TransformEngine。

负责：

- 平移。
- 缩放。
- 旋转。
- 坐标转换。
- 矩阵合成。
- 画板定位。

注意处理 Illustrator 坐标系与 Canvas 坐标系之间可能存在的 Y 轴方向差异。

---

# 7. WebAssembly 与 Worker 架构

## 7.1 Worker

建立独立的 AIWorker.js。

负责：

- 接收文件数据。
- 执行解析任务。
- 调用 JavaScript Parser。
- 调用 WASM 加速模块。
- 返回解析结果。
- 返回解析进度。
- 接收取消任务指令。

主线程不得执行耗时的大型文件解析任务。

## 7.2 WASM 模块

建立独立 WASM 模块。

建议初期采用 Rust 编译为 WebAssembly。

但必须由本项目自主编写核心代码，不允许直接集成第三方 AI 文件解析引擎。

优先实现：

- 大文件字节扫描。
- 二进制块处理。
- 压缩数据处理。
- 路径批量数值处理。

WASM 必须提供清晰的 JS 调用接口。

## 7.3 线程通信

采用 Worker 消息协议。

消息类型：

- PARSE_START
- PARSE_PROGRESS
- PARSE_RESULT
- PARSE_ERROR
- PARSE_CANCEL
- WASM_READY

支持 Transferable ArrayBuffer，尽可能减少大文件复制。

必须避免：

- 重复解析。
- 旧任务覆盖新任务。
- Worker 内存泄漏。
- WASM 重复初始化。

---

# 8. Vue 3 预览组件

组件名称：

AiViewer.vue

组件只负责用户界面和交互。

不得将 AI 解析逻辑直接写在 Vue 组件内部。

## 8.1 页面布局

顶部工具栏：

- 文件名称。
- 文件大小。
- 解析状态。
- 放大。
- 缩小。
- 适应窗口。
- 原始尺寸。
- 全屏。

中央区域：

- Canvas 预览。
- 画板居中。
- 自适应画布。
- 拖拽平移。

底部信息：

- 当前缩放比例。
- 当前画板。
- 画板总数。
- 文件兼容性状态。

## 8.2 Props

| 属性 | 类型 | 说明 |
|---|---|---|
| file | File / null | 上传文件 |
| width | Number / String | 组件宽度 |
| height | Number / String | 组件高度 |
| zoom | Boolean | 缩放功能 |
| draggable | Boolean | 拖拽功能 |
| fullscreen | Boolean | 全屏功能 |
| maxFileSize | Number | 文件大小限制 |
| worker | Boolean | 是否使用 Worker |

## 8.3 Events

| 事件 | 说明 |
|---|---|
| loaded | 解析成功 |
| error | 解析失败 |
| progress | 解析进度 |
| file-change | 文件变化 |
| zoom-change | 缩放变化 |
| artboard-change | 画板变化 |
| compatibility | 兼容性报告 |

## 8.4 交互功能

必须实现：

- 上传 AI 文件。
- 拖拽上传。
- 替换文件。
- 滚轮缩放。
- 鼠标拖拽。
- 适应窗口。
- 适应宽度。
- 原始尺寸。
- 全屏。
- 多画板切换。
- 解析进度显示。
- 错误状态提示。

---

# 9. 文件兼容性策略

不能将无法解析的内容静默丢弃。

每种图形对象都必须具备解析状态。

建议划分：

- FULL：完整支持。
- PARTIAL：部分支持。
- UNSUPPORTED：暂不支持。
- INVALID：数据损坏。

对于未知操作符：

1. 保留原始数据或操作符信息。
2. 记录文件位置和操作类型。
3. 输出兼容性报告。
4. 尽可能继续解析其他可识别对象。
5. 不允许随意猜测图形结果。

对于无法还原的效果，应明确告知用户，而不是显示错误的完整预览。

---

# 10. 开源项目研究要求

开发前必须研究以下项目：

## 10.1 illustrator-parser-pdfcpu

地址：

https://github.com/opendesigndev/illustrator-parser-pdfcpu

研究内容：

- AI 文件数据提取方式。
- 私有数据结构。
- WASM 运行方式。
- Worker 通信。
- 解析结果组织。

限制：

该项目依赖 pdfcpu，不允许直接作为本项目的核心解析依赖。

只允许在遵守许可证的前提下研究其架构和实现思路。

## 10.2 flyfish-dev/file-viewer

地址：

https://github.com/flyfish-dev/file-viewer

研究内容：

- illustrator-pgf。
- PGF 数据解析。
- 私有数据提取。
- Scene Graph。
- Canvas 渲染。
- 未知操作符处理。
- 兼容性诊断。

需要确认其实际源码可访问性、对应模块许可证和具体实现状态。

不能仅根据项目文档描述就认定相关模块已经具备生产级兼容能力。

## 10.3 illustrator-rs

地址：

https://github.com/Pilser/illustrator-rs

研究内容：

- Illustrator 文件结构。
- DOM 转换。
- SVG 输出。
- PostScript 数据。
- 图形对象提取。

只参考实现思路，不直接引入第三方渲染引擎。

## 10.4 Adobe 格式参考

Adobe Illustrator 兼容性指南：

https://download.adobe.com/pub/adobe/jp/learn/start/blog/AI2025_Compatibility_Guide.pdf

研究：

- Illustrator 版本。
- 文件内部结构。
- PGF 数据。
- PDF 与 EPS 结构关系。
- 版本兼容性。

---

# 11. 开发阶段

必须按照阶段推进，不允许跳过基础解析验证直接开发完整 UI。

## 第一阶段：项目初始化及格式研究

任务：

1. 创建 Vue 3 + Vite 项目。
2. 建立 AI Viewer 项目结构。
3. 研究 AI 文件结构。
4. 建立真实测试文件集合。
5. 实现文件头检测。
6. 实现版本识别。
7. 实现基础二进制读取。
8. 输出结构检测报告。

验收：

- 可以读取本地 AI 文件。
- 能够识别已知文件结构。
- 能够输出结构检测结果。
- 不兼容文件不会造成页面崩溃。

## 第二阶段：基础解析引擎

任务：

1. 实现 AIFileReader。
2. 实现 AIFileDetector。
3. 实现 BinaryParser。
4. 实现 PostScriptLexer。
5. 实现 PostScriptParser。
6. 研究 PGF 数据提取。
7. 建立基础 VectorParser。

验收：

- 能够提取基础图形对象。
- 能够识别基础路径。
- 能够解析基础颜色。
- 能够识别画板信息。
- 能够输出结构化 JSON。

## 第三阶段：Scene Graph

任务：

1. 建立 Document。
2. 建立 Artboard。
3. 建立 Group。
4. 建立 Path。
5. 建立 Shape。
6. 建立 Transform。
7. 建立 Fill 和 Stroke。
8. 建立兼容性诊断机制。

验收：

- 能够将基础解析结果转换为统一图形对象。
- 图形对象之间的层级关系正确。
- 坐标信息准确。
- 不支持的对象有明确标记。

## 第四阶段：Canvas Renderer

任务：

1. 实现 CanvasRenderer。
2. 实现路径绘制。
3. 实现填充与描边。
4. 实现颜色和透明度。
5. 实现坐标变换。
6. 实现画板渲染。
7. 实现高清 DPR 适配。

验收：

- 基础 AI 矢量设计稿可以正常显示。
- 线条和路径没有明显偏移。
- 画板尺寸比例正确。
- 放大后仍然保持矢量清晰度。

## 第五阶段：WebAssembly 加速

任务：

1. 建立 WASM 工程。
2. 建立 JS 与 WASM 接口。
3. 实现二进制扫描加速。
4. 实现压缩数据处理。
5. 实现必要的数值运算优化。
6. 建立 WASM 加载失败回退机制。

验收：

- WASM 可以在浏览器中运行。
- 解析结果与 JavaScript 基准实现一致。
- WASM 加载失败不影响基础预览。
- 有实际性能测试数据证明优化有效。

## 第六阶段：Worker 与 Vue 组件

任务：

1. 实现 AIWorker。
2. 实现解析任务调度。
3. 实现任务取消。
4. 实现进度通知。
5. 实现 AiViewer.vue。
6. 实现工具栏。
7. 实现缩放拖拽。
8. 实现全屏。
9. 实现文件切换。

验收：

- 大文件解析不会明显阻塞界面。
- 解析任务可以取消。
- 文件切换不会出现旧结果覆盖新结果。
- 预览组件可以独立使用。

## 第七阶段：兼容性和性能测试

任务：

1. 测试不同 Illustrator 版本文件。
2. 测试复杂路径。
3. 测试多画板。
4. 测试渐变。
5. 测试嵌入图片。
6. 测试复杂文字。
7. 测试损坏文件。
8. 测试超大文件。
9. 测试 Chromium、Firefox 和 WebKit。
10. 建立图像对比测试。

验收：

- 解析结果可重复。
- 不同浏览器表现稳定。
- 内存释放正常。
- 未支持功能有明确提示。
- 不得将部分成功伪装成完整兼容。

---

# 12. 目录结构要求

建议采用以下项目结构：

    ai-viewer-engine/
    │
    ├── public/
    │   └── wasm/
    │
    ├── src/
    │   ├── components/
    │   │   ├── AiViewer.vue
    │   │   ├── AiToolbar.vue
    │   │   └── AiUpload.vue
    │   │
    │   ├── core/
    │   │   ├── AIParserEngine.js
    │   │   ├── AIFileReader.js
    │   │   ├── AIFileDetector.js
    │   │   ├── BinaryParser.js
    │   │   ├── PGFParser.js
    │   │   ├── PostScriptLexer.js
    │   │   ├── PostScriptParser.js
    │   │   └── VectorParser.js
    │   │
    │   ├── scene/
    │   │   ├── Document.js
    │   │   ├── Artboard.js
    │   │   ├── Group.js
    │   │   ├── Shape.js
    │   │   ├── Path.js
    │   │   └── Transform.js
    │   │
    │   ├── renderer/
    │   │   ├── CanvasRenderer.js
    │   │   ├── PathRenderer.js
    │   │   ├── ShapeRenderer.js
    │   │   └── TextRenderer.js
    │   │
    │   ├── worker/
    │   │   └── AIWorker.js
    │   │
    │   ├── wasm/
    │   │   ├── WasmLoader.js
    │   │   └── WasmBridge.js
    │   │
    │   ├── engine/
    │   │   ├── TransformEngine.js
    │   │   ├── ColorEngine.js
    │   │   └── CompatibilityEngine.js
    │   │
    │   ├── utils/
    │   │   ├── memory.js
    │   │   ├── canvas.js
    │   │   └── errors.js
    │   │
    │   └── index.js
    │
    ├── wasm-src/
    │   ├── Cargo.toml
    │   └── src/
    │       └── lib.rs
    │
    ├── tests/
    │   ├── fixtures/
    │   ├── parser/
    │   ├── renderer/
    │   └── integration/
    │
    ├── docs/
    │   ├── AI-FORMAT.md
    │   ├── PARSER-ARCHITECTURE.md
    │   ├── RENDERER-ARCHITECTURE.md
    │   └── COMPATIBILITY.md
    │
    ├── package.json
    └── README.md

目录可以根据实际开发调整，但必须保持解析、数据模型、渲染和 UI 之间的职责分离。

---

# 13. 测试样本及测试标准

必须建立真实 AI 文件测试集。

建议覆盖：

| 测试类型 | 测试内容 |
|---|---|
| 基础矢量 | 线条、矩形、圆形 |
| 曲线路径 | 贝塞尔曲线 |
| 复合路径 | 多路径组合 |
| 颜色 | RGB、CMYK |
| 描边 | 不同宽度、端点和连接方式 |
| 渐变 | 线性、径向渐变 |
| 透明度 | 对象透明度 |
| 复杂对象 | 分组、复合形状 |
| 图片 | 嵌入式图片 |
| 文字 | 轮廓文字、可编辑文字 |
| 多画板 | 多 Artboard |
| 旧版文件 | PostScript 结构 |
| 新版文件 | 现代 PGF / 私有数据结构 |

测试样本应记录：

- 来源版本。
- 文件大小。
- 文件 SHA-256。
- 文件内部结构。
- 预期解析结果。
- 已支持能力。
- 未支持能力。

禁止通过简单修改文件扩展名制造测试样本。

必须使用真实 Illustrator 导出的文件。

---

# 14. 性能与安全要求

## 性能

- 大文件解析必须优先使用 Worker。
- 禁止主线程执行长时间同步解析。
- 避免重复读取文件。
- 避免重复解压数据。
- 合理使用 Transferable。
- 限制单次 Canvas 像素总量。
- 控制超大路径的绘制开销。
- 支持解析任务取消。
- 及时释放内存。
- 禁止无限缓存。

## 安全

- 不上传用户文件。
- 不访问外部网络。
- 不执行文件内任意代码。
- 不允许 PostScript 任意系统操作。
- 限制压缩数据展开大小。
- 限制递归深度。
- 限制对象数量。
- 检查所有二进制偏移和长度。
- 防止恶意文件造成内存耗尽。

---

# 15. 最终验收标准

## 第一阶段验收

- [ ] 可以读取本地 AI 文件。
- [ ] 可以识别不同文件结构。
- [ ] 可以输出版本和格式报告。
- [ ] 可以提取基础矢量路径。
- [ ] 可以解析基础颜色。
- [ ] 可以生成 Scene Graph。
- [ ] 可以使用 Canvas 显示基础设计稿。

## 第二阶段验收

- [ ] 支持复杂路径。
- [ ] 支持多画板。
- [ ] 支持分组。
- [ ] 支持基本渐变。
- [ ] 支持透明度。
- [ ] 支持图片对象。
- [ ] 支持更多 PostScript 指令。

## 第三阶段验收

- [ ] 支持 Worker 后台解析。
- [ ] 支持 WASM 加速。
- [ ] 支持大文件。
- [ ] 支持任务取消。
- [ ] 支持缩放和拖拽。
- [ ] 支持全屏。
- [ ] 支持文件切换。
- [ ] 支持兼容性报告。
- [ ] 支持浏览器本地离线运行。

---

# 16. 最终交付要求

必须交付：

1. 完整 Vue 3 + Vite 项目。
2. 自主 JavaScript AI 解析引擎。
3. PGF 数据解析模块。
4. PostScript 解析模块。
5. Scene Graph 数据模型。
6. 原生 Canvas 渲染引擎。
7. 自主 WASM 模块及源码。
8. Web Worker。
9. AiViewer.vue 预览组件。
10. 真实 AI 文件测试集。
11. 解析兼容性报告。
12. 性能测试报告。
13. README.md。
14. 完整开发文档。

最终必须能够通过本地 Vite 项目启动并实际上传 AI 文件进行预览。

---

# 17. 给 AI 编程助手的强制执行指令

开发时必须遵守以下规则：

**第一：禁止擅自更改技术路线。**

不得将项目替换为 PDF.js、Photopea、Ghostscript 或第三方 AI 文件查看器。

**第二：禁止伪造解析能力。**

不能通过读取 AI 文件中的 PDF 预览图，就宣称已经完成 AI 原生文件解析。

必须区分原生数据解析、PDF 内容解析和预览图读取。

**第三：先验证再扩展。**

每开发一个解析模块，都必须使用真实 AI 文件验证。

没有测试证据的功能，不得标记为已支持。

**第四：禁止一次性生成全部代码。**

必须按照开发阶段逐步实现，每个阶段通过测试后再进入下一阶段。

**第五：所有解析逻辑必须独立。**

文件读取、格式识别、PGF 解析、PostScript 解析、Scene Graph 和 Canvas Renderer 必须职责清晰。

**第六：必须提供解析诊断。**

对于未知操作符、未支持的对象、解析失败位置，必须记录详细信息。

**第七：优先保证渲染正确性。**

宁可明确提示暂不支持某种效果，也不能错误绘制并声称完整还原。

**第八：WASM 不得成为运行前提。**

JavaScript 基础解析路径必须可以独立运行，WASM 只负责加速。

**第九：禁止引入未授权的开源代码。**

参考开源项目时，必须先检查许可证、依赖关系和代码复用条件。不能因为项目公开就直接复制其源码。

**第十：每个开发阶段都要提供交付报告。**

报告必须包含：

- 已完成模块。
- 文件兼容性。
- 测试样本。
- 测试结果。
- 已知问题。
- 尚未实现的功能。
- 下一阶段任务。

---

# 最终项目定位

本项目不是 PDF 查看器，也不是 Illustrator 在线编辑器。

它是一套独立的：

**JavaScript + WebAssembly + Canvas AI 文件解析与渲染引擎。**

目标是在浏览器本地直接读取 Illustrator 源文件，逐步还原 AI 文件中的矢量图形和设计内容，并通过 Vue 3 组件提供统一预览能力。

项目以自主解析、自主渲染、可持续扩展为最高设计原则。

V1.0 首先保证基础矢量文件可以被正确解析和显示，之后逐步提高对复杂 AI 文件及不同 Illustrator 版本的兼容程度。