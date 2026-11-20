# 在 React 中使用 Illustrator Viewer

`illustrator-viewer` 的 Vue 组件 `AiViewer` 不能直接在 React 中渲染。

React 项目请使用无框架入口：

```ts
import { AIWorkerClient, CanvasRenderer } from 'illustrator-viewer/core'
```

`core` 入口不依赖 Vue，只包含：

- `AIParserEngine`
- `AIWorkerClient`
- `CanvasRenderer`
- Scene Graph / 颜色 / 矩阵工具

## 安装

```bash
npm install illustrator-viewer
```

## 示例组件

```tsx
import { useEffect, useRef } from 'react'
import { AIWorkerClient, CanvasRenderer } from 'illustrator-viewer/core'
import wasmUrl from 'illustrator-viewer/wasm/ai_viewer_wasm.wasm?url'

export function AiPreview({ file }: { file: File | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!file || !canvasRef.current) return

    let disposed = false
    let client: AIWorkerClient | null = null
    let renderer: CanvasRenderer | null = null
    let observer: ResizeObserver | null = null

    const load = async () => {
      client = new AIWorkerClient({ wasmUrl })
      const result = await client.parse(file)

      if (disposed || !result.ok || !result.report.scene) return
      if (!canvasRef.current) return

      renderer = new CanvasRenderer(canvasRef.current, {
        background: '#ffffff'
      })
      renderer.setDocument(result.report.scene)

      observer = new ResizeObserver(() => renderer?.resize())
      observer.observe(canvasRef.current)
    }

    load().catch(console.error)

    return () => {
      disposed = true
      observer?.disconnect()
      renderer?.destroy()
      client?.terminate()
    }
  }, [file])

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: 600 }}
    />
  )
}
```

## 缩放和平移

`CanvasRenderer` 提供：

```ts
renderer.zoomAt(1.12, screenX, screenY)
renderer.panBy(dx, dy)
renderer.fit()
renderer.actualSize()
```

在 React 中把对应事件绑定到 canvas 即可。

## WASM

`wasmUrl` 是可选参数：

```ts
const client = new AIWorkerClient({
  wasmUrl: '/wasm/ai_viewer_wasm.wasm'
})
```

不传也能解析，只是扫描速度较慢。

## 返回值

```ts
const result = await client.parse(file)

if (result.ok) {
  console.log(result.report.graphics)
  console.log(result.report.scene)
  console.log(result.report.compatibility)
}
```

## Vue 与 React 的选择

| 场景 | 入口 |
|---|---|
| Vue 3 项目 | `illustrator-viewer` + `AiViewer` |
| React / Svelte / 原生 JS | `illustrator-viewer/core` |
