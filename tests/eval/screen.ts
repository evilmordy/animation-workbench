import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { isolateScene } from '../../src/ai/agent/capture';
import { checkScenes, seekTimes, type Issue } from '../../src/ai/agent/check/index';
import { contentRatio, type Raster } from '../../src/ai/agent/check/pixels';
import { LAYOUT_SCAN_LIMIT, pickLayoutBoxes, type RawLayoutElement } from '../../src/ai/agent/layoutBoxes';
import { assembleExportHtml } from '../../src/features/export/exportHtml';
import type { Storyboard } from '../../src/shared/schema';
import { decodePng } from './png';
import { exportPasses, type ScreenFacts } from './summary';

/** 与 playwrightCapture 的 anime 预览同一套文件和 CSP。像素在本进程解码，不走 grab() 的整幅 RGBA。 */
const PREVIEW_CSP =
  "default-src 'none'; script-src http://awpreview.test 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";

const PREVIEW_FILES: Record<string, [string, string]> = {
  'http://awpreview.test/anime.html': ['dist-runtime/anime.html', 'text/html'],
  'http://awpreview.test/anime-runtime.js': ['dist-runtime/anime-runtime.js', 'text/javascript'],
};

const EMPTY_CONTENT = 0.003;
const STAGE = { width: 960, height: 540 };

interface Shot {
  tMs: number;
  raster: Raster;
  boxes: ReturnType<typeof pickLayoutBoxes>['boxes'];
  truncated: boolean;
}

async function openPreview(
  root: string,
): Promise<{ page: Page; close: () => Promise<void>; errors: string[] }> {
  for (const [rel] of Object.values(PREVIEW_FILES)) {
    if (!existsSync(join(root, rel))) throw new Error(`预览文件不存在：${rel}。先 pnpm build:runtime。`);
  }
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage({ viewport: STAGE, deviceScaleFactor: 1 });
  const errors: string[] = [];
  const push = (message: string) => {
    const text = message.trim();
    if (text && !errors.includes(text)) errors.push(text);
  };
  page.on('pageerror', (error) => push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') push(msg.text());
  });
  await page.route('**/*', (route) => {
    const url = route.request().url().split('?')[0] ?? '';
    const file = PREVIEW_FILES[url];
    if (!file) return route.abort();
    return route.fulfill({
      body: readFileSync(join(root, file[0])),
      contentType: file[1],
      headers: { 'Content-Security-Policy': PREVIEW_CSP },
    });
  });
  await page.goto('http://awpreview.test/anime.html');
  await page.waitForFunction(() => Boolean((globalThis as { __ready?: boolean }).__ready));
  return { page, close: () => browser.close(), errors };
}

async function runFilm(
  page: Page,
  storyboard: Storyboard,
): Promise<{
  duration: number;
  scenes: { id: string; start: number; end: number }[];
  errors: { sceneId?: string; message: string }[];
}> {
  return page.evaluate((sb) => {
    const win = globalThis as {
      __run?: (storyboard: unknown) => Promise<{
        duration: number;
        scenes: { id: string; start: number; end: number }[];
        errors: { sceneId?: string; message: string }[];
      }>;
    };
    if (!win.__run) throw new Error('预览页没有 __run');
    return win.__run(sb);
  }, storyboard);
}

async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate((time) => {
    (globalThis as { __seek?: (t: number) => void }).__seek?.(time);
  }, t);
  await page.waitForTimeout(200);
}

async function grab(page: Page): Promise<Shot> {
  const png = await page.locator('#stage').screenshot();
  const raster = decodePng(png);
  const elements = await page.evaluate((scanLimit: number): RawLayoutElement[] => {
    const stage = document.getElementById('stage');
    const origin = stage?.getBoundingClientRect();
    const found: RawLayoutElement[] = [];
    if (!stage || !origin) return found;
    const svgClipOf = (el: Element) => {
      const svg = (el as SVGElement).ownerSVGElement;
      if (!svg) return undefined;
      const overflow = getComputedStyle(svg);
      if (overflow.overflowX === 'visible' && overflow.overflowY === 'visible') return undefined;
      const view = svg.getBoundingClientRect();
      return { x: view.x - origin.x, y: view.y - origin.y, width: view.width, height: view.height };
    };
    for (const el of stage.querySelectorAll('*')) {
      if (found.length >= scanLimit) break;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const svgClip = svgClipOf(el);
      found.push({
        id: el.id,
        layer: el.id === 'canvas' || el.classList.contains('awb-layer'),
        visibility: cs.visibility,
        display: cs.display,
        opacity: Number(cs.opacity),
        width: rect.width,
        height: rect.height,
        x: rect.x - origin.x,
        y: rect.y - origin.y,
        text: (el.textContent ?? '').trim().slice(0, 80),
        childElementCount: el.childElementCount,
        awbRole: el.getAttribute('data-awb-role') || '',
        ...(svgClip ? { svgClip } : {}),
      });
    }
    return found;
  }, LAYOUT_SCAN_LIMIT);
  const picked = pickLayoutBoxes(elements);
  return { tMs: 0, raster, boxes: picked.boxes, truncated: picked.truncated };
}

function at(span: { start: number; end: number }, tMs: number): number {
  if (span.end <= span.start) return span.start;
  const last = Math.max(span.start, span.end - 1e-3);
  return Math.min(Math.max(span.start, span.start + tMs / 1000), last);
}

function shuffleIndexes(count: number, seed: string): number[] {
  const order = [...Array(count).keys()];
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  for (let i = order.length - 1; i > 0; i--) {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822519);
    const j = (hash >>> 0) % (i + 1);
    const swap = order[i]!;
    order[i] = order[j]!;
    order[j] = swap;
  }
  return order;
}

/** 布局、残留、同毫秒、后向、乱序、空屏、控制台、离线导出。口径走 checkScenes。 */
export async function screenStoryboard(sb: Storyboard, root = process.cwd()): Promise<ScreenFacts> {
  const runtimePath = join(root, 'dist-runtime/anime-runtime.js');
  const runtimeSource = existsSync(runtimePath) ? readFileSync(runtimePath, 'utf8') : '';
  const html = runtimeSource
    ? await assembleExportHtml(runtimeSource, sb, { slides: false, loop: false, codeScenes: true })
    : '';
  const exportOk = runtimeSource ? exportPasses(html, runtimeSource) : false;
  const preview = await openPreview(root);
  try {
    const full = await runFilm(preview.page, sb);
    for (const error of full.errors) {
      const line = error.sceneId ? `${error.sceneId}: ${error.message}` : error.message;
      if (!preview.errors.includes(line)) preview.errors.push(line);
    }
    const issues: Issue[] = [];
    let empty = 0;
    let sampled = 0;
    let layoutTruncated = false;
    for (const scene of sb.scenes) {
      if (scene.kind !== 'code' || !scene.code?.trim()) continue;
      const span = full.scenes.find((item) => item.id === scene.id);
      if (!span) throw new Error(`预览没有场 ${scene.id}`);
      const durationMs = Math.max(0, Math.round((span.end - span.start) * 1000));
      const times = seekTimes(durationMs);
      const before = preview.errors.length;
      const forward: Shot[] = [];
      for (const tMs of times) {
        await seek(preview.page, at(span, tMs));
        const shot = await grab(preview.page);
        forward.push({ ...shot, tMs });
      }
      await seek(preview.page, at(span, durationMs));
      const sequenceEnd = await grab(preview.page);
      const backward = new Array<Raster>(times.length);
      await seek(preview.page, at(span, durationMs));
      for (let i = times.length - 1; i >= 0; i--) {
        await seek(preview.page, at(span, times[i]!));
        backward[i] = (await grab(preview.page)).raster;
      }
      const shuffled = new Array<Raster>(times.length);
      for (const index of shuffleIndexes(times.length, scene.id)) {
        await seek(preview.page, at(span, times[index]!));
        shuffled[index] = (await grab(preview.page)).raster;
      }
      const mid = Math.round(durationMs / 2);
      await seek(preview.page, at(span, mid));
      const sameFirst = (await grab(preview.page)).raster;
      await seek(preview.page, at(span, mid));
      const sameSecond = (await grab(preview.page)).raster;
      const isolatedRun = await runFilm(preview.page, isolateScene(sb, scene.id));
      const isolatedSpan = isolatedRun.scenes.find((item) => item.id === scene.id);
      if (!isolatedSpan) throw new Error(`单场预览没有场 ${scene.id}`);
      await seek(
        preview.page,
        at(isolatedSpan, Math.max(0, Math.round((isolatedSpan.end - isolatedSpan.start) * 1000))),
      );
      const isolated = await grab(preview.page);
      for (const error of isolatedRun.errors) {
        const line = error.sceneId ? `${error.sceneId}: ${error.message}` : error.message;
        if (!preview.errors.includes(line)) preview.errors.push(line);
      }
      await runFilm(preview.page, sb);
      for (const shot of forward) {
        sampled += 1;
        if (contentRatio(shot.raster) < EMPTY_CONTENT) empty += 1;
      }
      sampled += 1;
      if (contentRatio(sequenceEnd.raster) < EMPTY_CONTENT) empty += 1;
      if (sequenceEnd.truncated) layoutTruncated = true;
      const consoleErrors = preview.errors.slice(before);
      issues.push(
        ...checkScenes([
          {
            id: scene.id,
            width: sequenceEnd.raster.width || STAGE.width,
            height: sequenceEnd.raster.height || STAGE.height,
            frames: [
              ...forward.map((shot) => ({ tMs: shot.tMs, raster: shot.raster })),
              {
                tMs: durationMs,
                raster: sequenceEnd.raster,
                boxes: sequenceEnd.boxes,
                ...(sequenceEnd.truncated ? { truncated: true } : {}),
              },
            ],
            sameMs: [{ tMs: mid, first: sameFirst, second: sameSecond }],
            seek: times.map((tMs, index) => ({
              tMs,
              forward: forward[index]!.raster,
              backward: backward[index]!,
              shuffled: shuffled[index]!,
            })),
            residual: { tMs: durationMs, sequence: sequenceEnd.raster, isolated: isolated.raster },
            consoleErrors,
          },
        ]),
      );
    }
    return {
      issues,
      blackRatio: sampled ? empty / sampled : 1,
      exportOk,
      layoutTruncated,
    };
  } finally {
    await preview.close();
  }
}
