import { expect, test } from '@playwright/test';
import { freshStart, openSample } from './helpers';

test.use({ baseURL: 'http://localhost:1420' });

test('M2：不写 JSON、不用 AI，做出 3 个场景的动画', async ({ page }) => {
  await freshStart(page);
  await page.getByTestId('new-project').click();
  const cards = page.getByTestId('scene-card');
  for (let i = 0; i < 3; i++) await page.getByTestId('insert-scene').click();
  await expect(cards).toHaveCount(3);

  for (let i = 0; i < 3; i++) {
    await cards.nth(i).click();
    await page.getByRole('tab', { name: '元素' }).click();
    await page.getByTestId('add-element').click();
    await page.getByRole('tab', { name: '步骤' }).click();
    await page.getByTestId('add-play').click();
  }
  // 场景 1：1 动画 + 1 停留；场景 2、3：0.5 转场 + 1 + 1
  await expect(page.getByTestId('preview-time')).toContainText('/ 0:07.0');
  await expect(page.getByTestId('issues-button')).toContainText('0 错误');

  // 场景标题
  await cards.nth(0).click();
  await page.getByRole('tab', { name: '场景' }).click();
  await page.getByTestId('scene-form').getByRole('textbox').first().fill('开场');
  await expect(cards.nth(0)).toContainText('开场');

  // 只用键盘：Alt+→ 把选中的场景往后移，] 加长 0.5s
  await cards.nth(0).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(cards.nth(1)).toContainText('开场');
  await cards.nth(1).focus();
  await page.keyboard.press(']');
  await expect(page.getByTestId('preview-time')).toContainText('/ 0:07.5');

  // 撤销两次回到原顺序和时长
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(cards.nth(0)).toContainText('开场');
  await expect(page.getByTestId('preview-time')).toContainText('/ 0:07.0');
  await page.screenshot({ path: 'test-results/m2-workbench.png' });
});

test('M2：示例项目里编辑步骤时长和风格预设', async ({ page }) => {
  await openSample(page);
  const cards = page.getByTestId('scene-card');
  await cards.nth(2).click();
  await page.getByRole('tab', { name: '步骤' }).click();
  const dur = page.getByTestId('steps-form').getByLabel('时长（秒）').first();
  await dur.fill('3');
  await dur.blur();
  await expect(page.getByTestId('preview-time')).toContainText('/ 0:19.0');

  await page.getByRole('tab', { name: '全局' }).click();
  await page.getByTestId('style-preset').getByText('简洁（浅色）').click();
  await expect(page.getByTestId('issues-button')).toContainText('0 错误');
  await page.getByTestId('preview-time').click();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/m2-clean-preset.png' });
});
