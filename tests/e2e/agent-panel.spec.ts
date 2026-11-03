import { expect, test, type Page } from '@playwright/test';
import { freshStart } from './helpers';

test.use({ baseURL: 'http://localhost:1420' });

async function enableAgent(page: Page) {
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
    saved.settings.push(['agentBudget', { maxTurns: 1, maxTokens: null }]);
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await page.getByTestId('new-project').click();
  await page.getByRole('tab', { name: 'AI' }).click();
  await expect(page.getByTestId('agent-intent')).toBeVisible();
  await expect(page.getByTestId('gen-outline')).toHaveText('生成整片');
}

test('默认引擎是旧大纲，设置里关掉 Agent 就回到大纲', async ({ page }) => {
  await freshStart(page);
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('generation-engine').getByRole('radio', { name: '旧大纲' })).toBeChecked();
  await expect(page.getByTestId('generation-engine').getByRole('radio', { name: 'Agent' })).not.toBeChecked();
  await page.keyboard.press('Escape');

  await page.getByTestId('new-project').click();
  await page.getByRole('tab', { name: 'AI' }).click();
  await expect(page.getByTestId('agent-intent')).toHaveCount(0);
  await expect(page.getByTestId('agent-panel')).toHaveCount(0);
  await expect(page.getByTestId('gen-outline')).toHaveText('1. 生成大纲');

  await page.getByTestId('open-settings').click();
  await page.getByTestId('code-scenes-flag').click();
  await page.getByTestId('generation-engine').getByText('Agent', { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('agent-intent')).toBeVisible();
  await expect(page.getByTestId('agent-budget')).toContainText('轮次 0/8');

  await page.getByTestId('open-settings').click();
  await page.getByTestId('generation-engine').getByText('旧大纲', { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('agent-intent')).toHaveCount(0);
  await expect(page.getByTestId('gen-outline')).toHaveText('1. 生成大纲');
});

test('预算超限会停', async ({ page }) => {
  await enableAgent(page);
  await expect(page.getByTestId('agent-budget')).toContainText('轮次 0/1');
  const turns = page.getByTestId('agent-max-turns').locator('input');
  await turns.fill('2');
  await expect(page.getByTestId('agent-budget')).toContainText('轮次 0/2');
  await turns.fill('1');
  await expect(page.getByTestId('agent-budget')).toContainText('轮次 0/1');

  await page.getByTestId('gen-outline').click();
  await expect(page.getByText('先写下整片需求')).toBeVisible();

  await page.getByTestId('agent-intent').locator('textarea').fill('画一个圆，讲清半径。这段需求要完整保留。');
  await page.getByTestId('gen-outline').click();
  await expect(page.getByTestId('agent-note')).toContainText('轮次 1/1', { timeout: 20_000 });
  await expect(page.getByTestId('agent-note')).toContainText('已停下');
  await expect(page.getByTestId('agent-log')).toContainText('写 plan');
  await expect(page.getByTestId('cancel-agent')).toHaveCount(0);
});

test('取消能中止 Agent', async ({ page }) => {
  await enableAgent(page);
  await page.getByTestId('agent-max-turns').locator('input').fill('8');
  await page.getByTestId('agent-intent').locator('textarea').fill('【测试：agent 等待取消】请讲勾股定理');
  await page.getByTestId('gen-outline').click();
  await expect(page.getByTestId('agent-log')).toContainText('写 plan');
  await expect(page.getByTestId('cancel-agent')).toBeVisible();
  await page.getByTestId('cancel-agent').click();
  await expect(page.getByTestId('agent-note')).toContainText('已取消');
  await expect(page.getByTestId('cancel-agent')).toHaveCount(0);
  await expect(page.getByTestId('agent-log')).not.toContainText('已写入场景');
});
