import { expect, test } from '@playwright/test';
import fixture from '../fixtures/code-circle.json' with { type: 'json' };
import { serveRuntime } from './serve';

test('manim 代码场报错不崩', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  const external = await serveRuntime(page);
  await page.goto('http://awpreview.test/code-harness.html');
  await page.waitForFunction(() => (window as any).__ready);
  const result = await page.evaluate((sb) => (window as any).__run(sb), fixture);
  expect(pageErrors).toEqual([]);
  expect(result.errors).toEqual([{ sceneId: 's_code', message: '代码场不归 manim 运行时播' }]);
  expect(result.duration).toBeCloseTo(0.5, 5);
  expect(await page.evaluate(() => (window as any).__objects())).toEqual([]);
  await page.evaluate(() => (window as any).__seek(0.2));
  expect(external).toEqual([]);
});
