import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const manimWebVersion = JSON.parse(readFileSync('node_modules/manim-web/package.json', 'utf8')).version;

// 单文件 IIFE：awpreview 用普通 <script src> 加载，导出 HTML 时可直接内联，file:// 也能跑
export default defineConfig({
  define: { __MANIM_WEB_VERSION__: JSON.stringify(manimWebVersion) },
  build: {
    outDir: 'dist-runtime',
    emptyOutDir: true,
    minify: true,
    lib: { entry: 'src/main.js', formats: ['iife'], name: 'AwbSpike', fileName: () => 'runtime.js' },
    // pptxgenjs 是 manim-web 的可选依赖（PPTX 导出），import 失败时它自己会报错
    rollupOptions: { external: ['pptxgenjs'], output: { inlineDynamicImports: true } },
  },
});
