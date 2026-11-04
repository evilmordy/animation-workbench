import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { assembleExportHtml } from '../../src/features/export/exportHtml';
import type { Storyboard } from '../../src/shared/schema';
import { countNear } from './pixels';
import { serveRuntime } from './serve';

const sb: Storyboard = {
  schemaVersion: 1,
  meta: { title: 'gsap', mode: '2d', aspect: '16:9', background: '#000000', stylePreset: '3b1b' },
  scenes: [
    {
      id: 's1',
      title: '第一场',
      description: '',
      kind: 'code',
      enter: 'fresh',
      hold: 0,
      elements: [],
      steps: [],
      code: `
        const el = document.createElement('div');
        el.id = 's1';
        el.textContent = '第一场';
        el.style.position = 'absolute';
        el.style.left = '80px';
        el.style.top = '80px';
        el.style.width = '400px';
        el.style.height = '160px';
        el.style.background = '#ff3366';
        el.style.color = '#ffffff';
        root.appendChild(el);
        tl.from(el, { autoAlpha: 0, duration: 0.2 });
        tl.to({}, { duration: 0.8 });
      `,
    },
    {
      id: 's2',
      title: '第二场',
      description: '',
      kind: 'code',
      enter: 'fresh',
      hold: 0,
      elements: [],
      steps: [],
      code: `
        const el = document.createElement('div');
        el.id = 's2';
        el.textContent = '第二场';
        el.style.position = 'absolute';
        el.style.left = '80px';
        el.style.top = '280px';
        el.style.width = '400px';
        el.style.height = '160px';
        el.style.background = '#33cc88';
        el.style.color = '#ffffff';
        root.appendChild(el);
        tl.from(el, { autoAlpha: 0, duration: 0.2 });
        tl.to({}, { duration: 0.8 });
      `,
    },
  ],
};

test.use({ viewport: { width: 960, height: 540 } });

test('GSAP 场可 seek，换场后上一场色块不留在画面上', async ({ page }) => {
  const external = await serveRuntime(page);
  await page.goto('http://awpreview.test/gsap.html');
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready);
  const result = await page.evaluate((storyboard) => {
    const win = window as unknown as {
      __run?: (
        sb: unknown,
      ) => Promise<{ errors: { message: string }[]; duration: number; scenes: { id: string }[] }>;
      __seek?: (t: number) => unknown;
    };
    return win.__run!(storyboard).then(async (run) => {
      const seekResult = win.__seek!(1.5);
      return { run, seekVoid: seekResult === undefined };
    });
  }, sb);
  expect(result.run.errors).toEqual([]);
  expect(result.run.duration).toBeCloseTo(2, 5);
  expect(result.run.scenes.map((scene) => scene.id)).toEqual(['s1', 's2']);
  expect(result.seekVoid).toBe(true);
  await page.waitForTimeout(50);
  const shot = await page.locator('#stage').screenshot();
  expect(await countNear(page, shot, '#ff3366')).toBe(0);
  expect(await countNear(page, shot, '#33cc88')).toBeGreaterThan(500);
  const hidden = await page.evaluate(() => {
    const layer = document.querySelector('[data-scene="s1"]') as HTMLElement | null;
    return layer?.style.visibility ?? '';
  });
  expect(hidden).toBe('hidden');
  expect(external).toEqual([]);
});

test('导出的 GSAP HTML 内联运行时，CSP 不改指令', async () => {
  const runtime = readFileSync('dist-runtime/gsap-runtime.js', 'utf8');
  expect(runtime).toContain('standard-license');
  expect(runtime).not.toContain('cdn');
  const html = await assembleExportHtml(runtime, sb, { slides: false, loop: false, codeScenes: true });
  expect(html).toContain(runtime.slice(0, 80));
  expect(html).not.toMatch(/src="https?:/);
  expect(html).toContain('data-code-scenes="1"');
  const csp = html.match(/Content-Security-Policy" content="([^"]*)"/)?.[1] ?? '';
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain("style-src 'unsafe-inline'");
  expect(csp).toMatch(/script-src 'sha256-[^']+' 'unsafe-eval'/);
  const legacy = await assembleExportHtml('/* runtime */\n', sb, { slides: false, loop: false });
  expect(legacy).not.toContain('data-code-scenes');
});
