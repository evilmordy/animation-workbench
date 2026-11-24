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

test('没尺寸时三种宽高比的舞台比例正确', async ({ page }) => {
  await serveRuntime(page);
  await page.goto('http://awpreview.test/anime.html');
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready);
  const ratios = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 } as const;
  for (const aspect of ['16:9', '9:16', '1:1'] as const) {
    const box = await page.evaluate(async (name) => {
      const stage = document.getElementById('stage') as HTMLElement;
      stage.style.width = '0px';
      stage.style.height = '0px';
      const storyboard = {
        schemaVersion: 1,
        meta: { title: name, mode: '2d', aspect: name, background: '#000000', stylePreset: '3b1b' },
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
      };
      const win = window as unknown as {
        __run?: (sb: unknown) => Promise<{ errors: { message: string }[] }>;
      };
      const result = await win.__run!(storyboard);
      const rect = stage.getBoundingClientRect();
      return { errors: result.errors, w: rect.width, h: rect.height };
    }, aspect);
    expect(box.errors).toEqual([]);
    expect(box.w).toBeGreaterThan(2);
    expect(box.h).toBeGreaterThan(2);
    expect(box.w / box.h).toBeCloseTo(ratios[aspect], 2);
  }
});

test.describe('勾股几何', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('斜边上的正方形贴在外侧，a²/b²/c² 墨迹盒与 manim 差不超过 15%', async ({ page }) => {
    await serveRuntime(page);
    await page.goto('http://awpreview.test/anime.html');
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready);
    const run = await page.evaluate(async (storyboard) => {
      const win = window as unknown as {
        __run?: (sb: unknown) => Promise<{ errors: { message: string }[] }>;
      };
      return win.__run!(storyboard);
    }, pythagoras);
    expect(run.errors).toEqual([]);
    const seek = (t: number) =>
      page.evaluate((time) => (window as unknown as { __seek?: (n: number) => void }).__seek!(time), t);

    await seek(9.5);
    const square = await page.evaluate(() => {
      const layer = [...document.querySelectorAll('.awb-layer')].find(
        (el) => (el as HTMLElement).style.visibility !== 'hidden',
      );
      const rect = layer?.querySelector('[data-awb-id="sc"] rect') as SVGRectElement | null;
      const svg = rect?.ownerSVGElement ?? null;
      const canvas = document.getElementById('canvas')?.getBoundingClientRect();
      if (!rect || !svg || !canvas || canvas.width < 2) return null;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const x = Number(rect.getAttribute('x'));
      const y = Number(rect.getAttribute('y'));
      const w = Number(rect.getAttribute('width'));
      const h = Number(rect.getAttribute('height'));
      const toStage = (sx: number, sy: number) => ({
        x: ((sx - canvas.left) / canvas.width) * 1920,
        y: ((sy - canvas.top) / canvas.height) * 1080,
      });
      const corner = (px: number, py: number) => {
        const p = svg.createSVGPoint();
        p.x = px;
        p.y = py;
        const o = p.matrixTransform(ctm);
        return toStage(o.x, o.y);
      };
      const actual = [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)];
      const angle = (-36.87 * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const cx = 0.75;
      const cy = 1.25;
      const half = 1.25;
      const expected = [
        [-half, -half],
        [half, -half],
        [half, half],
        [-half, half],
      ].map(([dx, dy]) => {
        const mx = cx + (dx ?? 0) * cos - (dy ?? 0) * sin;
        const my = cy + (dx ?? 0) * sin + (dy ?? 0) * cos;
        return { x: 960 + mx * 135, y: 540 - my * 135, mx, my };
      });
      const center = actual.reduce((acc, p) => ({ x: acc.x + p.x / 4, y: acc.y + p.y / 4 }), { x: 0, y: 0 });
      const mx = (center.x - 960) / 135;
      const my = (540 - center.y) / 135;
      const cross = (px: number, py: number) => -2 * (py + 0.5) - 1.5 * (px - 1);
      return { actual, expected, mx, my, right: cross(-1, -0.5), center: cross(mx, my) };
    });
    expect(square).not.toBeNull();
    if (!square) return;
    expect(Math.sign(square.center)).not.toBe(0);
    expect(Math.sign(square.center)).not.toBe(Math.sign(square.right));
    for (const point of square.expected) {
      const nearest = Math.min(
        ...square.actual.map((item) => Math.hypot(item.x - point.x, item.y - point.y)),
      );
      expect(nearest).toBeLessThanOrEqual(2);
    }

    // manim 落定帧（t=9.5）上 a²/b²/c² 的可见墨迹盒。RGB 各通道 > 170。
    const manimInk: Record<string, { x: number; y: number; w: number; h: number }> = {
      ta: { x: 696, y: 476, w: 56, h: 60 },
      tb: { x: 935, y: 712, w: 50, h: 61 },
      tc: { x: 1036, y: 341, w: 50, h: 60 },
    };
    await seek(9.5);
    for (const [id, expectBox] of Object.entries(manimInk)) {
      const rect = await page.evaluate((label) => {
        const layer = [...document.querySelectorAll('.awb-layer')].find(
          (el) => (el as HTMLElement).style.visibility !== 'hidden',
        );
        const node = layer?.querySelector(`[data-awb-id="${label}"]`) as HTMLElement | null;
        const box = node?.getBoundingClientRect();
        const stage = document.getElementById('stage')?.getBoundingClientRect();
        return {
          x: box?.x ?? 0,
          y: box?.y ?? 0,
          w: box?.width ?? 0,
          h: box?.height ?? 0,
          clip: node?.style.clipPath ?? '',
          stageX: stage?.x ?? 0,
          stageY: stage?.y ?? 0,
          stageW: stage?.width ?? 1920,
          stageH: stage?.height ?? 1080,
        };
      }, id);
      expect(rect.w, id).toBeGreaterThan(4);
      expect(rect.clip, id).toBe('none');
      const pad = 16;
      const clip = {
        x: Math.max(0, rect.x - pad),
        y: Math.max(0, rect.y - pad),
        width: rect.w + pad * 2,
        height: rect.h + pad * 2,
      };
      const shot = await page.screenshot({ clip });
      const ink = await page.evaluate(
        async (bytes) => {
          const blob = new Blob([new Uint8Array(bytes)]);
          const bmp = await createImageBitmap(blob);
          const canvas = document.createElement('canvas');
          canvas.width = bmp.width;
          canvas.height = bmp.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return { x: 0, y: 0, w: 0, h: 0, edge: true };
          ctx.drawImage(bmp, 0, 0);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const width = canvas.width;
          const height = canvas.height;
          let minX = width;
          let minY = height;
          let maxX = -1;
          let maxY = -1;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const i = (y * width + x) * 4;
              if ((data[i] ?? 0) <= 170 || (data[i + 1] ?? 0) <= 170 || (data[i + 2] ?? 0) <= 170) continue;
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
          return {
            x: maxX < 0 ? 0 : minX,
            y: maxY < 0 ? 0 : minY,
            w: maxX < 0 ? 0 : maxX - minX + 1,
            h: maxY < 0 ? 0 : maxY - minY + 1,
            edge: minX <= 1 || minY <= 1 || maxX >= width - 2 || maxY >= height - 2,
          };
        },
        [...shot],
      );
      const stageX = ((clip.x + ink.x - rect.stageX) / rect.stageW) * 1920;
      const stageY = ((clip.y + ink.y - rect.stageY) / rect.stageH) * 1080;
      expect(ink.edge, `${id} clipped`).toBe(false);
      expect(Math.abs(ink.w - expectBox.w) / expectBox.w, `${id} width`).toBeLessThanOrEqual(0.15);
      expect(Math.abs(ink.h - expectBox.h) / expectBox.h, `${id} height`).toBeLessThanOrEqual(0.15);
      expect(Math.abs(stageX - expectBox.x) / expectBox.w, `${id} x`).toBeLessThanOrEqual(0.15);
      expect(Math.abs(stageY - expectBox.y) / expectBox.h, `${id} y`).toBeLessThanOrEqual(0.15);
    }
  });
});
