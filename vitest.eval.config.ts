import { defineConfig } from 'vitest/config';

// pnpm eval:ai 专用：只跑五题初筛，不限时，不进 CI。
export default defineConfig({
  test: { include: ['tests/eval/**/*.eval.ts'], testTimeout: 0 },
});
