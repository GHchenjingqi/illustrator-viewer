# 性能报告

**日期：** 2026-11-20
**环境：** Windows，Node 22.22.2，Chromium 159 / Firefox 159 / WebKit 27.2
**样本：** `lengdong-logo.ai`（569,228 B，AI24，PDF 1.6）

## 1. 引擎内部耗时

通过 `npm run inspect` 读取 `report.durationMs`（Node）：

| 阶段 | 耗时（约） |
|---|---|
| 读取 + 结构检测 + AI24 分块 zstd 解压 | ~150 ms |
| PostScript 解析 + 矢量提取（841 对象） | ~150 ms |
| Scene Graph 构建 | ~50 ms |
| 合计 | **~350 ms** |

浏览器 E2E 从上传到 Canvas 可见包含页面加载、Worker 启动、WASM 初始化、两次 UI 渲染：

| 浏览器 | 上传 → Canvas 可见 |
|---|---|
| Chromium 159 | ~2.5 s |
| Firefox 159 | ~1.8 s |
| WebKit 27.2 | ~4–10 s |

## 2. WASM vs JavaScript

`npm run benchmark:wasm`：

```text
bounds: JS 0.49 ms | WASM 0.63 ms | speedup 0.78x | equal=true
scan:   JS 56.75 ms | WASM 31.24 ms | speedup 1.82x | equal=true
```

| 操作 | 规模 | JS | WASM | 加速 |
|---|---|---|---|---|
| 8 模式扫描 | 16 MiB | 56.8 ms | 31.2 ms | **1.8×** |
| 8 模式扫描 | 512 KiB | 1.84 ms | 1.01 ms | **1.83×** |
| 包围盒 | 200k 点 | 0.49 ms | 0.63 ms | 0.78×（未启用） |

结论：

- 多模式扫描是有效热点，已在主链路启用（文件 ≥ 256 KiB）。
- 包围盒逐对象调用受内存拷贝开销影响，**不启用**；WASM 接口保留给后续批量方案。
- JS 回退在 WASM 不可用时保持完整功能。

## 3. 渲染性能

真实样本：

- Canvas 绘制 841 个图形（含 39 个复合路径、27 个组）。
- 浏览器像素抽检：画板中心 240×240 区域约 10,000 个非白像素，确认实际绘制。
- 缩放/平移/1:1/适应均可用；DPR 适配最高 3×。

## 4. 文件切换与资源

E2E 连续上传：合成 AI12 → 旧版 PostScript → 合成 AI12。

- 无控制台错误。
- 无旧结果覆盖新结果。
- ScenePreview 卸载时调用 `CanvasRenderer.destroy()`；AiInspector 卸载时终止 Worker。
- 未做自动化堆快照对比，因此不宣称“无内存泄漏”，仅验证生命周期释放路径。

## 5. 安全限制对性能的影响

- 单文件 512 MiB、私有数据 64 MiB、解压 128 MiB、绘图文本 16 MiB。
- token 200k、对象 50k、路径点 1M、诊断 200。
- 真实样本远低于上限，未触发截断。

## 6. 结论

- 当前实现可在三种浏览器中稳定解析并预览真实 AI24 文件。
- WASM 在扫描环节有可复现的约 1.8× 加速。
- 大文件、超多路径、内存泄漏、其他 Illustrator 版本仍是后续性能与兼容性工作。
