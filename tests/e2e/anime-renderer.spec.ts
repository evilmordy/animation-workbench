import { expect, test } from '@playwright/test';
import { freshStart, openSample } from './helpers';

test.use({ baseURL: 'http://localhost:1420' });

test('默认引擎仍是旧大纲，勾股预览仍走原来的页', async ({ page }) => {
  await freshStart(page);
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('generation-engine').getByText('旧大纲')).toBeVisible();
  await expect(page.getByTestId('code-renderer')).toHaveCount(0);
  await expect(page.getByTestId('code-scenes-flag')).toBeVisible();
  await page.keyboard.press('Escape');

  await openSample(page);
  const src = await page.getByTestId('preview-frame').getAttribute('src');
  expect(src ?? '').toContain('index.html');
  expect(src ?? '').not.toContain('anime.html');
});
