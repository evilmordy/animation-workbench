import { defineConfig } from 'vitest/config';

// pnpm eval:ai 专用：只跑 tests/eval，不限时（真实模型可能很慢）
export default defineConfig({
  test: { include: ['tests/eval/**/*.eval.ts'], testTimeout: 0 },
});
