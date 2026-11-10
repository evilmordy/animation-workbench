import { defineConfig } from 'vite';

// 和 manim 的 runtime.js 分开打包。纯 dsl 导出仍内联原来的 runtime.js。
export default defineConfig({
  build: {
    outDir: 'dist-runtime',
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: 'src/runtime/anime/main.ts',
      formats: ['es'],
      fileName: () => 'anime-runtime.js',
    },
    rolldownOptions: {
      output: { codeSplitting: false, comments: { legal: true } },
    },
  },
});
