import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { openSample } from './helpers';

test.use({ baseURL: 'http://localhost:1420' });

test('旧 dsl 项目打开后改坐标，导出 HTML 仍可播放', async ({ page, context }) => {
  await openSample(page);
  await page.getByTestId('scene-card').first().click();
  await page.getByRole('tab', { name: '元素' }).click();
  await page.getByRole('option', { name: /tri/ }).click();
  const x = page.getByRole('textbox', { name: '顶点 1 x' });
  await x.fill('-0.2');
  await x.blur();
  await expect(x).toHaveValue('-0.2');
  await expect(page.getByTestId('issues-button')).toContainText('0 错误');

  await page.keyboard.press('Control+e');
  await page.getByTestId('do-export').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 30_000 });
  const path = await page.getByTestId('export-done').locator('.path').innerText();
  const html = await page.evaluate((p) => (window as any).__awbMock.platform.readText(p), path);
  expect(html).toContain('-0.2');
  expect(html).toContain("connect-src 'none'");
  expect(html).not.toContain('data-code-scenes="1"');

  const file = join(tmpdir(), 'awb-dsl-coord-export.html');
  writeFileSync(file, html);
  const viewer = await context.newPage();
  const errors: string[] = [];
  viewer.on('pageerror', (e) => errors.push(e.message));
  await viewer.goto(`file://${file}`);
  await viewer.waitForFunction(() => (window as any).__awbExport, null, { timeout: 30_000 });
  const result = await viewer.evaluate(() => (window as any).__awbExport);
  expect(result.scenes.map((s: { end: number }) => s.end)).toEqual([4.5, 10, 17]);
  expect(errors).toEqual([]);
});
