# 阶段 7 交付报告

**阶段：** 7 / 7 — 兼容性与性能测试
**状态：** 完成（测试矩阵与已知缺口如下）
**日期：** 2026-11-20

## 1. 测试体系

| 层级 | 工具 | 数量 | 内容 |
|---|---|---|---|
| 单元测试 | Vitest | 16 个文件 / 105 项 | 读取、二进制、ASCII85、zlib、AI24、词法、解析、矢量、画板、Scene Graph、渲染、WASM、Worker、渐变、剪裁蒙版 |
| 真实样本集成 | Vitest | 1 项（本地） | 真实 AI24：解压、841 矢量、原生画板、WASM |
| 浏览器 E2E | Playwright | 15 项（5 场景 × 3 浏览器） | 解析、Canvas、图像对比、工具栏、文件切换、损坏文件、真实样本 |
| 性能基准 | Node | 1 项 | WASM vs JS 扫描/包围盒 |

## 2. 浏览器矩阵

`npm run test:e2e`：

| 浏览器 | 结果 | 备注 |
|---|---|---|
| Chromium (Playwright Chrome for Testing 159) | ✅ 5/5 | 真实样本 ~2.5 s |
| Firefox 159 | ✅ 5/5 | 真实样本 ~1.8 s |
| WebKit 27.2 | ✅ 5/5 | 真实样本约 4–10 s |

E2E 覆盖：

1. 合成 AI12：解析、Worker、Canvas、非白像素检查、截图对比。
2. 工具栏：放大、适应、1:1。
3. 文件切换：合成 AI12 → 旧版 PS → 合成 AI12，旧结果不覆盖新结果。
4. 真实 AI24：841 原始路径中 259 个 ArtBox 可见图形、原生画板、WASM、Worker、部分预览提示、非白像素 > 1000。
5. 截断 PDF：输出 `TRUNCATED_FILE` 诊断，页面不崩溃。

图像对比基线：

```
tests/e2e/__screenshots__/viewer.spec.js/synthetic-ai12-{chromium,firefox,webkit}.png
```

基线在 Windows 生成；其他平台可能需要重新生成（`npm run test:e2e:update`）。

## 3. 性能结果

详见 [`PERFORMANCE.md`](PERFORMANCE.md)。

- WASM 多模式扫描 16 MiB：**57.8 ms → 32.4 ms（约 1.8×）**，结果一致。
- WASM 扫描 512 KiB：约 **1.8×**。
- 真实 AI24：解析 + Scene Graph 约 **350 ms**（Node/浏览器引擎内部报告）。
- E2E 从上传到 Canvas 可见：Chromium 约 2.5 s，Firefox 约 1.8 s，WebKit 约 4–10 s（含页面加载、Worker、WASM、2 次 UI 渲染）。
- 文件切换连续 3 次无错误、无旧结果覆盖。

## 4. 兼容性结论

- 阶段 7 验证了 Chromium / Firefox / WebKit 的**基础解析与预览链路**。
- 真实 AI24 样本在三种浏览器中均能渲染 259 个 ArtBox 可见图形（原始 841）。
- 渐变/专色仍是近似色，嵌入图片/裁剪/透明度未渲染，界面有明确提示。
- 仅 1 个真实 AI24 样本；这不构成其他 Illustrator 版本的兼容承诺。

## 5. 已知缺口

1. 未覆盖 AI 8 / 10 / CS / CS6 / 各 CC 版本的真实文件集。
2. 未做超大文件（>100 MB）与极端路径数量压力测试。
3. 未做自动化堆快照/内存泄漏对比；仅验证销毁与文件切换无错误。
4. 图像对比只覆盖合成 AI12 画布；真实样本因版权不纳入基线。
5. 渐变/专色/文字/图片/裁剪仍未完整还原。
6. Windows 基线在其他平台需重新生成。

## 6. 复现

```bash
npm test
npm run build
npm run test:e2e
npm run benchmark:wasm
```
