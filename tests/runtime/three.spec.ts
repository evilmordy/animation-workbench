import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { assembleExportHtml } from '../../src/features/export/exportHtml';
import type { Storyboard } from '../../src/shared/schema';
import { serveRuntime } from './serve';

/**
 * 设计书 §4.4 的半球 + 截面环。补了灯，否则 MeshStandardMaterial 是黑的。
 * 环转到 XZ，随 h 从赤道收到顶点。fadeIn 500ms，截面从 800ms 起线性走到 4800ms。
 */
const hemisphere = `
const { THREE, scene, renderer } = three3d({ fov: 40, camera: [0, 4, 9], target: [0, 0, 0] });
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.15);
sun.position.set(4, 8, 6);
scene.add(sun);
const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(2, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: C.blue, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide }),
);
scene.add(sphere);
const cut = { h: 0 };
const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.96, 1.04, 64),
  new THREE.MeshBasicMaterial({ color: C.red, side: THREE.DoubleSide }),
);
ring.rotation.x = Math.PI / 2;
scene.add(ring);
bind(cut, (s) => {
  const r = Math.sqrt(Math.max(0, 4 - s.h * s.h));
  ring.scale.set(r, r, 1);
  ring.position.y = s.h;
});
fadeIn(renderer.domElement, 0);
tw(cut, { h: [0, 2], duration: 4000, ease: 'linear' }, '+=300');
`;

const board: Storyboard = {
  schemaVersion: 1,
  meta: { title: '半球截面', mode: '2d', aspect: '16:9', background: '#000000', stylePreset: '3b1b' },
  scenes: [
    {
      id: 'hemi',
      title: '半球',
      description: '',
      kind: 'code',
      enter: 'fresh',
      hold: 0,
      elements: [],
      steps: [],
      code: hemisphere,
    },
  ],
};

const CSP_DIRECTIVES =
  "default-src 'none'; script-src 'sha256-HASH' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";

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

async function litPixels(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(
    async (bytes) => {
      const blob = new Blob([new Uint8Array(bytes)]);
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      ctx.drawImage(bmp, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        if (r + g + b > 48) count += 1;
      }
      return count;
    },
    [...png],
  );
}

test('半球截面：后向/乱序 seek 截帧一致且不是空白，重建后释放画布', async ({ page }) => {
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
    };
    return win.__run!(storyboard);
  }, board);
  expect(run.errors).toEqual([]);
  expect(run.scenes).toHaveLength(1);
  expect(run.duration).toBeGreaterThan(4);
  expect(external).toEqual([]);

  const seek = (t: number) =>
    page.evaluate((time) => (window as unknown as { __seek?: (n: number) => void }).__seek!(time), t);
  const shot = () => page.locator('#stage').screenshot();

  const times = [1.2, 2.8, 4.4];
  const ordered = new Map<number, Buffer>();
  for (const time of times) {
    await seek(time);
    const png = await shot();
    ordered.set(time, png);
    expect(await litPixels(page, png)).toBeGreaterThan(400);
  }
  expect(await diffShots(page, ordered.get(1.2)!, ordered.get(4.4)!)).toBeGreaterThan(80);

  for (const time of [4.4, 1.2, 2.8, 4.4, 1.2]) {
    await seek(time);
    expect(await diffShots(page, ordered.get(time)!, await shot())).toBe(0);
    expect(await litPixels(page, ordered.get(time)!)).toBeGreaterThan(400);
  }

  const canvasBox = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const attrs = gl?.getContextAttributes();
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug && gl ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : '';
    return {
      width: canvas.width,
      height: canvas.height,
      preserve: attrs?.preserveDrawingBuffer ?? false,
      antialias: attrs?.antialias ?? false,
      parent: canvas.parentElement?.dataset.scene ?? '',
      renderer,
    };
  });
  expect(canvasBox).toMatchObject({
    width: 1920,
    height: 1080,
    preserve: true,
    antialias: true,
    parent: 'hemi',
  });
  expect(canvasBox?.renderer ?? '').toMatch(/SwiftShader/i);

  await page.evaluate(async () => {
    const win = window as unknown as { __run?: (sb: unknown) => Promise<{ errors: { message: string }[] }> };
    const next = {
      schemaVersion: 1,
      meta: { title: '空', mode: '2d', aspect: '16:9', background: '#000000', stylePreset: '3b1b' },
      scenes: [
        {
          id: 'flat',
          title: '平面',
          description: '',
          kind: 'code',
          enter: 'fresh',
          hold: 0,
          elements: [],
          steps: [],
          code: 'wait(400);',
        },
      ],
    };
    const result = await win.__run!(next);
    if (result.errors.length) throw new Error(result.errors.map((item) => item.message).join('\n'));
  });
  expect(await page.locator('canvas').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('导出页离线可播，CSP 指令不变、只换哈希', async ({ page }) => {
  const runtime = readFileSync('dist-runtime/anime-runtime.js', 'utf8');
  expect(runtime).toContain('SphereGeometry');
  expect(runtime).toContain('WebGLRenderer');
  expect(runtime).not.toMatch(/from ["']three["']/);
  expect(runtime).not.toMatch(/cdn\.jsdelivr|unpkg\.com/);
  const html = await assembleExportHtml(runtime, board, { slides: false, loop: false });
  const csp = html.match(/Content-Security-Policy" content="([^"]*)"/)?.[1] ?? '';
  expect(csp.replace(/sha256-[A-Za-z0-9+/=]+/, 'sha256-HASH')).toBe(CSP_DIRECTIVES);
  expect(html).not.toMatch(/src="https?:/);

  const file = join(tmpdir(), 'awb-three-export.html');
  writeFileSync(file, html);
  const hits: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('http:') || url.startsWith('https:')) hits.push(url);
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __awbExport?: { seek?: (t: number) => void } }).__awbExport?.seek),
  );
  await page.evaluate(() =>
    (window as unknown as { __awbExport: { seek: (n: number) => void } }).__awbExport.seek(2),
  );
  const mid = await page.locator('#stage').screenshot();
  expect(await litPixels(page, mid)).toBeGreaterThan(400);
  // 导出页自动播放。两次 seek 的画布必须在同一次调用里读，中间不能让播放把时间推走。
  const same = await page.evaluate(() => {
    const exp = (window as unknown as { __awbExport: { seek: (n: number) => void } }).__awbExport;
    const canvas = document.querySelector('canvas');
    if (!canvas) return { equal: false, lit: 0 };
    const lit = () => {
      const probe = document.createElement('canvas');
      probe.width = canvas.width;
      probe.height = canvas.height;
      const ctx = probe.getContext('2d');
      if (!ctx) return 0;
      ctx.drawImage(canvas, 0, 0);
      const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        if (r + g + b > 48) count += 1;
      }
      return count;
    };
    exp.seek(2.8);
    const first = canvas.toDataURL('image/png');
    const litAt = lit();
    exp.seek(1.2);
    exp.seek(4.4);
    exp.seek(2.8);
    return { equal: first === canvas.toDataURL('image/png'), lit: litAt };
  });
  expect(same.equal).toBe(true);
  expect(same.lit).toBeGreaterThan(400);
  expect(hits).toEqual([]);
  expect(errors).toEqual([]);
});
