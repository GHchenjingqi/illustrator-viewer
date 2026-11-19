# 真实 AI 测试样本目录

把 **真实 Adobe Illustrator 导出** 的 `.ai` 文件放在这里，用于阶段 2 之后的解析与渲染验证。

## 要求

1. 必须是 Illustrator 实际导出的文件，禁止改扩展名伪造。
2. 记录来源版本、文件大小、SHA-256、内部结构、预期结果。
3. 大文件不要提交到仓库（建议 `.gitignore` 排除，或使用 Git LFS）。
4. 至少覆盖：
   - Illustrator 8 及以前的 PostScript 结构
   - Illustrator 9 ~ CS6（PDF + AI9/AI12 私有数据）
   - CC 2018+（可能包含 AI24 Zstandard）
   - 多画板 / 渐变 / 透明度 / 文本轮廓 / 嵌入图片 / 复杂路径
   - 损坏或被截断的文件

## 登记方法

```bash
npm run inspect -- tests/fixtures/real/your-file.ai --write
```

会在文件旁生成 `your-file.ai.report.json`。该报告包含：

- 容器类型与版本
- 文件 SHA-256
- 私有数据标记、压缩方式、解码状态
- 能力矩阵与诊断信息

## 建议命名

```
ai8-basic-shapes.ai
ai10-curves.ai
cs6-multi-artboard.ai
cc2024-zstd.ai
broken-truncated.ai
```

并在 `docs/COMPATIBILITY.md` 的“真实样本登记表”中补一行记录。

> 当前仓库尚未包含真实样本，因此**不对任何 Illustrator 版本作出兼容性承诺**。
