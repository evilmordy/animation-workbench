import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// 端口固定为 1420，与 src-tauri/tauri.conf.json 的 devUrl 一致
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/spike/**'] } },
  build: { target: 'es2022' },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'tests/runtime/**'],
  },
});
