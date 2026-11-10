// @vitest-environment happy-dom
import { utils } from 'animejs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Storyboard } from '../../shared/schema';
import { AWB_BINDS, AWB_HELPER_SOURCE, wrapSceneCode } from './awb';
import { playHtmlStoryboard } from './player';

function board(codes: { id: string; code: string; hold?: number }[]): Storyboard {
  return {
    schemaVersion: 1,
    meta: { title: 't', mode: '2d', aspect: '16:9', background: '#000000', stylePreset: '3b1b' },
    scenes: codes.map((scene) => ({
      id: scene.id,
      title: scene.id,
      description: '',
      kind: 'code' as const,
      enter: 'fresh' as const,
      hold: scene.hold ?? 0,
      elements: [],
      steps: [],
      code: scene.code,
    })),
  };
}

const box = (id: string, color: string) => `
const el = document.createElement('div');
el.id = ${JSON.stringify(id)};
el.textContent = ${JSON.stringify(id)};
el.style.position = 'absolute';
el.style.left = '80px';
el.style.top = '80px';
el.style.width = '200px';
el.style.height = '80px';
el.style.background = ${JSON.stringify(color)};
root.appendChild(el);
tl.add(el, { opacity: [0, 1], duration: 200 }, 0);
tl.add({ duration: 800 });
`;

afterEach(() => {
  document.body.replaceChildren();
});

async function mount(codes: { id: string; code: string; hold?: number }[]) {
  const stage = document.createElement('div');
  stage.style.width = '960px';
  stage.style.height = '540px';
  document.body.appendChild(stage);
  const show = await playHtmlStoryboard(board(codes), stage);
  return { stage, show };
}

function xOf(id: string): number {
  const el = document.getElementById(id);
  if (!el) throw new Error(`找不到 ${id}`);
  return Number(utils.get(el, 'x', false));
}

function opacityOf(id: string): number {
  const el = document.getElementById(id) as HTMLElement | null;
  if (!el) throw new Error(`找不到 ${id}`);
  return parseFloat(el.style.opacity || '0');
}

describe('anime.js 播放', () => {
  it('seek 只改时间，下一场开始时上一场图层已经拿掉', async () => {
    const stage = document.createElement('div');
    stage.style.width = '960px';
    stage.style.height = '540px';
    document.body.appendChild(stage);
    const show = await playHtmlStoryboard(
      board([
        { id: 's1', code: box('s1', '#ff3366') },
        { id: 's2', code: box('s2', '#33cc88'), hold: 0.5 },
      ]),
      stage,
    );
    expect(show.errors).toEqual([]);
    expect(show.scenes.map((scene) => [scene.start, scene.end])).toEqual([
      [0, 1],
      [1, 2.5],
    ]);
    expect(show.duration).toBe(2.5);

    show.seek(1.4);
    expect(show.seek(1.4)).toBeUndefined();
    const second = document.getElementById('s2');
    const firstLayer = stage.querySelector('[data-scene="s1"]') as HTMLElement;
    const secondLayer = stage.querySelector('[data-scene="s2"]') as HTMLElement;
    expect(firstLayer.style.visibility).toBe('hidden');
    expect(secondLayer.style.visibility).not.toBe('hidden');
    expect(second?.textContent).toBe('s2');

    show.seek(0.5);
    expect(firstLayer.style.visibility).not.toBe('hidden');
    expect(secondLayer.style.visibility).toBe('hidden');
    show.kill();
  });

  it('坏代码只记在这一场，不让整片抛出去', async () => {
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    const show = await playHtmlStoryboard(
      board([
        { id: 'bad', code: 'throw new Error("boom")' },
        { id: 'ok', code: box('ok', '#ffffff') },
      ]),
      stage,
    );
    expect(show.errors).toEqual([{ sceneId: 'bad', message: 'boom' }]);
    expect(show.scenes).toHaveLength(2);
    show.seek(1.5);
    expect((stage.querySelector('[data-scene="bad"]') as HTMLElement).style.visibility).toBe('hidden');
    show.kill();
  });
});

describe('awb helper', () => {
  it('源码不包含被 CI 文本扫描禁止的 HTML 写入，并包进块作用域', () => {
    const banned = ['inner', 'outer'].map((name) => name + 'HTML').concat(['insertAdjacent' + 'HTML']);
    for (const word of banned) expect(AWB_HELPER_SOURCE.includes(word)).toBe(false);
    expect(AWB_HELPER_SOURCE).toContain(`root.${AWB_BINDS}`);
    const wrapped = wrapSceneCode('const W = 1;\n');
    expect(wrapped).toContain('\n{\nconst W = 1;\n');
    expect(wrapped.trimEnd().endsWith('}')).toBe(true);
    expect(wrapped.indexOf('const W = ctx.width')).toBeLessThan(wrapped.lastIndexOf('\n{\n'));
  });

  it('同属性三段 [from,to] 倒序 seek 复原', async () => {
    const code = `
      const box = document.createElement('div');
      box.id = 'box';
      root.appendChild(box);
      tl.add(box, { x: [0, 100], duration: 400, ease: 'linear' }, 0);
      tl.add(box, { x: [100, 200], duration: 400, ease: 'linear' }, 800);
      tl.add(box, { x: [200, 50], duration: 400, ease: 'linear' }, 1600);
    `;
    const { show } = await mount([{ id: 's', code }]);
    expect(show.errors).toEqual([]);
    const times = [0, 0.2, 0.4, 0.6, 0.8, 1, 1.4, 1.6, 1.8, 2];
    const expected = [0, 50, 100, 100, 100, 150, 200, 200, 125, 50];
    times.forEach((t, i) => {
      show.seek(t);
      expect(xOf('box'), `forward ${t}`).toBeCloseTo(expected[i]!, 3);
    });
    [...times].reverse().forEach((t, i) => {
      show.seek(t);
      expect(xOf('box'), `back ${t}`).toBeCloseTo(expected[expected.length - 1 - i]!, 3);
    });
    show.kill();
  });

  it('tw 走同一套起点保护', async () => {
    const code = `
      const box = el('div', { left: 0, top: 0, width: 10, height: 10 });
      box.id = 'twbox';
      tw(box, { x: [0, 100], duration: 400, ease: 'linear' }, 0);
      tw(box, { x: [100, 200], duration: 400, ease: 'linear' }, 800);
      tw(box, { x: [200, 50], duration: 400, ease: 'linear' }, 1600);
    `;
    const { show } = await mount([{ id: 's', code }]);
    expect(show.errors).toEqual([]);
    show.seek(2);
    expect(xOf('twbox')).toBeCloseTo(50, 3);
    show.seek(0.6);
    expect(xOf('twbox')).toBeCloseTo(100, 3);
    show.seek(0);
    expect(xOf('twbox')).toBeCloseTo(0, 3);
    show.kill();
  });

  it('bind 纯函数往回 seek 与再 seek 到同一时刻一致', async () => {
    const code = `
      const state = { n: 0 };
      const label = el('div', { left: 80, top: 80, width: 200, height: 40 }, 'x');
      label.id = 'n';
      bind(state, (s) => { label.dataset.n = String(s.n); });
      tw(state, { n: [0, 1], duration: 1000, ease: 'linear' }, 0);
    `;
    const { show } = await mount([{ id: 's', code }]);
    expect(show.errors).toEqual([]);
    const read = () => parseFloat((document.getElementById('n') as HTMLElement).dataset.n ?? 'NaN');
    show.seek(0);
    expect(read()).toBeCloseTo(0, 4);
    show.seek(1);
    expect(read()).toBeCloseTo(1, 4);
    show.seek(0.5);
    const mid = read();
    expect(mid).toBeCloseTo(0.5, 3);
    show.seek(1);
    show.seek(0.5);
    expect(read()).toBeCloseTo(mid, 6);
    show.seek(0);
    expect(read()).toBeCloseTo(0, 4);
    show.kill();
  });

  it('场景里再声明 const W 不报错，并且仍能用注入的 helper', async () => {
    const code = `
      const W = 7;
      const box = el('div', { left: W, top: 0, width: 10, height: 10 }, String(W));
      box.id = 'shadow';
      tw(box, { x: [0, 10], duration: 200, ease: 'linear' }, 0);
    `;
    const { show } = await mount([{ id: 's', code }]);
    expect(show.errors).toEqual([]);
    const el = document.getElementById('shadow') as HTMLElement;
    expect(el.textContent).toBe('7');
    expect(el.style.left).toBe('7px');
    show.seek(0.2);
    expect(xOf('shadow')).toBeCloseTo(10, 3);
    show.kill();
  });

  it('helper 已经烘进 code 的旧场仍能播', async () => {
    const code = `
      const W = 320;
      const H = 180;
      function el(tag) {
        const node = document.createElement(tag);
        node.id = 'baked';
        node.textContent = 'baked-' + W + 'x' + H;
        root.appendChild(node);
        return node;
      }
      const box = el('div');
      tl.add(box, { opacity: [0, 1], duration: 200 }, 0);
      tl.add({ duration: 200 });
    `;
    const { show } = await mount([{ id: 's', code }]);
    expect(show.errors).toEqual([]);
    expect(document.getElementById('baked')?.textContent).toBe('baked-320x180');
    show.seek(0.4);
    expect(opacityOf('baked')).toBeCloseTo(1, 3);
    show.seek(0);
    expect(opacityOf('baked')).toBeCloseTo(0, 3);
    show.kill();
  });

  it('新场不写 helper 也能用 tw、版面和 at', async () => {
    const code = `
      const mark = el('div', { left: 0, top: 0, width: 8, height: 8 }, String(W));
      mark.id = 'fresh';
      const a = el('div', { left: 0, top: 20, width: 8, height: 8 });
      a.id = 'a';
      const b = el('div', { left: 0, top: 40, width: 8, height: 8 });
      b.id = 'b';
      fadeIn(a, 100, { duration: 200, ease: 'linear' });
      fadeIn(b, '<<+=50', { duration: 200, ease: 'linear' });
      wait(700);
      const c = el('div', { left: 0, top: 60, width: 8, height: 8 });
      c.id = 'c';
      fadeIn(c, '+=0', { duration: 200, ease: 'linear' });
      const title = head('标题', 0);
      title.id = 'title';
      const caption = say('字幕', 0);
      caption.id = 'caption';
      const svg = svgRoot();
      svg.id = 'fullsvg';
    `;
    const { show } = await mount([{ id: 's', code }]);
    expect(show.errors).toEqual([]);
    expect(document.getElementById('fresh')?.textContent).toBe('1920');
    const title = document.getElementById('title') as HTMLElement;
    const caption = document.getElementById('caption') as HTMLElement;
    expect(title.textContent).toBe('标题');
    expect(caption.textContent).toBe('字幕');
    expect(title.style.top).toBe('52px');
    expect(caption.style.top).toBe('952px');
    expect(document.getElementById('fullsvg')?.getAttribute('data-awb-role')).toBe('canvas');
    expect(document.getElementById('fullsvg')?.getAttribute('viewBox')).toBe('0 0 1920 1080');

    show.seek(0.12);
    expect(opacityOf('a')).toBeCloseTo(0.1, 2);
    expect(opacityOf('b')).toBeCloseTo(0, 2);
    show.seek(0.25);
    expect(opacityOf('a')).toBeCloseTo(0.75, 2);
    expect(opacityOf('b')).toBeCloseTo(0.5, 2);
    show.seek(0.5);
    expect(opacityOf('a')).toBeCloseTo(1, 2);
    expect(opacityOf('c')).toBeCloseTo(0, 2);
    show.seek(1.15);
    expect(opacityOf('c')).toBeCloseTo(0.5, 2);
    show.kill();
  });

  it('不可见场不跑 bind，回到这一场再按当前时间重画', async () => {
    const first = `
      const state = { n: 0 };
      const label = el('div', { left: 0, top: 0, width: 40, height: 20 }, 'a');
      label.id = 's1n';
      bind(state, (s) => {
        label.dataset.n = String(s.n);
        label.dataset.calls = String(Number(label.dataset.calls || 0) + 1);
      });
      tw(state, { n: [0, 1], duration: 1000, ease: 'linear' }, 0);
    `;
    const second = `
      const label = el('div', { left: 0, top: 0, width: 40, height: 20 }, 'b');
      label.id = 's2n';
      tl.add({ duration: 1000 });
    `;
    const { show } = await mount([
      { id: 's1', code: first },
      { id: 's2', code: second },
    ]);
    expect(show.errors).toEqual([]);
    const label = () => document.getElementById('s1n') as HTMLElement;
    show.seek(0.5);
    const calls = label().dataset.calls;
    expect(parseFloat(label().dataset.n ?? 'NaN')).toBeCloseTo(0.5, 3);
    show.seek(1.5);
    show.seek(1.8);
    expect(label().dataset.calls).toBe(calls);
    show.seek(0.5);
    expect(parseFloat(label().dataset.n ?? 'NaN')).toBeCloseTo(0.5, 3);
    expect(Number(label().dataset.calls)).toBeGreaterThan(Number(calls));
    show.kill();
  });
});
