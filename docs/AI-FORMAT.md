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

### 4.5 AI24 真实样本结构（2026-11-19 校准）

真实样本：Illustrator 29.3 导出的 `lengdong-logo.ai`（PDF 1.6，569 KB，AI24 格式）。

**容器布局**

- PDF 私有数据不是单帧 zstd，而是拆成连续的 PDF stream 对象（本样本为对象 11–18）。
- 仅对象 11 的 stream 以 `%AI24_ZStandard_Data` 开头；对象 12–18 是纯 zstd 续块，每块 64 KiB（最后一块可更短）。
- 拼接 8 个 stream 块后，去掉 `%AI24_ZStandard_Data` 标记，再交给 zstd 解码。
- 解码结果：8,124,703 字节 PostScript 风格文本。
- 本样本实际 stream 数据总长 489,879 字节；按对象顺序截取，不能简单“从标记读到文件末尾”，因为文件尾部还有 PDF xref / trailer。

**二进制数据块**

文本中间包含：
```
%%BeginData: 4738564
<约 6.3 MB 二进制数据>
%%EndData
```
`%%BeginData` 声明值（4,738,564）**不是**实际编码块的字节长度；本样本实际块为 6,318,105 字节。因此实现按 `%%EndData` 边界跳过，而不是按声明长度跳转。该块与 `%AI5_BeginRaster` / `Xh` / `XH` 相关联，是嵌入栅格图，阶段 2 不解码。

**绘图段**

- 私有数据的 prolog / 渐变定义中包含大量**不闭合的 `[` 数组**，它们不是标准 PostScript 数组，不能按标准数组收集到文件末尾。
- 实际绘图内容从 `%AI5_BeginLayer` 开始；从该标记解析可避免 prolog 数组污染操作数栈。
- 本样本：65,114 tokens、12,496 个白名单操作符、841 个矢量对象、0 个未知操作符。

**观察到的 AI 操作符（本样本）**

| 操作符 | 参数 | 语义 / 处理 |
|---|---|---|
| `m` / `l` / `L` | 2 | moveto / lineto（smooth / corner） |
| `c` / `C` | 6 | curveto（smooth / corner） |
| `v` / `V` / `y` / `Y` | 4 | 曲线变体 |
| `h` / `H` | 0 | closepath |
| `f` / `F` / `b` / `B` / `S` | 0 | 绘制 |
| `Xa` / `XA` | **7** | 自定义/专色填充与描边；本样本为 7 个分量，具体颜色空间待确认 |
| `Xw` | 1 | 填充规则（0 → nonzero） |
| `As` / `Ae` / `AE` / `A` / `Ap` | 1 | 外观 / 透明度属性，暂不渲染 |
| `Lb` / `Ln` / `LB` | 14 / 1 / 0 | 图层头 / 图层名 / 图层结束 |
| `u` / `U` / `*u` / `*U` | 0 | 组 / 复合路径 |
| `Bb` / `BB` | 0 | 渐变填充开始 / 结束 |
| `Bg` | 名称 + 多个数字 | 渐变几何定义；实现中清理操作数栈 |
| `Xm` / `Bc` / `Bm` | 6 | 渐变变换矩阵 |
| `Xh` / `XH` / `XI` | 数组 + 数字 | 栅格图，阶段 2 跳过 |
| `O` / `R` | 1 | 叠印设置 |
| `D` / `XR` / `XW` | 1 / 1 / 2 | AI 虚线或画笔样式索引 |

> 操作符参数数量与语义参考公开项目 illustrator-rs 的操作符表，并在真实样本上验证；未复制其源码。

**原生画板**

DocumentData 中包含：

```
(画板 1) /UnicodeString (Name) ,
1250 -700 /RealPointRelToROrigin
(PositionPoint2) ,
0 0 /RealPointRelToROrigin
(PositionPoint1) ,
... (ArtboardArray) ,
```

据此得到画板矩形：`x=0, y=-700, width=1250, height=700`，与 PDF MediaBox 一致；BoundingBox（`-462 -680 1425 345`）是内容范围，不是画板。名称与坐标以 UTF-8 字节存放，需按 UTF-8 重新解码。

**可见范围 / ArtBox**

真实样本在 AI 私有层中包含多份 Logo 副本（原始解析 841 个路径），但 PDF 页面只有：

```
/ArtBox[194.118 285.601 1080.29 422.326]
/MediaBox[0.0 0.0 1250.0 700.0]
```

ArtBox 映射到 AI 坐标（`aiY = pdfY - 700`）为 `x=194.1, y=-414.4, w=886.2, h=136.7`，正好覆盖中间那份可见 Logo。上、下两份副本位于 ArtBox 之外，是隐藏/参考内容。

当前实现：

- 解析 `/ArtBox`。
- 对单画板且 ArtBox 明显小于 MediaBox 的 PDF，按 ArtBox 过滤矢量对象。
- 保留 259 个可见路径，过滤 582 个隐藏/参考副本。
- 输出诊断 `PDF_ARTBOX_VISIBILITY`。
- **这不是完整的 Illustrator 原生可见性/裁剪语义**，只是基于 PDF 页面 ArtBox 的可见范围提示。

**剪裁蒙版 / R 字**

真实样本中 `R` 在 AI 私有层里是：

```text
*u
0 g
<R 外轮廓> f
5 As
<R 内部路径>
Bb ... 渐变 ... f ... BB
*U
```

PDF 页面把它导出为：

```text
<R 外轮廓>
W n
... /Sh0 sh ...
```

即外轮廓是 **剪裁路径**，不是黑色填充；渐变通过 clip 填充整个 R。当前渲染器对“黑色外轮廓 + 渐变内容”的复合组按剪裁蒙版处理，因此 R 显示为渐变字。该规则是启发式，仍需更多真实样本验证。

**仍未确认**

- 渐变几何（方向/径向/矩阵）的完整结构与停靠点之外的 ramp 数据。
- `Xa` 7 个分量分别代表什么颜色空间或专色分量。
- 文本、嵌入图片、画笔/图案的实际渲染语义。
- 原生隐藏/裁剪语义（当前用 ArtBox 辅助过滤）。
- 其他 Illustrator 版本（AI 8 / 10 / CS6 / 2022+）的私有数据布局差异。


---

## 5. 关于 “PGF” 的术语澄清

需求文档中的 `PGFParser` 指 **Illustrator 私有编辑数据层**。需要注意：

- 公开资料中 “PGF” 也指一种小波图像压缩格式（Progressive Graphics File），与本项目目标不是同一概念。
- 从公开实现与合成样本看，AI 私有层表现为带 AI 操作符的 PostScript 风格文本/字节流；但**具体语法、版本差异和二进制段布局尚未用真实文件验证**。
- 因此阶段 1 只将私有数据视为“已定位、可解码的数据块”，`capabilities.pgfParsing = false`。

阶段 2 已经实现一个**通用 PostScript 绘图子集解释器**（词法、白名单操作符、路径、颜色、变换、状态栈），并在合成样本上提取到矩形、线段与颜色。但以下内容仍未验证：

1. 私有数据解压后的 token 流是否稳定为文本操作符。
2. 图层 / 分组 / 路径操作符的实际集合与参数顺序（AI 私有扩展操作符）。
3. 画板（Artboard）信息的位置与坐标系。
4. 颜色空间（RGB / CMYK / 专色）的表达方式。
5. 文本与嵌入图像的数据布局。
6. AI24 Zstandard 段的结构与结束边界。

在真实样本上完成这些验证之前，`capabilities.pgfParsing` 保持 `false`，兼容性最高为 `PARTIAL`。

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
| [fzstd](https://www.npmjs.com/package/fzstd) | MIT | Zstandard 解压 | 运行依赖；只做解压，不含 AI 解析 |
| Adobe AI 兼容性指南 | Adobe 文档 | 版本、容器关系 | 公开资料研究 |

> 本项目不复制上述项目的代码。若后续需要复用，必须先完成许可证与依赖审计，并在 NOTICE 中注明。

---

## 9. 待办（阶段 3 前）

- [x] 实现 PostScriptLexer 与白名单操作符子集（阶段 2，合成样本验证）。
- [x] 实现基础路径 / 颜色 / 线型提取与结构化 JSON（阶段 2）。
- [x] 从 BoundingBox / MediaBox 推断画板候选（阶段 2）。
- [ ] 获取真实 AI 样本（AI 8 / 10 / CS6 / CC 2020+ / AI24 zstd / 损坏文件）。
- [ ] 用 `npm run inspect -- <file> --write` 登记结构报告与 SHA-256。
- [ ] 统计真实私有数据的操作符分布，扩展白名单并保留未知诊断。
- [ ] 验证原生画板信息、图层、分组与坐标系。
- [ ] 决定 PDF 内容流在解析链路中的角色（仅作为补充，不作为“原生解析”替代）。
