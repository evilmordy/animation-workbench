import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vite.config.ts';

// pnpm eval:ai 专用：只跑 tests/eval，不限时（真实模型可能很慢）
export default mergeConfig(
  base,
  defineConfig({ test: { include: ['tests/eval/**/*.eval.ts'], exclude: [], testTimeout: 0 } }),
);
