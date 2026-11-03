import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { assembleExportHtml } from '../../src/features/export/exportHtml';
import type { Storyboard } from '../../src/shared/schema';
import { legacyExportHtml } from '../fixtures/legacyExportHtml';
import pythagoras from '../fixtures/pythagoras.json' with { type: 'json' };
import { ZUGENG_MARKERS, zugeng } from '../fixtures/zugeng';
import { countNear } from './pixels';
import { serveRuntime } from './serve';

interface Tagged {
  tag: string;
  opacity: number;
}

test.use({ video: 'on' });
test.describe.configure({ timeout: 180_000 });

function visibleTags(list: Tagged[]): string[] {
  return list.filter((m) => m.tag && m.opacity > 0.15).map((m) => m.tag);
}

async function assertSceneFrame(page: Page, png: Buffer, index: number, tags: string[]) {
  const counts = await Promise.all(ZUGENG_MARKERS.map((s) => countNear(page, png, s.marker)));
  for (let i = 0; i < ZUGENG_MARKERS.length; i++) {
    const id = ZUGENG_MARKERS[i]!.id;
    if (i === index) {
      expect(counts[i], `${id} 色块`).toBeGreaterThan(80);
      expect(tags, id).toContain(id);
    } else {
      expect(counts[i], `不应残留 ${id} 色块`).toBeLessThan(20);
      expect(tags, `不应残留 ${id}`).not.toContain(id);
    }
  }
}

test('祖暅夹具：flag 打开后逐场中点无上一场对象', async ({ page }) => {
  const external = await serveRuntime(page);
  await page.goto('http://awpreview.test/code-harness.html');
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready);
  const result = await page.evaluate(
    (sb) =>
      (
        window as unknown as {
          __run: (
            storyboard: unknown,
            enable?: boolean,
          ) => Promise<{
            errors: { message: string }[];
            scenes: { id: string; start: number; end: number }[];
            duration: number;
          }>;
        }
      ).__run(sb, true),
    zugeng,
  );
  expect(result.errors).toEqual([]);
  expect(result.scenes.map((s: { id: string }) => s.id)).toEqual(ZUGENG_MARKERS.map((s) => s.id));
  mkdirSync('test-results', { recursive: true });
  await page.addStyleTag({ content: '[data-player-bar]{display:none!important}' });

  for (let i = 0; i < result.scenes.length; i++) {
    const span = result.scenes[i] as { id: string; start: number; end: number };
    const mid = (span.start + span.end) / 2;
    await page.evaluate((t) => (window as unknown as { __seek: (t: number) => void }).__seek(t), mid);
    await page.waitForTimeout(250);
    const png = await page.locator('#stage').screenshot({ path: `test-results/zugeng-${span.id}.png` });
    const tags = visibleTags(
      await page.evaluate(() => (window as unknown as { __objects: () => Tagged[] }).__objects()),
    );
    await assertSceneFrame(page, png, i, tags);
  }

  await page.evaluate(() => (window as unknown as { __seek: (t: number) => void }).__seek(0));
  await page.evaluate(() => (window as unknown as { __play: () => void }).__play());
  await page.waitForTimeout(result.duration * 1000 + 400);
  await page.evaluate(() => (window as unknown as { __pause: () => void }).__pause());
  expect(external).toEqual([]);
});

test('祖暅导出：flag 开能播，纯 dsl 与 S2a 模板逐字节一致', async ({ page }) => {
  const runtime = readFileSync('dist-runtime/runtime.js', 'utf8');
  const dsl = pythagoras as Storyboard;
  const opts = { slides: false, loop: false };
  const exportedDsl = await assembleExportHtml(runtime, dsl, { ...opts, codeScenes: true });
  expect(exportedDsl).toBe(await legacyExportHtml(runtime, dsl, opts));

  const html = await assembleExportHtml(runtime, zugeng, { ...opts, codeScenes: true });
  expect(html.replace(' data-code-scenes="1"', '')).toBe(await legacyExportHtml(runtime, zugeng, opts));
  const file = join(tmpdir(), 'awb-zugeng-export.html');
  writeFileSync(file, html);

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`file://${file}`);
  await page.waitForFunction(() => (window as unknown as { __awbExport?: unknown }).__awbExport, null, {
    timeout: 60_000,
  });
  const scenes = await page.evaluate(
    () =>
      (window as unknown as { __awbExport: { scenes: { id: string; start: number; end: number }[] } })
        .__awbExport.scenes,
  );
  expect(scenes.map((s) => s.id)).toEqual(ZUGENG_MARKERS.map((s) => s.id));
  mkdirSync('test-results', { recursive: true });
  await page.addStyleTag({ content: '[data-player-bar]{display:none!important}' });
  for (let i = 0; i < scenes.length; i++) {
    const span = scenes[i]!;
    await page.evaluate(
      (t) => (window as unknown as { __awbExport: { seek: (t: number) => void } }).__awbExport.seek(t),
      (span.start + span.end) / 2,
    );
    await page.waitForTimeout(250);
    const png = await page
      .locator('#stage')
      .screenshot({ path: `test-results/zugeng-export-${span.id}.png` });
    const tags = visibleTags(
      await page.evaluate(() =>
        (window as unknown as { __awbExport: { objects: () => Tagged[] } }).__awbExport.objects(),
      ),
    );
    await assertSceneFrame(page, png, i, tags);
  }
  expect(errors).toEqual([]);
});
