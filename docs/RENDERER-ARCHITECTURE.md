# 渲染器架构

> **状态：阶段 4 已实现（部分颜色近似）。** 渐变/专色使用近似纯色，嵌入图片/裁剪/透明度/文字尚未渲染。

## 实现模块

| 模块 | 文件 | 职责 |
|---|---|---|
| `CanvasRenderer` | `src/renderer/CanvasRenderer.js` | 画布生命周期、DPR、视口、画板裁剪、节点绘制 |
| `PathRenderer` | `src/renderer/PathRenderer.js` | Path2D 构建、矩阵应用、复合路径 |
| `ColorEngine` | `src/engine/ColorEngine.js` | RGB/Gray/CMYK → CSS；近似色 |
| `ScenePreview.vue` | `src/components/ScenePreview.vue` | 预览 UI、缩放/平移/适应/1:1/全屏/画板切换 |

## 坐标系

```
AI / Scene Graph 坐标（Y 向上，pt）
        │ 画板平移 + Y 翻转 + 适应缩放
        ▼
Canvas CSS 坐标（px）
        │ DPR 缩放
        ▼
设备像素
```

`computeViewport` 纯函数负责缩放与原点；`worldToScreen` / `screenToWorld` 用于鼠标缩放锚点与后续命中测试。

## 渲染流程

1. 读取字号与 DPR，调整 Canvas 像素尺寸。
2. 计算适应窗口的缩放与居中偏移。
3. 绘制白色画板背景与阴影；裁剪到画板。
4. 应用视口矩阵（`translate → scale(eff, -eff) → translate(-x, -(y+h))`）。
5. 递归绘制 Scene Graph：组变换、复合路径合并、Shape 填充/描边。
6. 恢复视口，绘制画板边框。

## 变换策略

- SceneBuilder 已将绝对 CTM 转换为 **父组内相对变换**。
- 渲染时 `ctx.transform(parent)` 后 `ctx.transform(child)`，与行向量矩阵组合一致。
- 复合路径在组合时应用子图形相对变换，合并成一个 Path2D 后一次填充。

## 部分预览策略

- 渐变/专色：使用 `approxColor`，标记 `approximate`，界面显示“部分预览”。
- 嵌入图片、裁剪、透明度、文字：不绘制，并在预览面板列出。
- 非打印图形：跳过。
- 不使用 PDF 预览图替代。

## 已知限制

1. 未解析渐变颜色表和停靠点，不能绘制真实渐变。
2. `Xa` 专色语义未确认，使用近似 RGB。
3. 裁剪路径未生效。
4. 透明度组只保留结构，未应用 `globalAlpha`/混合模式。
5. 文字/图片对象尚未进入 Scene Graph。
6. 多画板跨画板层级未完整重建。
7. 尚无 Playwright 像素对比测试。

## 后续

- 阶段 6：渲染组件化（`AiViewer.vue`）、Worker 解析、资源释放。
- 阶段 7：多浏览器、DPR、缩放极值、图像对比与内存测试。
