import { expect, test, type Page } from '@playwright/test';
import { freshStart, openSample } from './helpers';

test.use({ baseURL: 'http://localhost:1420' });
test.describe.configure({ mode: 'serial', timeout: 180_000 });

async function enablePrecise(page: Page) {
  await freshStart(page);
  await page.evaluate(() => {
    const key = 'awb-mock-fs';
    const saved = JSON.parse(localStorage.getItem(key) || '{"files":[],"dirs":["/"],"settings":[]}');
    saved.settings = (saved.settings ?? []).filter(
      (pair: [string, unknown]) =>
        pair[0] !== 'runtime' && pair[0] !== 'generationEngine' && pair[0] !== 'agentBudget',
    );
    saved.settings.push(['runtime', { codeScenes: true }]);
    saved.settings.push(['generationEngine', 'agentic']);
    saved.settings.push(['agentBudget', { maxTurns: 8, maxTokens: null }]);
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await page.getByTestId('new-project').click();
  await page.getByRole('tab', { name: 'AI' }).click();
  await expect(page.getByTestId('precise-edit')).toBeVisible();
  await expect(page.getByTestId('agent-budget')).toContainText('轮次 0/8');
}

async function addCodeScene(page: Page, code: string, hold?: string) {
  await page.getByTestId('insert-scene').click();
  await page.getByRole('tab', { name: '场景' }).click();
  await page.getByTestId('scene-kind').getByText('代码', { exact: true }).click();
  if (hold != null) {
    const input = page.getByTestId('scene-hold').locator('input');
    await input.fill(hold);
    await input.press('Tab');
  }
  await page.getByTestId('scene-code').locator('textarea').fill(code);
}

async function sceneCode(page: Page, index: number) {
  await page.getByRole('tab', { name: '场景' }).click();
  await page.getByTestId('scene-card').nth(index).click();
  return page.getByTestId('scene-code').locator('textarea').inputValue();
}

async function waitPreview(page: Page, total: string) {
  await expect(page.getByTestId('preview-time')).toContainText(`/ ${total}`, { timeout: 20_000 });
}

async function seekTo(page: Page, seconds: string) {
  await page.getByRole('slider', { name: '播放进度' }).fill(seconds);
}

async function dragRuler(page: Page, from: number, to: number) {
  const ruler = page.getByTestId('timeline-ruler');
  const box = await ruler.boundingBox();
  if (!box) throw new Error('没有标尺');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * from, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, y, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId('timeline-range')).toBeVisible();
}

async function clickMarked(page: Page, n: number) {
  const frame = page.frameLocator('[data-testid=preview-frame]');
  const target = frame.locator(`[data-awb-n="${n}"]`);
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  if (!box) throw new Error(`没有点到 n=${n}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('只改第三场标题，撤销一步后 seek 仍然有效', async ({ page }) => {
  await enablePrecise(page);
  await addCodeScene(page, "txt('甲场', 80, 80, 48);\nwait(1000);");
  await addCodeScene(page, "txt('乙场', 80, 80, 48);\nwait(1000);");
  await addCodeScene(page, "txt('旧标题', 80, 80, 64, '#ffffff');\nwait(1000);");
  await waitPreview(page, '0:06.0');
  await seekTo(page, '4.5');
  const frame = page.frameLocator('[data-testid=preview-frame]');
  await expect(frame.getByText('旧标题')).toBeVisible();

  await page.getByRole('tab', { name: 'AI' }).click();
  await page.getByTestId('precise-instruction').locator('textarea').fill('把第三场标题改成直角');
  await page.getByTestId('precise-run').click();
  const compare = page.getByTestId('edit-compare');
  await expect(compare).toContainText('改前', { timeout: 150_000 });
  await expect(compare).toContainText('改后');
  await expect(frame.getByText('直角')).toBeVisible({ timeout: 20_000 });

  expect(await sceneCode(page, 0)).toContain('甲场');
  expect(await sceneCode(page, 0)).not.toContain('直角');
  expect(await sceneCode(page, 1)).toContain('乙场');
  expect(await sceneCode(page, 2)).toContain('直角');
  expect(await sceneCode(page, 2)).not.toContain('旧标题');

  await page.getByTestId('undo').click();
  await expect(frame.getByText('旧标题')).toBeVisible({ timeout: 20_000 });
  expect(await sceneCode(page, 2)).toContain('旧标题');

  const time = page.getByTestId('preview-time');
  await page.getByRole('slider', { name: '播放进度' }).fill('1.2');
  await expect(time).toContainText('0:01.2');
  const paused = await time.innerText();
  await page.getByTestId('play-toggle').click();
  await expect(time).not.toHaveText(paused);
  await page.getByTestId('play-toggle').click();
});

test('点选叠在一起的标签并框选区间，挪开后重叠关闭且区间外只在附近变', async ({ page }) => {
  await enablePrecise(page);
  await addCodeScene(
    page,
    [
      "txt('甲乙丙丁戊', 200, 200, 64, '#ffffff');",
      "txt('甲乙丙丁戊', 220, 220, 64, '#ff862f');",
      'wait(1600);',
    ].join('\n'),
  );
  await waitPreview(page, '0:02.6');
  await page.getByRole('tab', { name: 'AI' }).click();
  await page.getByTestId('agent-check').click();
  await expect(page.getByTestId('agent-check-result')).toContainText('文字重叠', { timeout: 60_000 });

  await clickMarked(page, 2);
  await expect(page.getByTestId('precise-hit')).toContainText('n=2');
  await dragRuler(page, 0.35, 0.55);
  await expect(page.getByTestId('precise-range')).toContainText('区间');
  await page.getByTestId('precise-instruction').locator('textarea').fill('挪开');
  await page.getByTestId('precise-run').click();
  const log = page.getByTestId('agent-log');
  await expect(log).toContainText('改后', { timeout: 150_000 });
  await expect(log).toContainText('区间外');
  await expect(log).toContainText('局部');
  await expect(page.getByTestId('agent-note')).toContainText('已写入', { timeout: 30_000 });

  const result = page.getByTestId('agent-check-result');
  const previous = await result.innerText();
  await page.getByTestId('agent-check').click();
  await expect(result).not.toHaveText(previous, { timeout: 60_000 });
  await expect(result).not.toContainText('文字重叠');
  expect(await sceneCode(page, 0)).toContain('1100');
});

test('手改 hold 保留，base_hash 过期时先重读', async ({ page }) => {
  await enablePrecise(page);
  await addCodeScene(page, "txt('别动', 80, 80, 40);\nwait(800);");
  await addCodeScene(page, "const kept = 1;\ntxt('色块', 80, 80, 48, '#ffffff');\nwait(800);", '2.5');
  await waitPreview(page, '0:05.1');
  await seekTo(page, '2.5');
  await page.getByTestId('scene-card').nth(1).click();
  await expect(page.getByTestId('scene-hold').locator('input')).toHaveValue(/2\.5/);

  await page.getByRole('tab', { name: 'AI' }).click();
  await page.getByTestId('precise-instruction').locator('textarea').fill('把颜色改成蓝色');
  await page.getByTestId('precise-run').click();
  const log = page.getByTestId('agent-log');
  await expect(log).toContainText('#3b82f6', { timeout: 150_000 });
  const text = await log.innerText();
  const stale = text.indexOf('STALE');
  const read = text.indexOf('读场');
  const color = text.indexOf('#3b82f6');
  expect(stale).toBeGreaterThanOrEqual(0);
  expect(read).toBeGreaterThan(stale);
  expect(color).toBeGreaterThan(read);

  expect(await sceneCode(page, 1)).toContain('const kept = 1');
  expect(await sceneCode(page, 1)).toContain('#3b82f6');
  await expect(page.getByTestId('scene-hold').locator('input')).toHaveValue(/2\.5/);
  expect(await sceneCode(page, 0)).toContain('别动');
  expect(await sceneCode(page, 0)).not.toContain('#3b82f6');
});

test('锁定场不调用模型，代码字节不变', async ({ page }) => {
  await enablePrecise(page);
  const code = "txt('锁着', 80, 80, 48);\nwait(800);";
  await addCodeScene(page, code);
  await waitPreview(page, '0:01.8');
  await page.getByTestId('scene-card').click({ button: 'right' });
  await page.locator('[data-dropdown-option="true"]').getByText('锁定（AI 批量修改时跳过）').click();
  await page.getByRole('tab', { name: 'AI' }).click();
  await page.getByTestId('precise-instruction').locator('textarea').fill('把颜色改成蓝色');
  await page.getByTestId('precise-run').click();
  await expect(page.getByTestId('precise-blocked')).toHaveText('这一场锁着');
  await expect(page.getByTestId('agent-log')).not.toContainText('改一场');
  expect(await sceneCode(page, 0)).toBe(code);
});

test('跨场区间逐场确认，跳过的场不改', async ({ page }) => {
  await enablePrecise(page);
  const pending = "txt('待改', 80, 80, 48);\nwait(800);";
  await addCodeScene(page, pending);
  await addCodeScene(page, pending);
  await addCodeScene(page, pending);
  await waitPreview(page, '0:05.4');
  await dragRuler(page, 0.05, 0.95);
  await page.getByRole('tab', { name: 'AI' }).click();
  await page.getByTestId('precise-instruction').locator('textarea').fill('把待改换成已改');
  await page.getByTestId('precise-run').click();
  await expect(page.getByTestId('precise-queue')).toContainText('跨了 3 场');
  await expect(page.getByTestId('agent-log')).not.toContainText('改一场');

  await page.getByTestId('precise-confirm').click();
  await expect(page.getByTestId('edit-compare')).toContainText('改后', { timeout: 150_000 });
  expect(await sceneCode(page, 0)).toContain('已改');
  expect(await sceneCode(page, 1)).toContain('待改');
  expect(await sceneCode(page, 2)).toContain('待改');

  await page.getByRole('tab', { name: 'AI' }).click();
  await page.getByTestId('precise-skip').click();
  await expect(page.getByTestId('precise-queue')).toContainText('还剩');
  await page.getByTestId('precise-confirm').click();
  await expect(page.getByTestId('edit-compare')).toContainText('改后', { timeout: 150_000 });
  expect(await sceneCode(page, 1)).toContain('待改');
  expect(await sceneCode(page, 2)).toContain('已改');
});

test('指令要求变慢时，界面写明新旧时长和后面的场会后移', async ({ page }) => {
  await enablePrecise(page);
  await addCodeScene(page, "txt('慢', 80, 80, 48);\nwait(800);", '0');
  await waitPreview(page, '0:00.8');
  await page.getByRole('tab', { name: 'AI' }).click();
  await page.getByTestId('precise-instruction').locator('textarea').fill('这一段慢一点');
  await page.getByTestId('precise-run').click();
  await expect(page.getByTestId('edit-shift')).toContainText('本场时长', { timeout: 150_000 });
  await expect(page.getByTestId('edit-shift')).toContainText('后面的场会整体后移');
  expect(await sceneCode(page, 0)).toContain('wait(1600)');
});

test('勾股示例三场起止仍是 4.5 秒、5.5 秒、7 秒，总长 17 秒', async ({ page }) => {
  await openSample(page);
  const cards = page.getByTestId('scene-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('4.5s');
  await expect(cards.nth(1)).toContainText('5.5s');
  await expect(cards.nth(2)).toContainText('7.0s');
  await expect(page.getByTestId('preview-time')).toContainText('/ 0:17.0');
});
