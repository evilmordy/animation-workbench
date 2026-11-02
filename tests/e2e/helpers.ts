import { expect, type Page } from '@playwright/test';

/** 清空浏览器模式下的 mock 文件系统，从欢迎页开始 */
export async function freshStart(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

export async function openSample(page: Page) {
  await freshStart(page);
  await page.getByTestId('open-sample').click();
  await expect(page.getByTestId('preview-time')).toContainText('/ 0:17.0', { timeout: 30_000 });
}
