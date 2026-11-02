import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/pythagoras.json' with { type: 'json' };
import { serveRuntime } from './serve';

const msgs = (page: Page) => page.evaluate(() => (window as any).__msgs as any[]);
const waitFor = (page: Page, type: string) =>
  expect.poll(async () => (await msgs(page)).find((m) => m.type === type), { timeout: 30_000 }).toBeTruthy();

test('运行时加载附录 A：场景起止时间正确、无错误、无外联', async ({ page }) => {
  const external = await serveRuntime(page);
  await page.goto('http://host.test/harness.html');
  await waitFor(page, 'ready');
  await page.evaluate((sb) => (window as any).send({ type: 'load', storyboard: sb }), fixture);
  await waitFor(page, 'loaded');

  const all = await msgs(page);
  const loaded = all.find((m) => m.type === 'loaded');
  expect(loaded.scenes.map((s: any) => s.id)).toEqual(['s_tri001', 's_sq0002', 's_eq0003']);
  expect(loaded.scenes.map((s: any) => [s.start, s.end])).toEqual([
    [0, 4.5],
    [4.5, 10],
    [10, 17],
  ]);
  expect(loaded.duration).toBeCloseTo(17, 5);
  expect(all.filter((m) => m.type === 'error' || m.type === 'log')).toEqual([]);

  await page.evaluate(() => (window as any).send({ type: 'seek', t: 12 }));
  await expect
    .poll(async () => (await msgs(page)).filter((m) => m.type === 'time').at(-1)?.t)
    .toBeCloseTo(12, 3);
  await page.evaluate(() => (window as any).send({ type: 'seek', t: 16.9 }));
  await page.waitForTimeout(300);
  await page.locator('#preview').screenshot({ path: 'test-results/runtime-pythagoras-end.png' });
  expect(all.find((m) => m.type === 'ready')).toMatchObject({ manimWebVersion: '0.40.1' });
  expect(external).toEqual([]);
});

test('fresh 转场、lag 和各类元素/动画都能构建', async ({ page }) => {
  const external = await serveRuntime(page);
  await page.goto('http://host.test/harness.html');
  await waitFor(page, 'ready');
  const sb = structuredClone(fixture) as any;
  sb.scenes.push({
    id: 's_all',
    title: '全类型',
    description: '',
    kind: 'dsl',
    enter: 'fresh',
    hold: 0.5,
    elements: [
      { id: 'ax', type: 'Axes', props: {} },
      {
        id: 'fg',
        type: 'FunctionGraph',
        props: { expr: 'Math.sin(x)', axes: 'ax' },
        style: { color: '$accent' },
      },
      { id: 'np', type: 'NumberPlane', props: {} },
      {
        id: 'c',
        type: 'Circle',
        props: { radius: 0.5 },
        place: { at: [-3, 2] },
        style: { fill: '$primary', fillOpacity: 0.5 },
      },
      { id: 'r', type: 'Rectangle', props: {}, place: { toEdge: 'UP' } },
      { id: 'l', type: 'Line', props: { start: [-1, -1], end: [1, -1] } },
      { id: 'ar', type: 'Arrow', props: { start: [0, 0], end: [1, 1] } },
      { id: 'd', type: 'Dot', props: {}, place: { nextTo: { id: 'c', dir: 'RIGHT' } } },
      { id: 't', type: 'Text', props: { text: '你好' }, place: { at: [3, 2] } },
      { id: 'b', type: 'Brace', props: { target: 'l' } },
      { id: 'g', type: 'Group', props: { children: ['c', 'd'] } },
      { id: 'm1', type: 'MathTex', props: { latex: 'a+b' }, place: { at: [0, -3] } },
      { id: 'm2', type: 'MathTex', props: { latex: 'a+c' }, place: { at: [0, -3] } },
    ],
    steps: [
      {
        id: 'p1',
        kind: 'play',
        anims: [
          { type: 'Create', target: 'ax' },
          { type: 'Create', target: 'fg' },
          { type: 'FadeIn', target: 'np' },
        ],
        duration: 1.5,
        lag: 0.5,
      },
      {
        id: 'p2',
        kind: 'play',
        anims: [
          { type: 'GrowFromCenter', target: 'g' },
          { type: 'DrawBorderThenFill', target: 'r' },
          { type: 'Create', target: 'l' },
          { type: 'GrowFromCenter', target: 'ar' },
          { type: 'Write', target: 't' },
          { type: 'Write', target: 'm1' },
        ],
        duration: 1,
        rate: 'linear',
      },
      {
        id: 'p3',
        kind: 'play',
        anims: [
          { type: 'FadeIn', target: 'b' },
          { type: 'Shift', target: 'g', params: { by: [1, 0] } },
          { type: 'Rotate', target: 'r', params: { degrees: 30 } },
        ],
        duration: 1,
      },
      {
        id: 'p4',
        kind: 'play',
        anims: [
          { type: 'MoveTo', target: 'ar', params: { at: [2, -2] } },
          { type: 'ScaleInPlace', target: 't', params: { factor: 1.5 } },
          { type: 'SetColor', target: 'l', params: { color: '#FFFF00' } },
        ],
        duration: 1,
      },
      {
        id: 'p5',
        kind: 'play',
        anims: [
          { type: 'Flash', target: 'd' },
          { type: 'Wiggle', target: 'r' },
          { type: 'Circumscribe', target: 't' },
        ],
        duration: 1,
      },
      {
        id: 'p6',
        kind: 'play',
        anims: [{ type: 'TransformMatchingTex', target: 'm1', to: 'm2' }],
        duration: 1,
      },
      { id: 'w', kind: 'wait', duration: 0.5 },
      {
        id: 'p7',
        kind: 'play',
        anims: [
          { type: 'Uncreate', target: 'l' },
          { type: 'FadeOut', target: 'np' },
        ],
        duration: 1,
      },
    ],
  });
  await page.evaluate((s) => (window as any).send({ type: 'load', storyboard: s }), sb);
  await waitFor(page, 'loaded');
  const all = await msgs(page);
  const loaded = all.find((m) => m.type === 'loaded');
  // 0.5 转场 + 8 步骤 + 0.5 停留
  expect(loaded.scenes[3]).toMatchObject({ id: 's_all', start: 17 });
  expect(loaded.scenes[3].end).toBeCloseTo(26, 5);
  expect(all.filter((m) => m.type === 'error')).toEqual([]);
  expect(external).toEqual([]);
  await page.evaluate(() => (window as any).send({ type: 'seek', t: 24 }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/runtime-all-types.png' });
});

test('结构错误会以 error 消息上报', async ({ page }) => {
  await serveRuntime(page);
  await page.goto('http://host.test/harness.html');
  await waitFor(page, 'ready');
  await page.evaluate(() => (window as any).send({ type: 'load', storyboard: { schemaVersion: 9 } }));
  await waitFor(page, 'error');
});
