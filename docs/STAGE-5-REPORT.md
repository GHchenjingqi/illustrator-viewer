# 阶段 5 交付报告

**阶段：** 5 / 7 — WebAssembly 加速
**状态：** 完成；WASM 已用于真实样本的标记扫描，JS 回退可用
**日期：** 2026-11-19

## 1. 已完成

| 模块 | 文件 | 说明 |
|---|---|---|
| Rust WASM 源码 | `wasm-src/src/lib.rs` | 自研 Aho-Corasick 多模式扫描、包围盒、批量变换 |
| 构建脚本 | `scripts/build-wasm.mjs` | `cargo build --target wasm32-unknown-unknown` + 复制产物 |
| WASM 产物 | `public/wasm/ai_viewer_wasm.wasm` | 约 20 KB |
| 加载器 | `src/wasm/WasmLoader.js` | fetch + instantiate；失败不抛出到 UI |
| JS 桥 | `src/wasm/WasmBridge.js` | 显式 alloc/dealloc、内存视图、扫描/包围盒 |
| 检测集成 | `src/core/AIFileDetector.js` | 文件 ≥ 256 KB 时用 WASM 一次遍历所有标记 |
| 回退机制 | `AIParserEngine` | WASM 失败自动走 JS `findAllAscii` |
| 基准测试 | `scripts/benchmark-wasm.mjs` | JS vs WASM 结果与耗时 |
| 测试 | `tests/wasm/wasm-bridge.test.js` | 扫描、包围盒、结果一致性、禁用回退 |

## 2. WASM 导出接口

- `alloc_bytes(size) -> ptr`
- `dealloc_bytes(ptr, size)`
- `scan_patterns(haystack, len, patterns_blob, blob_len, out_counts, out_first, max) -> u32`
- `compute_bounds(points, count, matrix, out) -> u32`
- `transform_points(points, count, matrix, out) -> u32`
- `wasm_version() -> u32`

`patterns_blob` 为简单二进制：`u32 pattern_count`，随后每个模式 `u32 length + bytes`。

## 3. 性能数据

`npm run benchmark:wasm`（Node 22，Windows）：

| 操作 | 数据规模 | JS | WASM | 加速 | 结果一致 |
|---|---|---|---|---|---|
| 多模式扫描（8 个标记） | 16 MiB | 56.75 ms | 31.24 ms | **1.82×** | ✅ |
| 多模式扫描 | 512 KiB | 1.84 ms | 1.01 ms | **1.83×** | ✅ |
| 包围盒（单次批量） | 200k 点 | 0.49 ms | 0.63 ms | 0.78× | ✅ |

说明：

- 扫描是当前主链路真正使用的加速点；一次遍历 8 个模式，减少 JS 多次扫描。
- 包围盒 WASM 接口已实现并通过一致性测试，但逐对象调用时 **内存拷贝/分配开销大于计算收益**，因此主链路默认仍用 JS。后续可在 Worker 中做真正批量接口后再启用。
- 真实样本 569 KB 标记扫描使用 WASM（`report.scan.backend = 'wasm'`）。

## 4. 回退验证

- `WasmBridge({ enabled:false })` → `ready=false`，`computeBounds` 返回 null。
- 浏览器/Node 加载失败 → `WASM_FALLBACK` 诊断，解析继续。
- 单测：WASM 与 JS 包围盒结果一致；多模式扫描计数与 JS 一致。

## 5. 验收对照

| 验收项 | 状态 |
|---|---|
| WASM 可在浏览器运行 | ✅ |
| 解析/扫描结果与 JS 基准一致 | ✅ |
| WASM 加载失败不影响预览 | ✅ |
| 实际性能数据证明有效 | ✅ 扫描约 1.8× |
| 自研 WASM 模块 | ✅ `wasm-src` |

## 6. 已知限制

1. zstd 解压仍使用 fzstd JS；自研 WASM zstd 待后续。
2. 包围盒 WASM 未启用（逐对象调用反而更慢）。
3. 扫描阈值 256 KB；小文件走 JS 以避免固定开销。
4. 尚未在 Firefox / WebKit 上跑 WASM 性能对比。

## 7. 复现

```bash
npm run build:wasm
npm run benchmark:wasm
npm test
```
