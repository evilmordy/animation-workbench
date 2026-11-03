import { expect, test } from '@playwright/test';
import { freshStart, openSample } from './helpers';

test.use({ baseURL: 'http://localhost:1420' });

async function enableCodeScenes(page: import('@playwright/test').Page) {
  await freshStart(page);
  await expect(page.getByTestId('open-sample')).toBeVisible();
  await page.evaluate(() => {
    const key = 'awb-mock-fs';
    const saved = JSON.parse(localStorage.getItem(key) || '{"files":[],"dirs":["/"],"settings":[]}');
    saved.settings = (saved.settings ?? []).filter((pair: [string, unknown]) => pair[0] !== 'runtime');
    saved.settings.push(['runtime', { codeScenes: true }]);
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('code-scenes-flag')).toBeChecked();
  await page.keyboard.press('Escape');
}

test('flag 关闭时检查器没有 kind / code，元素和步骤仍在', async ({ page }) => {
  await openSample(page);
  await page.getByTestId('scene-card').first().click();
  await page.getByRole('tab', { name: '场景' }).click();
  await expect(page.getByTestId('scene-kind')).toHaveCount(0);
  await expect(page.getByTestId('scene-code')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '元素' })).toHaveCount(1);
  await expect(page.getByRole('tab', { name: '步骤' })).toHaveCount(1);
});

test('flag 打开时可以改 kind 和 code，走撤销；kind:code 隐藏元素和步骤', async ({ page }) => {
  await enableCodeScenes(page);
  await page.getByTestId('open-sample').click();
  await expect(page.getByTestId('preview-time')).toContainText('/ 0:17.0', { timeout: 30_000 });
  await page.getByTestId('scene-card').first().click();
  await page.getByRole('tab', { name: '场景' }).click();
  await page.getByTestId('scene-kind').getByText('代码', { exact: true }).click();
  await expect(page.getByRole('tab', { name: '元素' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '步骤' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '场景' })).toHaveCount(1);
  await expect(page.getByRole('tab', { name: '全局' })).toHaveCount(1);
  await page.getByTestId('scene-card').nth(1).click();
  await expect(page.getByRole('tab', { name: '元素' })).toHaveCount(1);
  await expect(page.getByRole('tab', { name: '步骤' })).toHaveCount(1);
  await page.getByTestId('scene-card').first().click();
  await expect(page.getByRole('tab', { name: '元素' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '步骤' })).toHaveCount(0);

  const code = page.getByTestId('scene-code').locator('textarea');
  await code.fill('const dot = new M.Dot({ radius: 0.2, color: "#ffffff" });');
  await expect(code).toHaveValue('const dot = new M.Dot({ radius: 0.2, color: "#ffffff" });');

  await page.locator('body').click({ position: { x: 8, y: 8 } });
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('scene-code').locator('textarea')).toHaveValue('');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('tab', { name: '元素' })).toHaveCount(1);
  await expect(page.getByRole('tab', { name: '步骤' })).toHaveCount(1);
  await page.getByRole('tab', { name: '场景' }).click();
  await expect(page.getByTestId('scene-kind').getByText('分镜（元素和步骤）')).toBeVisible();
});
