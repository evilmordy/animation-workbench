import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: ['runtime/**/*.spec.ts', 'e2e/**/*.spec.ts'],
  timeout: 60_000,
  use: { channel: 'chromium', viewport: { width: 1440, height: 900 } },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
  },
});
