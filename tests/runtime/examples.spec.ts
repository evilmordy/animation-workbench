import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Storyboard } from '../../src/shared/schema';
import { serveRuntime } from './serve';

const root = dirname(fileURLToPath(import.meta.url));

const samples = [
  {
    id: 'merge',
    mark: '为什么是 O(n log n)',
    code: readFileSync(join(root, '../../src/ai/agent/prompts/example-a.js'), 'utf8'),
  },
  {
    id: 'psych',
    mark: '心理张力',
    code: readFileSync(join(root, '../../src/ai/agent/prompts/example-b.js'), 'utf8'),
  },
];

function board(id: string, code: string): Storyboard {
  return {
    schemaVersion: 1,
    meta: { title: id, mode: '2d', aspect: '16:9', background: '#000000', stylePreset: '3b1b' },
    scenes: [
      {
        id,
        title: id,
        description: '',
        kind: 'code',
        enter: 'fresh',
        hold: 0,
        elements: [],
        steps: [],
        code,
      },
    ],
  };
}

test('两份范例能建场，seek 到后段再倒回', async ({ page }) => {
  const external = await serveRuntime(page);
  await page.goto('http://awpreview.test/anime.html');
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready);
  for (const sample of samples) {
    const result = await page.evaluate(
      async (storyboard) => {
        const win = window as unknown as {
          __run?: (sb: unknown) => Promise<{ errors: { message: string }[]; duration: number }>;
          __seek?: (t: number) => unknown;
        };
        const run = await win.__run!(storyboard);
        const later = Math.max(0.4, run.duration * 0.7);
        win.__seek!(later);
        const forward = document.body.textContent ?? '';
        win.__seek!(0.2);
        const back = document.body.textContent ?? '';
        return { errors: run.errors, duration: run.duration, forward, back };
      },
      board(sample.id, sample.code),
    );
    expect(result.errors, sample.id).toEqual([]);
    expect(result.duration, sample.id).toBeGreaterThan(0.2);
    expect(result.forward, sample.id).toContain(sample.mark);
    expect(result.back, sample.id).toContain(sample.mark);
  }
  expect(external).toEqual([]);
});
