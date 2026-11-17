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

  test('斜边上的正方形贴在外侧，公式标签没有断开的残点', async ({ page }) => {
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

    await seek(4);
    const boxes = await page.evaluate(() => {
      const layer = [...document.querySelectorAll('.awb-layer')].find(
        (el) => (el as HTMLElement).style.visibility !== 'hidden',
      );
      return ['la', 'lb', 'lc'].map((id) => {
        const node = layer?.querySelector(`[data-awb-id="${id}"]`);
        const rect = node?.getBoundingClientRect();
        return { id, x: rect?.x ?? 0, y: rect?.y ?? 0, w: rect?.width ?? 0, h: rect?.height ?? 0 };
      });
    });
    for (const box of boxes) {
      expect(box.w).toBeGreaterThan(4);
      const pad = 8;
      const shot = await page.screenshot({
        clip: {
          x: Math.max(0, box.x - pad),
          y: Math.max(0, box.y - pad),
          width: box.w + pad * 2,
          height: box.h + pad * 2,
        },
      });
      const ink = await page.evaluate(
        async (bytes) => {
          const blob = new Blob([new Uint8Array(bytes)]);
          const bmp = await createImageBitmap(blob);
          const canvas = document.createElement('canvas');
          canvas.width = bmp.width;
          canvas.height = bmp.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return { margin: -1, components: -1, topSpeck: true };
          ctx.drawImage(bmp, 0, 0);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const w = canvas.width;
          const h = canvas.height;
          const bright = (x: number, y: number) => {
            const i = (y * w + x) * 4;
            return (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 80;
          };
          let margin = 0;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              if (x >= 4 && y >= 4 && x < w - 4 && y < h - 4) continue;
              if (bright(x, y)) margin += 1;
            }
          }
          const seen = new Set<string>();
          const cells: Array<[number, number]> = [];
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              if (bright(x, y)) cells.push([x, y]);
            }
          }
          let components = 0;
          for (const start of cells) {
            const key = `${start[0]},${start[1]}`;
            if (seen.has(key)) continue;
            components += 1;
            const stack = [start];
            seen.add(key);
            while (stack.length) {
              const nextCell = stack.pop();
              if (!nextCell) break;
              const [cx, cy] = nextCell;
              for (const dx of [-1, 0, 1]) {
                for (const dy of [-1, 0, 1]) {
                  const nx = cx + dx;
                  const ny = cy + dy;
                  const next = `${nx},${ny}`;
                  if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen.has(next) || !bright(nx, ny)) continue;
                  seen.add(next);
                  stack.push([nx, ny]);
                }
              }
            }
          }
          const ys = cells.map((cell) => cell[1]);
          const top = ys.length ? Math.min(...ys) : 0;
          const bottom = ys.length ? Math.max(...ys) : 0;
          const limit = top + Math.max(2, (bottom - top) * 0.15);
          let topSpeck = false;
          for (let y = top; y <= limit; y++) {
            const runs: number[] = [];
            let run = 0;
            for (let x = 0; x < w; x++) {
              if (bright(x, y)) run += 1;
              else if (run) {
                runs.push(run);
                run = 0;
              }
            }
            if (run) runs.push(run);
            if (runs.length >= 2 && runs.some((item) => item <= 5)) topSpeck = true;
          }
          return { margin, components, topSpeck };
        },
        [...shot],
      );
      expect(ink.margin, box.id).toBe(0);
      expect(ink.components, box.id).toBe(1);
      expect(ink.topSpeck, box.id).toBe(false);
    }
  });
});
