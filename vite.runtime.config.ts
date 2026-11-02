import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const manimWebVersion: string = JSON.parse(
  readFileSync(new URL('./node_modules/manim-web/package.json', import.meta.url), 'utf8'),
).version;

// 预览 iframe 和导出 HTML 共用的单文件运行时（ES 模块，用 <script type="module"> 加载或内联）
export default defineConfig({
  define: { __MANIM_WEB_VERSION__: JSON.stringify(manimWebVersion) },
  // rolldown 的 IIFE 不能保留对外部模块的动态 import，只能换成空桩
  resolve: {
    alias: { pptxgenjs: fileURLToPath(new URL('./src/runtime/pptxgenjs-stub.ts', import.meta.url)) },
  },
  build: {
    outDir: 'dist-runtime',
    emptyOutDir: true,
    target: 'es2022',
    lib: { entry: 'src/runtime/index.ts', formats: ['es'], fileName: () => 'runtime.js' },
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
