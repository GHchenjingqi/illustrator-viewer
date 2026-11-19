# 阶段 3 交付报告

**阶段：** 3 / 7 — Scene Graph
**状态：** 完成；已用真实 AI24 样本验证
**日期：** 2026-11-19

## 1. 已完成

| 模块 | 文件 | 说明 |
|---|---|---|
| SceneBuilder | `src/scene/SceneBuilder.js` | Document → Artboard → Layer/Group/Compound → Shape |
| 变换还原 | `SceneBuilder` + `TransformEngine.invertMatrix` | 绝对 CTM → 父组内相对变换 |
| 解析事件 | `PostScriptParser.sceneEvents` | 图层/组/复合路径的开始、结束、矢量序号、变换 |
| 画板归属 | `SceneBuilder` | 按图形包围盒中心分配画板；单画板使用事件层级 |
| 渐变/专色近似 | `AIGradientExtractor` + `SceneBuilder` | approximate 标记 + 近似 RGB |
| 测试 | `tests/parser/scene-builder.test.js` | 层级、相对变换、复合路径、扁平回退、内容画板 |

## 2. 数据结构

```js
Document
  artboards: [
    {
      type: 'artboard',
      name, rect, width, height,
      children: [Layer/Group/Compound/...]
    }
  ]

Group:
  { type:'group', role:'layer'|'group'|'compound', transform, opacity, visible, children }

Shape:
  {
    type:'shape', shapeType:'path'|'rect'|'line',
    subpaths, fill, stroke, fillRule, strokeWidth, ...,
    transform,       // 相对父组
    absoluteTransform,
    bounds,
    nonPrinting, compound
  }
```

## 3. 真实样本结果

`lengdong-logo.ai`：

- 1 个画板「画板 1」`1250 × 700`
- 2 个图层（根层 + AI 图层）
- 27 个组
- 39 个复合路径
- 841 个图形
- 792 个渐变/专色近似填充
- 层级模式：`events`

## 4. 验收对照

| 验收项 | 状态 |
|---|---|
| 基础结果转换为统一图形对象 | ✅ |
| 层级关系（图层/组/复合路径） | ✅（真实样本事件驱动） |
| 坐标信息准确 | ✅（相对矩阵；真实样本包围盒与画板） |
| 不支持对象明确标记 | ✅（渐变/专色 approximate、非打印、未支持特性） |
| 多画板完整层级 | ⚠️ 多画板暂用扁平图层；当前样本为单画板 |

## 5. 已知限制

1. 多画板的跨画板组层级尚未重建。
2. 渐变/专色为近似色，颜色表与专色语义未完整解析。
3. 裁剪、透明度、文字、图片尚未进入 Scene Graph。
4. 图层/组名称与顺序来自事件流；复杂嵌套仍需更多样本验证。

## 6. 下一步

- 用更多真实样本验证层级、画板归属、复合路径。
- 阶段 4 消费 Scene Graph 进行 Canvas 渲染。
- 阶段 6 将 Scene Graph 构建移入 Worker。
