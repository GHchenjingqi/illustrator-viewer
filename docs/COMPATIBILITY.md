# 兼容性报告

> 更新日期：2026-11-19
> 当前阶段：2（基础解析引擎）
> **重要：仓库尚未包含真实 Illustrator 样本，因此不对任何 AI 版本作出兼容性承诺。**

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
| 容器识别 | `FULL`* | `FULL`* | `FULL`* | 基于文件头与标记，不依赖扩展名 |
| 版本标记提取 | `PARTIAL` | `PARTIAL` | `PARTIAL` | Creator 与 `%AI<n>_` 分开记录 |
| 私有数据定位 | `FULL`* | `FULL`* | `PARTIAL` | *仅覆盖 AI9 / AI12 / AI24 标记 |
| 私有数据解码 | `PARTIAL` | `PARTIAL` | `UNSUPPORTED` | zlib / ASCII85；zstd 取决于环境 |
| PostScript 词法 | `PARTIAL`* | `PARTIAL`* | `PARTIAL`* | 仅合成样本验证 |
| 基础绘图操作符 | `PARTIAL`* | `PARTIAL`* | `PARTIAL`* | 白名单子集，未知操作符记录跳过 |
| 路径 / 矩形 / 线段 | `PARTIAL`* | `PARTIAL`* | `PARTIAL`* | 保留局部坐标与 CTM |
| RGB / CMYK / Gray 颜色 | `PARTIAL`* | `PARTIAL`* | `PARTIAL`* | 专色 / ICC / 图案未支持 |
| 画板信息 | `PARTIAL`* | `PARTIAL`* | `PARTIAL`* | 仅 BoundingBox / MediaBox 推断，非原生 Artboard |
| PGF 原生图层语义 | `UNSUPPORTED` | `UNSUPPORTED` | `UNSUPPORTED` | 图层、分组、命名、对象关系未还原 |
| 文字 / 图片 / 渐变 / 裁剪渲染 | `UNSUPPORTED` | `UNSUPPORTED` | `UNSUPPORTED` | 仅记录，不绘制 |
| Scene Graph | `UNSUPPORTED` | `UNSUPPORTED` | `UNSUPPORTED` | 阶段 3 |
| Canvas 渲染 | `UNSUPPORTED` | `UNSUPPORTED` | `UNSUPPORTED` | 阶段 4 |
| PDF 预览图提取 | `UNSUPPORTED` | — | — | 按需求明确不采用 |

\* `FULL` 仅表示检测链路在合成样本上通过，不代表真实 Illustrator 版本兼容性。所有图形解析能力均标记为 `PARTIAL`。

## 3. 合成样本（仅测试解析链路）

由 `npm run generate:samples` 生成，**不是真实 AI 文件**，不能作为兼容性证据。

| 文件 | 类型 | 大小 | SHA-256 | 阶段 2 验证点 |
|---|---|---|---|---|
| `synthetic-ai12-pdf.bin` | PDF + AI12 zlib | 662 B | `4fb873c66b4de8761659b184fe814c42e494474d47013385a567fc605e497e73` | 检测 + zlib + 80 tokens + 2 个矢量（矩形 CMYK / 线段 RGB）+ MediaBox 画板 |
| `synthetic-legacy-ps.bin` | EPS / PostScript 8 风格 | 308 B | `2e9abaf5709cd9af37abd44a186fd69c5b539369b232189de1c26fd83d502ad1` | PostScript 绘图段 + 2 个矢量 + BoundingBox 画板 |
| `synthetic-ai9-eps.bin` | EPS + AI9 ASCII85/zlib | 375 B | `fb8e940e9698a87dcfe0b8dabfa0a858538109d1c7a79d146534a54d96f7b9ee` | AI9 解码 + 1 个矩形 + BoundingBox 画板 |
| `synthetic-truncated-pdf.bin` | 截断 PDF | 69 B | `3e8b6dfc327803823654001320aa7ee5c0f5b4f951cbaa067400d41e921921e7` | `TRUNCATED_FILE` 诊断、不崩溃 |

自动化验证：`npm test`（7 个文件 / 69 项通过）。

## 4. 真实样本登记表

将真实文件放入 `tests/fixtures/real/`，然后运行：

```bash
npm run inspect -- tests/fixtures/real/<file>.ai --write
```

| 文件 | 来源版本 | 大小 | SHA-256 | 容器 | 私有数据 | 矢量对象 | 画板 | 预期 | 实测 |
|---|---|---|---|---|---|---|---|---|---|
| _待补充_ | | | | | | | | | |

## 5. 已知限制

1. 没有真实样本，操作符集合、参数顺序、图层与画板数据均未校准。
2. AI24 Zstandard 解压依赖运行时；Node 22 / 部分浏览器可能不支持。
3. 标记扫描对大文件只覆盖首 2 MiB + 尾 16 MiB。
4. 版本号 17+ 未映射到市场版本名。
5. 裁剪、文字、图片、渐变、透明度组、专色、图案未解析或未渲染。
6. 三次曲线包围盒为控制点近似。
7. 扁平矢量对象尚未恢复分组层级，等待阶段 3。
8. PDF 内容流未解析；无私有数据的 PDF 不会产生矢量结果。

## 6. 诚实性约束

- 不把“检测到 PDF 容器”写成“支持该版本 AI”。
- 不把“解压成功”写成“图形解析成功”。
- 不把“合成样本通过”写成“真实 AI 兼容”。
- 不读取 PDF 预览图冒充原生渲染。
- 每个新能力必须附带真实样本与自动化测试，才能从 `PARTIAL` / `UNSUPPORTED` 升级。
