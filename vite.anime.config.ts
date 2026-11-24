import { defineConfig } from 'vite';
import { katexInline } from './vite.katex';

export default defineConfig({
  plugins: [katexInline()],
  publicDir: 'src/runtime/public',
  build: {
    outDir: 'dist-runtime',
    emptyOutDir: true,
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
