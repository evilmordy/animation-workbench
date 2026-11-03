import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { openSample } from './helpers';

test.use({ baseURL: 'http://localhost:1420' });

test('M4：导出单文件 HTML，file:// 打开能播放且网络请求为 0', async ({ page, context }) => {
  await openSample(page);
  await page.keyboard.press('Control+e');
  await page.getByTestId('do-export').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 30_000 });
  const path = await page.getByTestId('export-done').locator('.path').innerText();
  const html = await page.evaluate((p) => (window as any).__awbMock.platform.readText(p), path);
  expect(html.length).toBeGreaterThan(1_000_000);
  expect(html).toContain("connect-src 'none'");
  // 运行时源码里会提到这个属性名；纯 dsl 导出不会把它写成 data-code-scenes="1"
  expect(html).not.toContain('data-code-scenes="1"');
  const file = join(tmpdir(), 'awb-export-test.html');
  writeFileSync(file, html);

  const viewer = await context.newPage();
  const requests: string[] = [];
  viewer.on('request', (r) => {
    if (!/^(file|data|blob):/.test(r.url())) requests.push(r.url());
  });
  const errors: string[] = [];
  viewer.on('pageerror', (e) => errors.push(e.message));
  await viewer.goto(`file://${file}`);
  await viewer.waitForFunction(() => (window as any).__awbExport, null, { timeout: 30_000 });
  const r = await viewer.evaluate(() => (window as any).__awbExport);
  expect(r.scenes.map((s: any) => s.end)).toEqual([4.5, 10, 17]);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  // Player 自带控件（含导出按钮）在导出文件里保留
  await expect(viewer.locator('[data-player-bar]')).toHaveCount(1);
});

test('M4：有错误时不能导出', async ({ page }) => {
  await openSample(page);
  await page.getByTestId('scene-card').first().click();
  const hold = page.getByLabel('末尾停留（秒）');
  await hold.fill('40');
  await hold.blur();
  await expect(page.getByTestId('issues-button')).toContainText('1 错误');
  await page.getByTestId('open-export').click();
  await expect(page.getByTestId('do-export')).toBeDisabled();
  await expect(page.getByTestId('export-dialog')).toContainText('修复后才能导出');
});
