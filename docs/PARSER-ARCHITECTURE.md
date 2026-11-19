# 解析器架构

> 当前实现阶段：**2（基础解析引擎）**。
> 未实现部分不会在代码、UI 或兼容性报告中被标记为可用。

## 1. 分层

```
┌──────────────────────────────────────────────────────────┐
│ Vue 3 组件（AiInspector.vue / 后续 AiViewer.vue）          │
│ 只负责 UI、交互、事件；不包含解析逻辑                       │
└───────────────────────────┬──────────────────────────────┘
                            │ AIParserEngine.parse()
┌───────────────────────────▼──────────────────────────────┐
│ AIParserEngine                                           │
│ 读取 → 检测 → 基础绘图解析 → 兼容性评估 → 结构化报告         │
└───────────────┬──────────────────────────┬───────────────┘
                │                          │
┌───────────────▼────────────┐  ┌──────────▼───────────────┐
│ AIFileReader               │  │ CompatibilityEngine      │
│ File/Blob/Buffer、进度、取消 │  │ FULL/PARTIAL/…            │
└───────────────┬────────────┘  └──────────────────────────┘
                │ Uint8Array
┌───────────────▼────────────┐
│ AIFileDetector             │
│ 容器 / 版本 / 私有数据 / 边界 │
└───────────────┬────────────┘
                │ 已解码文本
┌───────────────▼────────────┐   ┌─────────────────────────┐
│ PostScriptLexer            │──▶│ PostScriptParser        │
│ token 化（无执行）           │   │ 白名单操作符 + 状态栈     │
└────────────────────────────┘   └───────────┬─────────────┘
                                             │ 路径 + 颜色 + CTM
                                 ┌───────────▼─────────────┐
                                 │ VectorParser            │
                                 │ 分类 / 规范化 / 包围盒    │
                                 └─────────────────────────┘

阶段 3+：VectorParser → Scene Graph → CanvasRenderer
```

## 2. 模块职责

| 模块 | 职责 | 不负责 |
|---|---|---|
| `AIFileReader` | 统一来源读取、流式分块、进度、取消、SHA-256 | 格式判断 |
| `BinaryParser` | 字节/整数/浮点读取、BMH 搜索、ASCII85、zlib | AI 语法 |
| `AIFileDetector` | 容器识别、版本标记、私有数据定位/解码、诊断、页面边界提示 | 图形提取 |
| `PostScriptLexer` | token 化数字/名字/字符串/数组/字典/过程/注释 | 执行、绘图 |
| `PostScriptParser` | 白名单操作符、路径构建、图形状态、颜色、变换、诊断 | Canvas、Scene Graph |
| `PostScriptGraphicsState` | CTM、填充/描边颜色、线宽、端点、连接、虚线 | 视口变换 |
| `VectorParser` | 矩形/线段/路径分类、颜色规范化、包围盒 | 栅格化、分组关系 |
| `PageBoxExtractor` | BoundingBox / MediaBox / CropBox 提示与画板候选 | 原生 Artboard 语义 |
| `TransformEngine` | 仿射矩阵工具（阶段 2） | 屏幕坐标/视口（阶段 4） |
| `CompatibilityEngine` | 能力与诊断映射为四级兼容性 | 解析 |
| `AIParserEngine` | 调度、进度聚合、结构化错误边界 | 具体解析细节 |

## 3. 契约

```js
const result = await engine.parse(fileOrBuffer, {
  signal,
  onProgress(event),
  decodePrivateData: true,
  parseGraphics: true,
})

// 成功
{
  ok: true,
  stage: 2,
  report: {
    schemaVersion, stage, generatedAt, durationMs,
    file: { name, size, sha256 },
    detection: { … },
    structure: { hasPdf, hasPrivateData, pageBoxHints, … },
    privateData: { status, compression, decodedBytes, preview, … }, // 解码文本为瞬态字段，返回前移除
    graphics: {
      status: 'parsed' | 'empty' | 'skipped' | 'failed',
      mode: 'ai-private' | 'postscript' | 'none',
      source: 'private-data' | 'postscript-body' | null,
      tokenCount, vectorCount,
      vectors: [{
        id, type: 'rect' | 'line' | 'path',
        subpaths: [{ closed, segments: [{ type, x, y, x1, y1, x2, y2 }] }],
        fill: { type: 'rgb' | 'cmyk' | 'gray' | 'named' | 'none', values },
        stroke: { … },
        fillRule, strokeWidth, lineCap, lineJoin, miterLimit, dashArray, dashOffset,
        transform: [a, b, c, d, e, f],
        bounds: { x, y, width, height },
        boundsApproximate, rect?, support: 'PARTIAL'
      }],
      artboards: [{ rect, source, confidence, note }],
      unknownOperators: [{ operator, count, firstOffset, firstLine }],
      unsupportedFeatures, diagnostics, stats, truncated
    },
    capabilities: { … },
    diagnostics: [{ code, message, severity }],
    compatibility: { overall, items, note },
  },
}

// 失败（页面不会崩溃）
{ ok: false, aborted: false, error: { code, message, details } }
```

`graphics.vectors` 保留局部坐标和绘制时 CTM；渲染阶段再应用矩阵，不在解析期栅格化。

## 4. 错误与诊断

- 致命错误：`AiViewerError(code, message, details)` → `{ ok:false, error }`。
- 非致命：`report.diagnostics` / `report.graphics.diagnostics`，等级 `info` / `warning` / `error`。
- 取消：`AbortSignal` → `aborted: true`。

稳定错误码：`EMPTY_FILE`、`FILE_TOO_LARGE`、`READ_FAILED`、`BINARY_RANGE`、`INFLATE_FAILED`、`INFLATE_LIMIT`、`ASCII85_INVALID`、`ABORTED`。

解析诊断码（节选）：`STACK_UNDERFLOW`、`TYPE_ERROR`、`PATH_WITHOUT_MOVETO`、`PATH_LIMIT`、`TOKEN_LIMIT`、`UNTERMINATED_STRING`、`UNTERMINATED_ARRAY`、`UNKNOWN_OPERATOR`（以 `unknownOperators` 汇总）、`UNSUPPORTED_COLORSPACE`、`GRAPHICS_NO_VECTORS`、`GRAPHICS_UNKNOWN_OPERATORS`、`ARTBOARD_HINTS_NOT_FOUND`。

## 5. 安全限制

| 限制 | 当前值 |
|---|---|
| 单文件 | 512 MiB |
| 私有数据段读取 | 64 MiB |
| 单次解压输出 | 128 MiB |
| 绘图文本 | 16 MiB |
| token 数 | 200 000 |
| 操作数栈 | 10 000 |
| 矢量对象 | 50 000 |
| 路径点 | 1 000 000 |
| 未知操作符种类 | 2 000 |
| 解析诊断 | 200 |
| 画板候选 | 24 |

过程体与字典不执行；未知操作符不猜测语义；文字/图片/裁剪记录为未支持；不做任何文件、网络、进程操作。

## 6. 阶段 2 的已知限制

1. 未用真实 AI 私有数据校准操作符集合与参数顺序。
2. AI 私有数据中的图层、分组、画板命名、对象关系尚未还原。
3. 裁剪路径只记录，不参与后续图形裁剪。
4. 文字、图片、图案、渐变、透明度组未解析。
5. 三次曲线包围盒基于控制点，属于近似值。
6. 变换以绘制时 CTM 快照保存，尚未恢复分组层级。
7. 大文件解析仍在主线程（阶段 6 移入 Worker）。

## 7. 阶段 3 计划

1. 建立 `Document / Artboard / Group / Shape / Path / Transform / Fill / Stroke` 数据模型。
2. 将阶段 2 的扁平矢量对象组织为层级 Scene Graph。
3. 从真实样本中还原图层与分组关系。
4. 补充复合路径、clip、渐变、透明度的数据结构（即使暂不渲染也要明确标记）。
5. 为阶段 4 提供稳定的渲染输入契约。

**进入阶段 4 的前提**：至少一个真实 AI 样本可以输出结构稳定的 Scene Graph，并有测试证据。
