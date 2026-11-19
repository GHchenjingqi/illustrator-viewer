# 解析器架构

> 当前实现阶段：**1（结构检测）**。本文同时标注后续阶段的计划边界，未实现部分不会在代码或 UI 中标记为可用。

## 1. 分层

```
┌──────────────────────────────────────────────────────────┐
│ Vue 3 组件（AiInspector.vue / 后续 AiViewer.vue）          │
│ 只负责 UI、交互、事件；不包含解析逻辑                       │
└───────────────────────────┬──────────────────────────────┘
                            │ AIParserEngine.parse()
┌───────────────────────────▼──────────────────────────────┐
│ AIParserEngine                                           │
│ 读取 → 检测 → 兼容性评估 → 输出结构化报告                   │
└───────────────┬──────────────────────────┬───────────────┘
                │                          │
┌───────────────▼────────────┐  ┌──────────▼───────────────┐
│ AIFileReader               │  │ CompatibilityEngine      │
│ File/Blob/Buffer、进度、取消 │  │ FULL/PARTIAL/…            │
└───────────────┬────────────┘  └──────────────────────────┘
                │ Uint8Array
┌───────────────▼────────────┐
│ AIFileDetector             │
│ 容器 / 版本 / 标记 / 私有数据 │
└───────────────┬────────────┘
                │
┌───────────────▼────────────┐
│ BinaryParser               │
│ 边界检查、字节搜索、解压      │
└────────────────────────────┘

阶段 2+ 追加（尚未实现）：
AIFileDetector → PostScriptLexer → PostScriptParser → PGFParser
              → VectorParser → SceneGraph → CanvasRenderer
```

## 2. 模块职责（阶段 1 实际实现）

| 模块 | 职责 | 不负责 |
|---|---|---|
| `AIFileReader` | 统一来源读取、流式分块、进度、取消、SHA-256 | 格式判断 |
| `BinaryParser` | 字节/整数/浮点读取、BMH 字节搜索、ASCII85、zlib 解压 | AI 语法 |
| `AIFileDetector` | 容器识别、版本标记、私有数据定位/解码、诊断 | 图形提取 |
| `CompatibilityEngine` | 将能力与诊断映射为四级兼容性 | 解析 |
| `AIParserEngine` | 调度、进度聚合、结构化错误边界 | 具体解析细节 |
| `AiInspector.vue` | 上传、拖拽、报告可视化、取消 | 任何解析 |

### 契约

```js
const result = await engine.parse(fileOrBuffer, {
  signal,
  onProgress(event),
  decodePrivateData: true,
})

// 成功
{
  ok: true,
  stage: 1,
  report: {
    schemaVersion, stage, generatedAt,
    file: { name, size, sha256 },
    detection: { container, confidence, pdfVersion, aiFormatVersion, creator, … },
    structure: { hasPdf, hasPostScript, hasPrivateData, aiTags, … },
    privateData: { status, compression, decodedBytes, preview, decodedMarkers, … },
    markers: [{ id, label, needle, offset, count, present }],
    capabilities: { … },        // 未实现能力一律 false
    diagnostics: [{ code, message, severity }],
    compatibility: { overall, items, note },
    scan: { scannedBytes, truncated, windows, elapsedMs },
  },
}

// 失败（页面不会崩溃）
{ ok: false, aborted: false, error: { code, message, details } }
```

## 3. 错误与诊断模型

- 致命错误使用 `AiViewerError(code, message, details)`，由引擎转换为 `{ ok:false, error }`。
- 非致命问题写入 `report.diagnostics`，等级为 `info` / `warning` / `error`。
- 每个诊断包含稳定 `code`，便于测试与后续 UI 过滤。
- 取消使用 `AbortSignal`，返回 `aborted: true`，不产生错误弹窗。

已实现的稳定错误码（节选）：

`EMPTY_FILE`、`FILE_TOO_LARGE`、`READ_FAILED`、`BINARY_RANGE`、`INFLATE_FAILED`、`INFLATE_LIMIT`、`ASCII85_INVALID`、`ABORTED`。

已实现的诊断码（节选）：

`UNKNOWN_CONTAINER`、`PDF_HEADER_OFFSET`、`TRUNCATED_FILE`、`PDF_WITHOUT_PRIVATE_DATA`、`EPS_PS_SECTION`、`EPS_PS_SECTION_INVALID`、`PRIVATE_DATA_SKIPPED`、`PRIVATE_DATA_TRAILING_DATA`、`PRIVATE_DATA_DECODE_FAILED`、`PRIVATE_DATA_COMPRESSION_UNSUPPORTED`、`SCAN_TRUNCATED`、`CREATOR_NOT_FOUND`。

## 4. 数据与性能约束

- 主线程只做小文件检测；阶段 6 将把大文件解析移入 Worker。
- 读取与解压都有硬上限，禁止无边界分配。
- 标记扫描采用首尾窗口策略，避免数百 MB 文件的全文线性扫描。
- 解压在阶段 1 使用浏览器原生 `DecompressionStream`；阶段 5 增加 WASM 实现，但 JS 路径必须始终可用。
- `report.privateData.text` 只在内部使用，不通过 API 返回，避免大字符串长期驻留。

## 5. 阶段 2 计划

1. `PostScriptLexer`：数字、字符串、名字、数组、字典、注释、十六进制串。
2. `PostScriptParser`：栈式执行，白名单操作符（`m/l/c/v/y/re/h/f/S/w/k/rg/RG/g/G` 等）。
3. `PostScriptGraphicsState`：CTM、颜色、线宽、虚线、裁剪、`q/Q` 栈。
4. `PathBuilder`：MoveTo / LineTo / CubicBezier / ClosePath，保留矢量坐标。
5. `PGF` 数据探索：基于真实样本定位图层、分组、画板与对象关系。
6. 未知操作符：记录操作符、偏移与上下文，安全跳过，不猜测图形。

**进入阶段 3 的前提**：至少一个真实 AI 8/10 样本与一个真实 PDF 包裹样本能够输出稳定的路径 JSON，并有测试证据。

## 6. 后续阶段的边界

- Scene Graph 与 Canvas 完全解耦：渲染器只消费 `Document / Artboard / Group / Shape / Path`。
- Worker 只负责解析，不持有 Canvas；结果通过 Transferable 回传。
- WASM 只做扫描、解压、批量数值处理；解析器保留纯 JS 回退。
- 任何“部分成功”都必须在兼容性报告中显示为 `PARTIAL`，不得显示为完整还原。
