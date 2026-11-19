# 兼容性报告

> 更新日期：2026-11-19
> 当前阶段：1（结构检测）
> **重要：仓库尚未包含真实 Illustrator 样本，因此不对任何 AI 版本作出兼容性承诺。**

## 1. 等级定义

| 等级 | 含义 |
|---|---|
| `FULL` | 有真实样本与自动化测试证明完整支持 |
| `PARTIAL` | 能处理部分数据，但存在明确未覆盖项 |
| `UNSUPPORTED` | 尚未实现，或按需求明确不采用 |
| `INVALID` | 数据损坏 / 无法识别 / 解析失败 |

## 2. 阶段 1 能力矩阵

| 能力 | PDF 包裹型 | EPS / DOS EPS | 纯 PostScript | 说明 |
|---|---|---|---|---|
| 容器识别 | `FULL` | `FULL` | `FULL` | 基于文件头与标记，不依赖扩展名 |
| 版本标记提取 | `PARTIAL` | `PARTIAL` | `PARTIAL` | `%AI<n>_` 与 Creator 分开记录；高版本市场名未映射 |
| 私有数据定位 | `FULL`* | `FULL`* | `PARTIAL` | *仅限已覆盖的 AI9 / AI12 / AI24 标记 |
| 私有数据解码 | `PARTIAL` | `PARTIAL` | `UNSUPPORTED` | zlib / ASCII85 可用；zstd 取决于浏览器 |
| 标记偏移报告 | `FULL` | `FULL` | `FULL` | 大文件仅扫描首尾窗口 |
| PostScript 语法解析 | `UNSUPPORTED` | `UNSUPPORTED` | `UNSUPPORTED` | 阶段 2 |
| PGF / 私有图形解析 | `UNSUPPORTED` | `UNSUPPORTED` | `UNSUPPORTED` | 阶段 2 |
| Scene Graph | `UNSUPPORTED` | `UNSUPPORTED` | `UNSUPPORTED` | 阶段 3 |
| Canvas 渲染 | `UNSUPPORTED` | `UNSUPPORTED` | `UNSUPPORTED` | 阶段 4 |
| PDF 预览图提取 | `UNSUPPORTED` | — | — | 按需求明确不采用 |

\* “私有数据定位”只证明标记与数据段存在，不证明其中的图形语义可解析。

## 3. 合成样本（仅测试检测链路）

这些文件由 `npm run generate:samples` 生成，**不是真实 AI 文件**，不能作为兼容性证据。

| 文件 | 类型 | 大小 | SHA-256 | 验证点 |
|---|---|---|---|---|
| `synthetic-ai12-pdf.bin` | PDF + AI12 zlib | 629 B | `09a982e6469603171e92839edf1440653e6f43c27cd28606fcf10e7c10076454` | PDF 头、Creator、AI12 标记、zlib 解压、图层标记 |
| `synthetic-legacy-ps.bin` | EPS / PostScript 8 风格 | 271 B | `467c926565ac0a7c7e2d982c9731f2c555c96aa3b97bfc00983b76bfe10347ea` | PostScript 容器、BoundingBox、Creator 8.0 |
| `synthetic-ai9-eps.bin` | EPS + AI9 ASCII85/zlib | 354 B | `89e56224e39692d1714b57f3b23d19589a3373e23329d0e16d14a553c28ed100` | AI9 私有数据边界、ASCII85、嵌套 zlib |
| `synthetic-truncated-pdf.bin` | 截断 PDF | 69 B | `3e8b6dfc327803823654001320aa7ee5c0f5b4f951cbaa067400d41e921921e7` | `TRUNCATED_FILE` 诊断、不崩溃 |

自动化验证：`npm test`（34 项通过）。

## 4. 真实样本登记表

将真实文件放入 `tests/fixtures/real/`，然后运行：

```bash
npm run inspect -- tests/fixtures/real/<file>.ai --write
```

| 文件 | 来源版本 | 大小 | SHA-256 | 容器 | 私有数据 | 预期 | 实测 | 备注 |
|---|---|---|---|---|---|---|---|---|
| _待补充_ | | | | | | | | |

## 5. 已知限制

1. 没有真实样本，无法确认私有数据标记在所有版本中的位置与命名。
2. AI24 Zstandard 解压依赖运行时；Node 22 / 部分浏览器可能不支持。
3. 标记扫描对大文件只覆盖首 2 MiB + 尾 16 MiB，极端布局可能漏检。
4. 版本号 17+ 未映射到市场版本名，避免错误断言。
5. AI 私有数据中的具体 token 语义尚未验证；“PGF”解析能力为 0。
6. PDF 内容流未解析；即使 PDF 中存在可绘制内容，也不会在阶段 1 渲染。

## 6. 诚实性约束

- 不把“检测到 PDF 容器”写成“支持该版本 AI”。
- 不把“解压成功”写成“图形解析成功”。
- 不读取 PDF 预览图冒充原生渲染。
- 每个新能力必须附带真实样本、自动化测试和可复现命令，才能从 `UNSUPPORTED` 升级。
