import { expect, test, type Page } from '@playwright/test';
import type { Storyboard } from '../../src/shared/schema';
import { translateStoryboard } from '../../src/runtime/anime/dsl';
import fixture from '../fixtures/pythagoras.json' with { type: 'json' };
import { serveRuntime } from './serve';

const pythagoras = fixture as Storyboard;

test.use({ viewport: { width: 960, height: 540 } });

async function diffShots(page: Page, left: Buffer, right: Buffer): Promise<number> {
  return page.evaluate(
    async ({ a, b }) => {
      const load = async (bytes: number[]) => {
        const blob = new Blob([new Uint8Array(bytes)]);
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return new Uint8ClampedArray();
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const first = await load(a);
      const second = await load(b);
      let count = 0;
      const length = Math.min(first.length, second.length);
      for (let i = 0; i < length; i += 4) {
        const dr = Math.abs((first[i] ?? 0) - (second[i] ?? 0));
        const dg = Math.abs((first[i + 1] ?? 0) - (second[i + 1] ?? 0));
        const db = Math.abs((first[i + 2] ?? 0) - (second[i + 2] ?? 0));
        if (dr > 8 || dg > 8 || db > 8) count += 1;
      }
      return count;
    },
    { a: [...left], b: [...right] },
  );
}

test('勾股转译版可播：起止、后向/乱序 seek、换场残留为 0、无控制台错误', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const external = await serveRuntime(page);
  await page.goto('http://awpreview.test/anime.html');
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready);

  const run = await page.evaluate(async (storyboard) => {
    const win = window as unknown as {
      __run?: (sb: unknown) => Promise<{
        errors: { message: string }[];
        duration: number;
        scenes: { id: string; start: number; end: number }[];
      }>;
      __seek?: (t: number) => void;
    };
    return win.__run!(storyboard);
  }, pythagoras);

  expect(run.errors).toEqual([]);
  expect(run.scenes.map((item) => [item.start, item.end])).toEqual([
    [0, 4.5],
    [4.5, 10],
    [10, 17],
  ]);
  expect(run.duration).toBe(17);
  expect(external).toEqual([]);

  const seek = (t: number) =>
    page.evaluate((time) => (window as unknown as { __seek?: (n: number) => void }).__seek!(time), t);
  const shot = () => page.locator('#stage').screenshot();

  await seek(12);
  const at12 = await shot();
  await seek(2);
  await seek(12);
  expect(await diffShots(page, at12, await shot())).toBe(0);

  const times = [2, 8, 14];
  const ordered = new Map<number, Buffer>();
  for (const time of times) {
    await seek(time);
    ordered.set(time, await shot());
  }
  for (const time of [14, 2, 8]) {
    await seek(time);
    expect(await diffShots(page, ordered.get(time)!, await shot())).toBe(0);
  }

  // 三场都在内容结束后的停顿里取帧，再和同一场转译代码单独播放对比。
  const translated = translateStoryboard(pythagoras);
  const settled: { local: number; png: Buffer }[] = [];
  for (let i = 0; i < run.scenes.length; i++) {
    const span = run.scenes[i]!;
    const local = span.end - span.start - pythagoras.scenes[i]!.hold + 0.2;
    await seek(span.start + local);
    settled.push({ local, png: await shot() });
  }
  for (let i = 0; i < settled.length; i++) {
    const scene = pythagoras.scenes[i]!;
    const isolated: Storyboard = {
      ...pythagoras,
      scenes: [
        { ...scene, kind: 'code', code: translated[i]?.code ?? '', elements: [], steps: [], enter: 'fresh' },
      ],
    };
    await page.evaluate(async (storyboard) => {
      const win = window as unknown as { __run?: (sb: unknown) => Promise<unknown> };
      await win.__run!(storyboard);
    }, isolated);
    await seek(settled[i]!.local);
    expect(await diffShots(page, settled[i]!.png, await shot())).toBe(0);
  }
  expect(errors).toEqual([]);
});

test('9:16 和 1:1 舞台尺寸', async ({ page }) => {
  const external = await serveRuntime(page);
  await page.goto('http://awpreview.test/anime.html');
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready);
  const board = (aspect: '9:16' | '1:1'): Storyboard => ({
    schemaVersion: 1,
    meta: { title: aspect, mode: '2d', aspect, background: '#000000', stylePreset: '3b1b' },
    scenes: [
      {
        id: 's',
        title: 's',
        description: '',
        kind: 'dsl',
        enter: 'fresh',
        hold: 0.2,
        elements: [{ id: 'd', type: 'Dot', props: {} }],
        steps: [{ id: 'p', kind: 'play', anims: [{ type: 'FadeIn', target: 'd' }], duration: 0.3 }],
      },
    ],
  });
  for (const [aspect, width, height] of [
    ['9:16', '1080', '1920'],
    ['1:1', '1080', '1080'],
  ] as const) {
    const run = await page.evaluate(async (storyboard) => {
      const win = window as unknown as {
        __run?: (sb: unknown) => Promise<{ errors: { message: string }[] }>;
      };
      const result = await win.__run!(storyboard);
      const canvas = document.querySelector('#canvas') as HTMLElement;
      return {
        errors: result.errors,
        w: canvas?.dataset.stageWidth,
        h: canvas?.dataset.stageHeight,
      };
    }, board(aspect));
    expect(run.errors).toEqual([]);
    expect(run.w).toBe(width);
    expect(run.h).toBe(height);
  }
  expect(external).toEqual([]);
});
