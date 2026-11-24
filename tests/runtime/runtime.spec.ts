import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/pythagoras.json' with { type: 'json' };
import { serveRuntime } from './serve';

const msgs = (page: Page) => page.evaluate(() => (window as any).__msgs as any[]);
const waitFor = (page: Page, type: string) =>
  expect.poll(async () => (await msgs(page)).find((m) => m.type === type), { timeout: 30_000 }).toBeTruthy();

test('运行时加载附录 A：场景起止时间正确、无错误、无外联', async ({ page }) => {
  const external = await serveRuntime(page);
  await page.goto('http://host.test/harness.html');
  await waitFor(page, 'ready');
  await page.evaluate((sb) => (window as any).send({ type: 'load', storyboard: sb }), fixture);
  await waitFor(page, 'loaded');

  const all = await msgs(page);
  const loaded = all.find((m) => m.type === 'loaded');
  expect(loaded.scenes.map((s: any) => s.id)).toEqual(['s_tri001', 's_sq0002', 's_eq0003']);
  expect(loaded.scenes.map((s: any) => [s.start, s.end])).toEqual([
    [0, 4.5],
    [4.5, 10],
    [10, 17],
  ]);
  expect(loaded.duration).toBeCloseTo(17, 5);
  expect(all.filter((m) => m.type === 'error' || m.type === 'log')).toEqual([]);

  await page.evaluate(() => (window as any).send({ type: 'seek', t: 12 }));
  await expect
    .poll(async () => (await msgs(page)).filter((m) => m.type === 'time').at(-1)?.t)
    .toBeCloseTo(12, 3);
  await page.evaluate(() => (window as any).send({ type: 'seek', t: 16.9 }));
  await page.waitForTimeout(300);
  await page.locator('#preview').screenshot({ path: 'test-results/runtime-pythagoras-end.png' });
  const ready = all.find((m) => m.type === 'ready');
  expect(ready.runtimeVersion).toBeTruthy();
  expect(ready).not.toHaveProperty('manimWebVersion');
  expect(external).toEqual([]);
});

test('结构错误会以 error 消息上报', async ({ page }) => {
  await serveRuntime(page);
  await page.goto('http://host.test/harness.html');
  await waitFor(page, 'ready');
  await page.evaluate(() => (window as any).send({ type: 'load', storyboard: { schemaVersion: 9 } }));
  await waitFor(page, 'error');
});
