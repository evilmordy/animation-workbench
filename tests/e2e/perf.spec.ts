import { expect, test } from '@playwright/test';
import fixture from '../fixtures/pythagoras.json' with { type: 'json' };
import { freshStart } from './helpers';

test.use({ baseURL: 'http://localhost:1420' });

/** 20 个场景、每个场景 8 个动画左右（附录 A 的场景复制 7 份） */
function bigStoryboard() {
  const sb = structuredClone(fixture) as any;
  const scenes = [];
  for (let k = 0; scenes.length < 20; k++) {
    for (const s of fixture.scenes) {
      if (scenes.length === 20) break;
      scenes.push({
        ...structuredClone(s),
        id: `${s.id}_${k}`,
        enter: s.enter === 'keep' && scenes.length % 3 !== 0 ? 'keep' : 'fresh',
      });
    }
  }
  sb.scenes = scenes;
  return sb;
}

// 无头 Chromium 用软件渲染 WebGL，绝对值偏高且受并行测试影响，这里只防明显的性能退化。
// UX-03（p95 ≤ 500ms）的正式验收在真实 Tauri 窗口里做：AWB_SELFTEST=basic 自检。
test('UX-03 回归保护：20 个场景编辑→预览（无头软件渲染，p95 ≤ 3s）', async ({ page }) => {
  await freshStart(page);
  await page.waitForFunction(() => (window as any).__awbMock);
  await page.evaluate(async (sb) => {
    const m = (window as any).__awbMock;
    const dir = '/projects/big';
    await m.platform.mkdir(dir);
    await m.platform.writeTextAtomic(`${dir}/storyboard.json`, JSON.stringify(sb));
    await m.platform.writeTextAtomic(
      `${dir}/project.json`,
      JSON.stringify({ schemaVersion: 1, name: 'big', createdAt: new Date().toISOString() }),
    );
    m.dialogs.nextDirectory = dir;
  }, bigStoryboard());
  await page.getByTestId('open-project').click();
  await expect(page.getByTestId('scene-card')).toHaveCount(20);
  await expect(page.getByTestId('issues-button')).toContainText('0 错误');
  const time = page.getByTestId('preview-time');
  await expect(time).not.toContainText('/ 0:00.0', { timeout: 30_000 });

  await page.getByTestId('scene-card').nth(19).click();
  const hold = page.getByLabel('末尾停留（秒）');
  const samples: number[] = [];
  for (let i = 1; i <= 10; i++) {
    const before = await time.innerText();
    await page.evaluate((prev) => {
      const el = document.querySelector('[data-testid="preview-time"]')!;
      const w = window as any;
      w.__done = 0;
      w.__start = performance.now();
      const obs = new MutationObserver(() => {
        const total = el.textContent!.split('/')[1];
        if (total !== prev.split('/')[1] && !w.__done) {
          w.__done = performance.now();
          obs.disconnect();
        }
      });
      obs.observe(el, { childList: true, characterData: true, subtree: true });
    }, before);
    await hold.fill(String(2 + i * 0.5));
    await page.waitForFunction(() => (window as any).__done > 0, null, { timeout: 5000 });
    samples.push(await page.evaluate(() => (window as any).__done - (window as any).__start));
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
  console.log(`UX-03 编辑→预览更新（ms）：${samples.map(Math.round).join(', ')}；p95 = ${Math.round(p95)}`);
  expect(p95).toBeLessThanOrEqual(3000);
});
