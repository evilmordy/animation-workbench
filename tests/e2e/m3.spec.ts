import { expect, test, type Page } from '@playwright/test';
import { freshStart } from './helpers';

test.use({ baseURL: 'http://localhost:1420' });

const seconds = async (page: Page) => {
  const text = await page.getByTestId('preview-time').innerText();
  const [m, s] = text.split('/')[1]!.trim().split(':');
  return Number(m) * 60 + Number(s);
};

async function generate(page: Page) {
  await freshStart(page);
  await page.getByTestId('new-project').click();
  await page.getByRole('tab', { name: 'AI' }).click();
  await page
    .getByTestId('source-text')
    .locator('textarea')
    .fill('【测试：需要修复】勾股定理：直角三角形两直角边的平方和等于斜边的平方。');
  await page.getByTestId('gen-outline').click();
  await expect(page.getByTestId('outline').locator('li')).toHaveCount(3);
  await page.getByTestId('gen-scenes').click();
  await expect(page.getByTestId('jobs').getByText('完成')).toHaveCount(3, { timeout: 20_000 });
  await expect(page.getByTestId('scene-card')).toHaveCount(3);
  await expect(page.getByTestId('issues-button')).toContainText('0 错误');
  // 等最后一个场景写入后的预览重建完成，时长不再变化
  await expect.poll(() => seconds(page)).toBeGreaterThan(10);
  let prev = -1;
  await expect
    .poll(
      async () => {
        const now = await seconds(page);
        const stable = now === prev;
        prev = now;
        return stable;
      },
      { intervals: [600] },
    )
    .toBe(true);
}

test('M3：文本 → 大纲 → 场景（含自动修复）', async ({ page }) => {
  await generate(page);
  await expect.poll(() => seconds(page)).toBeGreaterThan(10);
  // 自动修复写进了日志
  const log = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('awb-mock-fs') ?? '{}');
    return (fs.files as [string, string][]).find(([k]) => k.endsWith('ai-log.jsonl'))?.[1] ?? '';
  });
  const entries = log
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  expect(entries.some((e) => e.task === 'outline' && e.attempts === 2 && e.ok)).toBe(true);
  expect(entries.every((e) => e.messages === undefined)).toBe(true); // 默认只记元数据
});

test('M3：自然语言修改 → 拒绝 / 接受 → 撤销', async ({ page }) => {
  await generate(page);
  const before = await seconds(page);
  await page.getByTestId('scene-card').first().click();

  const instr = page.getByTestId('edit-instruction').locator('textarea');
  await instr.fill('把图形改成蓝色，时长延长 2 秒');
  await page.getByTestId('send-edit').click();
  await expect(page.getByTestId('pending')).toBeVisible();
  await expect(page.getByTestId('scene-card').first()).toContainText('待确认');
  await expect.poll(() => seconds(page)).toBeCloseTo(before + 2, 5); // 预览显示修改后的版本
  await page.getByTestId('reject-edit').click();
  await expect(page.getByTestId('pending')).toBeHidden();
  await expect.poll(() => seconds(page)).toBeCloseTo(before, 5);

  await instr.fill('把图形改成蓝色，时长延长 2 秒');
  await instr.press('Control+Enter');
  await page.getByTestId('accept-edit').click();
  await expect.poll(() => seconds(page)).toBeCloseTo(before + 2, 5);
  await page.getByTestId('undo').click();
  await expect.poll(() => seconds(page)).toBeCloseTo(before, 5);
});

test('M3：手动模式（无 Key）', async ({ page }) => {
  await generate(page);
  await page.getByTestId('open-settings').first().click();
  await page.getByTestId('ai-mode').getByText('手动模式').click();
  await page.keyboard.press('Escape');

  await page.getByTestId('scene-card').nth(1).click();
  await page.getByTestId('edit-instruction').locator('textarea').fill('删除这个场景');
  await page.getByTestId('send-edit').click();
  const prompt = page.getByRole('textbox', { name: '提示词' });
  await expect(prompt).toBeVisible();
  const id = /只修改场景 (\S+)（/.exec(await prompt.inputValue())![1];

  // 先粘贴不合格的回答 → 自动生成修复提示词
  await page.getByTestId('manual-answer').locator('textarea').fill('好的，我删掉了');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByText('自动修复第 1 轮')).toBeVisible();
  await page
    .getByTestId('manual-answer')
    .locator('textarea')
    .fill(`\`\`\`json\n{"ops":[{"op":"deleteScene","id":"${id}"}]}\n\`\`\``);
  await page.getByTestId('manual-submit').click();
  await page.getByTestId('accept-edit').click();
  await expect(page.getByTestId('scene-card')).toHaveCount(2);
});
