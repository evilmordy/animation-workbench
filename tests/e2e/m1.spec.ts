import { expect, test } from '@playwright/test';
import { openSample } from './helpers';

test.use({ baseURL: 'http://localhost:1420' });

const seconds = (text: string) => {
  const [m, s] = text.split('/')[0]!.trim().split(':');
  return Number(m) * 60 + Number(s);
};

test('M1：打开示例后能播放、能拖进度', async ({ page }) => {
  const t0 = Date.now();
  await openSample(page);
  expect(Date.now() - t0).toBeLessThan(10_000); // UX-01
  const time = page.getByTestId('preview-time');

  await page.getByTestId('play-toggle').click();
  await expect.poll(async () => seconds(await time.innerText())).toBeGreaterThan(0.5);
  await page.getByTestId('play-toggle').click();

  const slider = page.getByRole('slider', { name: '播放进度' }).locator('..');
  const box = (await page.locator('.scrub').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect.poll(async () => seconds(await time.innerText())).toBeGreaterThan(7);
  expect(seconds(await time.innerText())).toBeLessThan(10);
  void slider;
});

test('M1：专家 JSON 编辑器修改后 500ms 内预览更新', async ({ page }) => {
  await openSample(page);
  await page.getByTestId('toggle-expert').click();
  // CodeMirror 只渲染可见行，用自带的搜索定位
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+f');
  await page.keyboard.type('"hold": 2');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  // 在页面内计时：从最后一次按键到预览回报新时长，避免 Playwright 轮询间隔带来的误差
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="preview-time"]')!;
    const w = window as any;
    new MutationObserver(() => {
      if (el.textContent?.includes('/ 0:20.0') && !w.__done) w.__done = performance.now();
    }).observe(el, { childList: true, characterData: true, subtree: true });
    document.addEventListener('keydown', () => (w.__start = performance.now()), true);
  });
  await page.keyboard.type('5,');
  await expect(page.getByTestId('preview-time')).toContainText('/ 0:20.0', { timeout: 5000 });
  const ms = await page.evaluate(() => (window as any).__done - (window as any).__start);
  console.log(`预览更新耗时 ${Math.round(ms)} ms`);
  expect(ms).toBeLessThan(500);
  await expect(page.getByTestId('expert-status')).toHaveText('已应用');

  // 撤销回到原来的时长
  await page.keyboard.press('Escape');
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('preview-time')).toContainText('/ 0:17.0');
});
