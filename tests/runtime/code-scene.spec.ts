import { expect, test } from '@playwright/test';
import fixture from '../fixtures/code-circle.json' with { type: 'json' };
import { serveRuntime } from './serve';

test('flag 默认关闭时 kind:code 仍被跳过，不执行 code', async ({ page }) => {
  const external = await serveRuntime(page);
  await page.goto('http://awpreview.test/code-harness.html');
  await page.waitForFunction(() => (window as any).__ready);
  const result = await page.evaluate((sb) => (window as any).__run(sb), fixture);
  expect(result.errors).toEqual([{ sceneId: 's_code', message: '代码场景暂不支持，已跳过' }]);
  expect(result.duration).toBeCloseTo(0.5, 5);
  expect(external).toEqual([]);
});

test('flag 打开时 kind:code 能构建并播放 Create Circle', async ({ page }) => {
  const external = await serveRuntime(page);
  await page.goto('http://awpreview.test/code-harness.html');
  await page.waitForFunction(() => (window as any).__ready);
  const result = await page.evaluate((sb) => (window as any).__run(sb, true), fixture);
  expect(result.errors).toEqual([]);
  // Create 1s + hold 0.5。单场景没有 nextSlide，时长以 timeline 为准。
  expect(result.duration).toBeCloseTo(1.5, 5);
  expect(result.scenes[0].id).toBe('s_code');
  await page.evaluate(() => (window as any).__seek(0.5));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/runtime-code-circle.png' });
  expect(external).toEqual([]);
});
