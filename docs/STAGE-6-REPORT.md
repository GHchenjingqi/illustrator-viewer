# 阶段 6 交付报告

**阶段：** 6 / 7 — Worker 与 Vue 组件
**状态：** 完成
**日期：** 2026-11-20

## 1. 已完成

| 模块 | 文件 | 说明 |
|---|---|---|
| AIWorker | `src/worker/AIWorker.js` | 后台解析、进度、取消、WASM 初始化 |
| AIWorkerClient | `src/worker/AIWorkerClient.js` | 任务 ID、消息协议、取消、Worker 失败回退 |
| AiViewer | `src/components/AiViewer.vue` | 可复用预览组件；props/events；Worker 解析 |
| ScenePreview 增强 | `src/components/ScenePreview.vue` | zoom/draggable/fullscreen/canvasHeight props；zoom/artboard 事件 |
| 测试 | `tests/worker/*.test.js` | 协议、进度、取消、回退、terminate、组件编译 |

## 2. Worker 协议

```text
PARSE_START   主线程 → Worker（File/Blob/ArrayBuffer + options）
PARSE_PROGRESS Worker → 主线程（phase/ratio/message）
PARSE_RESULT  Worker → 主线程（report）
PARSE_ERROR   Worker → 主线程（结构化错误）
PARSE_CANCEL  主线程 → Worker
WASM_READY    Worker → 主线程（ready/backend）
```

- 每个任务带 `taskId`；旧任务结果不会覆盖新任务。
- `AbortSignal` 触发 `PARSE_CANCEL`，Worker 内 `AbortController` 中止解析。
- Worker 创建失败或运行错误时，`AIWorkerClient` 自动回退主线程 `AIParserEngine`。
- Worker 中加载同一个 WASM 模块；`scan_backend = wasm`。

## 3. AiViewer.vue

Props：

| 属性 | 类型 | 默认 |
|---|---|---|
| file | Object / null | null |
| width | Number / String | `100%` |
| height | Number / String | `auto` |
| zoom | Boolean | true |
| draggable | Boolean | true |
| fullscreen | Boolean | true |
| maxFileSize | Number | 512 MiB |
| worker | Boolean | true |

Events：

`loaded`、`error`、`progress`、`file-change`、`zoom-change`、`artboard-change`、`compatibility`。

暴露方法：`load`、`clear`、`cancel`、`fit`、`actualSize`、`getReport`。

## 4. 验证

- 浏览器真实样本：摘要显示 `Worker` 与 `WASM 扫描`，Canvas 259 个 ArtBox 可见图形正常。
- 文件切换 E2E：合成 AI12 → 旧版 PostScript → 合成 AI12，无旧结果覆盖。
- 取消：Worker 客户端单测验证发送 `PARSE_CANCEL` 并返回 `aborted`。
- 回退：Worker 工厂抛错时走主线程引擎。
- 三浏览器 E2E 全部通过（Chromium / Firefox / WebKit）。

## 5. 已知限制

1. 解析结果通过结构化克隆回传；超大 Scene Graph 尚未使用 Transferable 分块传输。
2. Worker 失败回退时会在主线程重跑解析。
3. AiViewer 已导出并可独立使用，但示例页仍直接使用 AiInspector。
4. 取消是协作式的；当前解析循环仍需在阶段/循环边界检查 AbortSignal。

## 6. 下一步

阶段 7：Playwright 三浏览器测试、图像对比、性能与兼容性报告。
