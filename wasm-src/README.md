# ai_viewer_wasm

Illustrator Viewer 的自研 WebAssembly 加速模块（Rust）。

## 构建

```bash
rustup target add wasm32-unknown-unknown
npm run build:wasm
```

产物：`public/wasm/ai_viewer_wasm.wasm`。

## 导出

- `alloc_bytes` / `dealloc_bytes`
- `scan_patterns`：Aho-Corasick 多模式扫描（主链路使用）
- `compute_bounds`：批量仿射包围盒
- `transform_points`：批量坐标变换
- `wasm_version`

`patterns_blob` 格式：`u32 pattern_count`，随后每个模式 `u32 length + bytes`。

## 边界

- 只做字节/数值热点，不包含任何 AI 解析语义。
- JavaScript 解析器必须始终可独立运行。
- 当前主链路只启用 `scan_patterns`；包围盒逐对象调用因拷贝开销较大，暂未启用。
