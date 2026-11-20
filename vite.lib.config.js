import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const root = fileURLToPath(new URL('.', import.meta.url))

function copyWasmAsset() {
  return {
    name: 'ai-viewer-copy-wasm',
    closeBundle() {
      const source = resolve(root, 'public/wasm/ai_viewer_wasm.wasm')
      const target = resolve(root, 'dist/wasm/ai_viewer_wasm.wasm')
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(source, target)
    },
  }
}

export default defineConfig({
  // 发布包的静态资源（Worker）使用相对路径，避免宿主站点根路径下 404。
  base: './',
  // 演示页的 public/ 不进入 npm 包；WASM 由插件单独复制。
  publicDir: false,
  plugins: [vue(), copyWasmAsset()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    lib: {
      entry: {
        'illustrator-viewer': resolve(root, 'src/index.js'),
        'illustrator-viewer-core': resolve(root, 'src/headless.js'),
      },
      formats: ['es'],
      fileName: (format, entryName) => `${entryName}.js`,
      cssFileName: 'style',
    },
    rollupOptions: {
      // Vue 由使用方提供；其余依赖（fzstd）直接打进产物，
      // 避免 Worker 产物里残留浏览器无法解析的裸模块说明符。
      external: ['vue'],
    },
  },
})
