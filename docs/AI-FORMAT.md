# AI 文件格式研究笔记（阶段 1）

> 状态：进行中。本文区分 **已验证事实（合成结构）**、**公开资料结论** 与 **待真实样本确认的假设**。
> 当前没有任何真实 Illustrator 文件进入测试集，因此本文不构成版本兼容性承诺。

## 1. 结论摘要

Illustrator 的 `.ai` 不是单一格式。阶段 1 按容器划分为三类：

| 容器 | 典型识别特征 | 常见版本 | 私有数据位置 |
|---|---|---|---|
| PDF 包裹型 | 文件头 `%PDF-1.x`，尾部 `%%EOF` | Illustrator 9 及以后 | PDF 尾部之后追加的 AI 私有数据段 |
| EPS（PostScript） | `%!PS-Adobe` + `%%BoundingBox` | 旧版 / EPS 兼容导出 | `%AI9_PrivateDataBegin` … `%AI9_PrivateDataEnd` |
| 纯 PostScript | `%!PS-Adobe`，无 BoundingBox | 早期版本 | 直接内联在 PostScript 文本中 |

另有 DOS EPS 二进制封装：文件头 4 字节魔数 `C5 D0 D3 C6`，随后是小端序的 PostScript 段偏移/长度等字段。

AI 私有数据段与 PDF 内容是**两套数据**：

- PDF 部分：标准 PDF 对象、页面、内容流，可能包含预览图或绘制指令。
- AI 私有部分：Illustrator 的原生编辑数据（图层、路径、颜色、文本等）。

本项目阶段 1 **只做定位与解码**，不解析其中任何图形语义，也**不读取 PDF 预览图**。

---

## 2. 识别规则与优先级

`AIFileDetector` 的判定顺序：

1. **DOS EPS 魔数**：`0xC5 0xD0 0xD3 0xC6`
2. **PDF 头**：在前 1024 字节内查找 `%PDF-`（允许头部存在偏移）
3. **PostScript 头**：在前 1024 字节内查找 `%!PS-Adobe`
   - 前 2 MB 内存在 `%%BoundingBox` → EPS
   - 否则 → 纯 PostScript
4. 都不匹配 → `unknown`，输出 `UNKNOWN_CONTAINER` 诊断，不抛异常

不对 `.ai` 扩展名做任何假设；同一个检测器可以直接处理 `.eps` / `.ps` / `.pdf`。

---

## 3. 关键标记

| 标记 | 含义 | 阶段 1 处理 |
|---|---|---|
| `%PDF-1.x` | PDF 容器版本 | 记录版本 |
| `startxref` / `%%EOF` | PDF 交叉引用与结束 | 记录位置；缺失时告警“可能截断” |
| `%!PS-Adobe` | PostScript 文件头 | 容器识别 |
| `%%BoundingBox` | EPS 页面边界 | 区分 EPS / 纯 PostScript |
| `%%Creator: Adobe Illustrator(R) x.y` | Illustrator Creator 版本 | 记录原始版本号 |
| `%%BeginData: N Binary Bytes` | 二进制数据块声明 | 记录偏移与声明长度 |
| `%AI9_PrivateDataBegin` / `%AI9_PrivateDataEnd` | AI9+ 私有数据边界（EPS） | 提取并解码 |
| `%AI12_CompressedData` / `%AI12_EndCompressedData` | AI12 压缩私有数据边界 | 提取并 zlib 解压 |
| `%AI24_ZStandard_Data` | AI24 Zstandard 数据 | 提取；解压能力取决于环境 |
| `%AI5_BeginLayer` / `%AI5_EndLayer--` | 图层段标记 | 仅统计，尚未解析图层语义 |
| `%AI12_PGF` / `%AI12_CsPt` | 私有图层内部段名 | 仅统计 |
| `%AI9_FileData` | AI9 文档数据段 | 仅统计 |
| `%AI<n>_`（通用） | 私有格式版本线索 | 汇总为 `aiFormatVersions` |

说明：

- 标记的**存在**不等于数据一定有效。阶段 1 会校验压缩头、解压结果和边界，异常写入诊断。
- 标记扫描默认只覆盖小文件全文，或大文件首 2 MB + 尾 16 MB，以控制主线程开销；报告会标注 `scan.truncated`。
- `aiFormatVersion` 来自 `%AI<n>_` 标记（例如 AI12 → 12），表示私有段格式/压缩方案的引入版本，**不等同于文件的营销版本**。Creator（如 `24.0`）单独记录；仅 8 ~ 16 使用较可靠的系列名映射，17+ 不臆测年份或系列名称。

---

## 4. 私有数据与压缩

### 4.1 AI12：zlib

公开实现（illustrator-rs）与合成样本均表明：`%AI12_CompressedData` 标记后是 zlib（RFC 1950）流，结束标记 `%AI12_EndCompressedData` 位于二进制流之后。

实现要点：

- 跳过标记后的空白字节后检查 zlib 头。
- zlib 流结束后紧跟文本标记，原生 `DecompressionStream` 会报 `Trailing junk`；此时保留已解出的数据并标记 `trailingData: true`。
- 解压结果以 Latin-1 解码用于结构标记扫描，避免二进制造成 UTF-8 替换字符。

### 4.2 AI24：Zstandard

`%AI24_ZStandard_Data` 之后为 Zstandard 帧（魔数 `28 B5 2F FD`）。

- 阶段 1 尝试调用 `DecompressionStream('zstd')`；环境不支持时返回 `PRIVATE_DATA_COMPRESSION_UNSUPPORTED`，不影响结构报告。
- 阶段 5 将提供自研 WASM 解压路径，同时保留 JS 回退。

### 4.3 AI9（EPS）：ASCII85 + 可选 zlib

EPS 私有数据段通常为按行 `%` 前缀的 ASCII85 数据，可能再包裹 zlib：

```
%AI9_PrivateDataBegin
<~
%<ascii85 数据行>
~>
%AI9_PrivateDataEnd
```

实现要点：

- 去掉行首 `%` 与 `%%` 注释行，拼接后识别 `<~ ... ~>`。
- ASCII85 解码后检查 zlib 头，再解压。
- 对非法字符、末尾组长度、输出大小均做校验。

### 4.4 未压缩 / 其他

若私有数据既不是 zlib / zstd / ASCII85，阶段 1 将其作为原始 Latin-1 文本处理，并保留预览与诊断。未知压缩方式不会被静默忽略。

---

## 5. 关于 “PGF” 的术语澄清

需求文档中的 `PGFParser` 指 **Illustrator 私有编辑数据层**。需要注意：

- 公开资料中 “PGF” 也指一种小波图像压缩格式（Progressive Graphics File），与本项目目标不是同一概念。
- 从公开实现与合成样本看，AI 私有层表现为带 AI 操作符的 PostScript 风格文本/字节流；但**具体语法、版本差异和二进制段布局尚未用真实文件验证**。
- 因此阶段 1 只将私有数据视为“已定位、可解码的数据块”，`capabilities.pgfParsing = false`。

阶段 2 必须在真实样本上完成以下验证后才能声明 PGF 解析能力：

1. 私有数据解压后的 token 流是否稳定为文本操作符。
2. 图层 / 分组 / 路径操作符的实际集合与参数顺序。
3. 画板（Artboard）信息的位置与坐标系。
4. 颜色空间（RGB / CMYK / 专色）的表达方式。
5. 文本与嵌入图像的数据布局。
6. AI24 Zstandard 段的结构与结束边界。

---

## 6. 版本与坐标系

- Creator 字符串（如 `Adobe Illustrator(R) 24.0`）是文件版本线索；`%AI12_` 只是私有段/压缩方案标记，不是文件版本号。现代 Illustrator（如 2020/24.0）同样可能使用 AI12 压缩段，因此不能把 AI12 直接解释为 CS2。
- Illustrator 原生坐标通常为 Y 轴向上、单位为 point（1/72 inch），与 Canvas 的 Y 轴向下不同。阶段 4 的 `TransformEngine` 必须显式处理翻转与画板定位。
- 画板尺寸/原点尚未从真实文件验证；阶段 1 不做任何坐标推断。

---

## 7. 安全边界（阶段 1 已实现）

| 限制 | 当前值 |
|---|---|
| 单文件大小 | 512 MiB |
| 私有数据段读取 | 64 MiB |
| 单次解压输出 | 128 MiB |
| 单次字符串读取 | 4 MiB |
| 标记计数上限 | 2000 |
| 标记扫描窗口 | 小文件全文；大文件首 2 MiB + 尾 16 MiB |
| 外部网络访问 | 无 |
| 文件上传 | 无 |
| 脚本执行 | 无（不做 PostScript 执行） |

所有二进制读取均通过 `BinaryParser.assertRange`；压缩输出受 `DecompressionStream` 读取上限控制。

---

## 8. 参考项目与许可

| 项目 | 许可 | 研究内容 | 使用方式 |
|---|---|---|---|
| [Pilser/illustrator-rs](https://github.com/Pilser/illustrator-rs) | MIT | 容器识别、私有数据标记、zlib / ASCII85 提取思路 | 阅读架构与格式线索，未复制源码 |
| [opendesigndev/illustrator-parser-pdfcpu](https://github.com/opendesigndev/illustrator-parser-pdfcpu) | Apache-2.0 | AI 数据提取、WASM/Worker 组织 | 仅参考架构；不引入 pdfcpu |
| [flyfish-dev/file-viewer](https://github.com/flyfish-dev/file-viewer) | Apache-2.0 | 兼容性诊断、多格式模块边界 | 仅参考设计；未复制源码 |
| Adobe AI 兼容性指南 | Adobe 文档 | 版本、容器关系 | 公开资料研究 |

> 本项目不复制上述项目的代码。若后续需要复用，必须先完成许可证与依赖审计，并在 NOTICE 中注明。

---

## 9. 待办（阶段 2 输入）

- [ ] 获取真实 AI 样本（AI 8 / 10 / CS6 / CC 2020+ / AI24 zstd / 损坏文件）。
- [ ] 用 `npm run inspect -- <file> --write` 登记结构报告与 SHA-256。
- [ ] 分析解压后的 token 流，建立操作符白名单。
- [ ] 验证画板信息与坐标系。
- [ ] 决定 PDF 内容流在解析链路中的角色（仅作为补充，不作为“原生解析”替代）。
