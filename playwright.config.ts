import { defineConfig } from '@playwright/test';

/**
 * UX-03 用墙钟时间卡无头软件渲染。它和别的 e2e 抢同一台机器时，p95 会被抬过阈值
 * （main 上曾测到 4778ms）。perf 项目等其余用例结束后再独占 worker 跑。
 * 只跑这一条：`pnpm exec playwright test --project=perf --no-deps`
 */
export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  use: { channel: 'chromium', viewport: { width: 1440, height: 900 } },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'e2e',
      testMatch: ['runtime/**/*.spec.ts', 'e2e/**/*.spec.ts'],
      testIgnore: ['**/perf.spec.ts', '**/three.spec.ts'],
    },
    {
      name: 'three',
      testMatch: '**/three.spec.ts',
      // §4.4：3D 夹具在 CI 里走 SwiftShader，截帧才稳定、读得到。
      use: {
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
    {
      name: 'perf',
      testMatch: '**/perf.spec.ts',
      dependencies: ['e2e', 'three'],
      workers: 1,
    },
  ],
});
