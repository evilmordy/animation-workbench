import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { freshStart, openSample } from './helpers';

test.use({ baseURL: 'http://localhost:1420' });

async function scan(page: Page, name: string) {
  const r = await new AxeBuilder({ page })
    // 预览 iframe 是沙箱里的画布，不在主界面可访问性范围内
    .exclude('iframe')
    .analyze();
  const bad = r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  for (const v of bad)
    console.log(
      `[${name}] ${v.impact} ${v.id}: ${v.help}\n  ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join('\n  ')}`,
    );
  expect(bad.map((v) => v.id)).toEqual([]);
}

test('UX-08：欢迎页没有 critical/serious 问题', async ({ page }) => {
  await freshStart(page);
  await scan(page, '欢迎页');
});

test('UX-08：工作台（各检查器页）没有 critical/serious 问题', async ({ page }) => {
  await openSample(page);
  await page.getByTestId('scene-card').first().click();
  await scan(page, '场景');
  for (const tab of ['元素', '步骤', '全局']) {
    await page.getByRole('tab', { name: tab }).click();
    if (tab === '元素') await page.getByRole('option').first().click();
    await scan(page, tab);
  }
  await page.getByRole('tab', { name: 'AI' }).click();
  await scan(page, 'AI 面板');
  await page.getByRole('tab', { name: '素材' }).click();
  await scan(page, '素材');
});
