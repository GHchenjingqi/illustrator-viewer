# 兼容性报告

> 更新日期：2026-11-19
> 当前阶段：7（解析 + Scene Graph + Canvas + WASM + Worker）
> 真实样本：1 个 AI24（Illustrator 29.3 导出）已通过结构与基础矢量解析验证。
> **仍不对其他 Illustrator 版本作出兼容性承诺。**

## 1. 等级定义

| 等级 | 含义 |
|---|---|
| `FULL` | 有真实样本与自动化测试证明完整支持 |
| `PARTIAL` | 能处理部分数据，但存在明确未覆盖项 |
| `UNSUPPORTED` | 尚未实现，或按需求明确不采用 |
| `INVALID` | 数据损坏 / 无法识别 / 解析失败 |

## 2. 阶段 2 能力矩阵

| 能力 | PDF 包裹型 | EPS / DOS EPS | 纯 PostScript | 说明 |
|---|---|---|---|---|
| 容器识别 | `FULL` | `FULL`* | `FULL`* | 基于文件头与标记 |
| 版本 / 元信息提取 | `PARTIAL` | `PARTIAL` | `PARTIAL` | Creator、应用版本、`%AI<n>_` 分开记录 |
| 私有数据定位 | `FULL`* | `FULL`* | `PARTIAL` | 已覆盖 AI9 / AI12 / AI24 |
| 私有数据解码 | `PARTIAL` | `PARTIAL` | `UNSUPPORTED` | AI24 zstd 已用真实样本验证；其他版本待测 |
| AI24 PDF stream 分块拼接 | `FULL`* | — | — | 真实样本为对象 11–18，8 块 |
| `%%BeginData` 二进制块跳过 | `FULL`* | `FULL` | `FULL` | 按 `%%EndData` 边界跳过 |
| PostScript 词法 / 基础操作符 | `PARTIAL` | `PARTIAL` | `PARTIAL` | 白名单 + AI 大写路径变体 |
| AI 私有操作符 | `PARTIAL`* | `PARTIAL`* | `PARTIAL`* | 图层、组、渐变、外观、栅格操作符已识别 |
| 路径 / 矩形 / 线段 | `PARTIAL` | `PARTIAL` | `PARTIAL` | 保留局部坐标与 CTM |
| RGB / CMYK / Gray | `PARTIAL` | `PARTIAL` | `PARTIAL` | 已支持 |
| 渐变 / 专色 | `PARTIAL`* | `PARTIAL`* | `PARTIAL`* | 停靠点已解析；渐变几何近似，专色用近似 RGB |
| 原生画板 | `PARTIAL`* | `PARTIAL`* | `PARTIAL`* | AI DocumentData ArtboardArray；1 个真实样本验证 |
| 文字 / 图片 / 裁剪渲染 | `UNSUPPORTED` | `UNSUPPORTED` | `UNSUPPORTED` | 只记录，不绘制 |
| Scene Graph | `PARTIAL`* | `PARTIAL`* | `PARTIAL`* | 图层/组/复合路径/画板；多画板层级待完善 |
| Canvas 渲染 | `PARTIAL`* | `PARTIAL`* | `PARTIAL`* | 路径/颜色/缩放/平移；渐变几何与专色近似 |
| WASM 扫描加速 | `PARTIAL`* | `PARTIAL`* | `PARTIAL`* | 标记扫描约 1.8×；JS 回退 |
| Worker 后台解析 | `PARTIAL`* | `PARTIAL`* | `PARTIAL`* | 进度/取消/文件切换；Worker 失败回退 |
| PDF 预览图提取 | `UNSUPPORTED` | — | — | 按需求明确不采用 |

\* 仅代表已有实现与（部分）真实样本证据，不代表所有版本完整兼容。

## 3. 真实样本登记表

| 文件 | 来源版本 | 大小 | SHA-256 | 容器 | 私有数据 | 矢量对象 | 原生画板 | 结果 |
|---|---|---|---|---|---|---|---|---|
| `lengdong-logo.ai` | Illustrator 29.3 / AI24 | 569,228 B | `57847b69ee617af73ad630afeeb056efd14e06aa9582d4d86cf95ea7bccbd588` | PDF 1.6 | `%AI24_ZStandard_Data`，8 个 stream 块，zstd → 7.75 MB | 841 原始 / 259 可见 | 「画板 1」1250 × 700 | `PARTIAL` |
| `wuyingying.ai` | Illustrator 28.1 / AI24 | 91,014 B | `81f47ed42edcf29a8e3b5a890a43f33bf2af28c958f6d5a9e2286bfb21e3bf7d` | PDF 1.6 | `%AI24_ZStandard_Data`，1 个 stream，zstd → 248,803 B | 82 | 「画板 1」595.276 × 841.890 | `PARTIAL` |

详细结果：

- 65,114 tokens / 12,496 个白名单操作符 / **841 个原始矢量** / 0 未知操作符。
- PDF `/ArtBox` 可见范围过滤：保留 **259** 个，过滤 **582** 个隐藏/参考副本。
- 540 个渐变填充标记、252 个自定义颜色、48 个 Gray、1 个无填充。
- Scene Graph：1 画板 / 2 图层 / 27 组 / 39 复合路径 / 259 可见图形。
- Canvas：259 可见图形已绘制（258 个可绘制对象，1 个剪裁蒙版合并）；近似几何/颜色明确提示。
- WASM：标记扫描 `scan.backend = wasm`；JavaScript 回退可用。
- 嵌入栅格图 2 个，二进制块 6.3 MB 已跳过。
- 浏览器解析 + 构建 Scene Graph 约 350 ms。

真实样本默认被 `.gitignore` 排除，避免商业素材进入仓库；本地集成测试见 `tests/integration/real-ai24.test.js`。

## 4. 合成样本（仅测试解析链路）

由 `npm run generate:samples` 生成，**不是真实 AI 文件**，不能作为兼容性证据。

| 文件 | 类型 | 大小 | SHA-256 | 验证点 |
|---|---|---|---|---|
| `synthetic-ai12-pdf.bin` | PDF + AI12 zlib | 662 B | `4fb873c66b4de8761659b184fe814c42e494474d47013385a567fc605e497e73` | 检测 + zlib + 2 个矢量 + MediaBox |
| `synthetic-legacy-ps.bin` | EPS / PostScript 8 风格 | 308 B | `2e9abaf5709cd9af37abd44a186fd69c5b539369b232189de1c26fd83d502ad1` | PostScript 绘图段 + 2 个矢量 + BoundingBox |
| `synthetic-ai9-eps.bin` | EPS + AI9 ASCII85/zlib | 375 B | `fb8e940e9698a87dcfe0b8dabfa0a858538109d1c7a79d146534a54d96f7b9ee` | AI9 解码 + 1 个矩形 + BoundingBox |
| `synthetic-truncated-pdf.bin` | 截断 PDF | 69 B | `3e8b6dfc327803823654001320aa7ee5c0f5b4f951cbaa067400d41e921921e7` | `TRUNCATED_FILE` 诊断、不崩溃 |

自动化验证：`npm test`（18 个文件 / 111 项通过）；`npm run test:e2e`（Chromium / Firefox / WebKit 共 21 项）。真实样本缺失时集成/E2E 自动跳过。

## 5. 已知限制

1. 仅有 1 个 AI24 真实样本；AI 8 / 10 / CS / CS6 / 其他 CC 版本尚未验证。
2. 渐变停靠点已解析为偏移 + RGB；渐变几何（方向/径向/矩阵）仍为近似，预览使用近似线性渐变。
3. `Xa` / `XA` 只保留原始 7 个分量，颜色空间与专色语义待确认；预览使用近似 RGB。
4. 文字、嵌入图片、画笔/图案、裁剪、透明度尚未渲染。
5. 多画板的跨画板层级尚未完整重建；单画板使用事件层级。
6. 三次曲线包围盒为控制点近似。
7. AI24 zstd 使用 fzstd（JS）解码；WASM 扫描已启用，WASM zstd 待后续。
8. 大文件解析在 Worker 中执行；解析结果通过结构化克隆回传，尚未做超大 Scene Graph 分块传输。
9. 画板坐标来自 DocumentData，Y 轴在渲染器中翻转处理。
10. Playwright 基线在 Windows 生成；其他平台需重新生成。

## 6. 诚实性约束

- 不把“检测到 PDF 容器”写成“支持该版本 AI”。
- 不把“解压成功”写成“完整图形解析成功”。
- 不把“1 个样本通过”写成“所有 AI24 文件兼容”。
- 渐变/专色未完整还原时使用近似几何/颜色并明确标注。
- 不读取 PDF 预览图冒充原生渲染。
