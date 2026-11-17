// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import fixture from '../../../tests/fixtures/pythagoras.json' with { type: 'json' };
import { ANIM_TYPES, ELEMENT_TYPES } from '../../shared/registry';
import type { Element, Scene, Storyboard } from '../../shared/schema';
import { sceneDuration } from '../../shared/timing';
import { translateStoryboard } from './dsl';
import { playHtmlStoryboard, stageSize } from './player';

const pythagoras = fixture as Storyboard;

function film(scenes: Scene[], aspect: Storyboard['meta']['aspect'] = '16:9'): Storyboard {
  return {
    schemaVersion: 1,
    meta: { title: 't', mode: '2d', aspect, background: '#000000', stylePreset: '3b1b' },
    scenes,
  };
}

function scene(id: string, elements: Element[], steps: Scene['steps'], hold = 0): Scene {
  return {
    id,
    title: id,
    description: '',
    kind: 'dsl',
    enter: 'fresh',
    hold,
    elements,
    steps,
  };
}

function el(
  id: string,
  type: Element['type'],
  props: Element['props'] = {},
  place?: Element['place'],
): Element {
  return { id, type, props, ...(place ? { place } : {}) };
}

function step(
  id: string,
  anims: Extract<Scene['steps'][number], { kind: 'play' }>['anims'],
  duration = 0.3,
): Scene['steps'][number] {
  return { id, kind: 'play', anims, duration };
}

afterEach(() => {
  document.body.replaceChildren();
});

async function run(sb: Storyboard) {
  const stage = document.createElement('div');
  stage.style.width = '960px';
  stage.style.height = '540px';
  document.body.appendChild(stage);
  const show = await playHtmlStoryboard(sb, stage);
  return { stage, show };
}

describe('DSL 转译', () => {
  it('勾股转译后场景起止与时长等式一致', async () => {
    const parts = translateStoryboard(pythagoras);
    expect(parts).toHaveLength(3);
    expect(parts[0]?.contentMs).toBe(3500);
    expect(parts[1]?.contentMs).toBe(4500);
    expect(parts[2]?.contentMs).toBe(5000);
    expect(parts[1]?.code).not.toContain('fadeCarried');
    expect(parts[1]?.code).toContain('"id":"tri"');
    expect(parts[1]?.code).toContain('"type":"FadeOut"');
    expect(parts[2]?.code).toContain('"id":"sa"');
    expect(parts.map((part) => part.errors)).toEqual([[], [], []]);

    const { show } = await run(pythagoras);
    expect(show.errors).toEqual([]);
    const spans = show.scenes.map((item) => [item.start, item.end]);
    expect(spans).toEqual([
      [0, 4.5],
      [4.5, 10],
      [10, 17],
    ]);
    expect(show.duration).toBe(17);
    pythagoras.scenes.forEach((item, index) => {
      const span = show.scenes[index];
      expect((span?.end ?? 0) - (span?.start ?? 0)).toBeCloseTo(sceneDuration(item, index), 5);
    });
  });

  it('第一场转译快照', () => {
    const code = translateStoryboard(pythagoras)[0]?.code ?? '';
    expect(code).toMatchInlineSnapshot(`
      "ctx.dsl.pad(3500);
      ctx.dsl.node({"id":"tri","type":"Polygon","props":{"points":[[-1,-0.5],[1,-0.5],[-1,1]]},"color":"#58C4DD","strokeWidth":4,"scale":1,"rotate":0,"show":"enter"});
      ctx.dsl.node({"id":"la","type":"MathTex","props":{"latex":"a","fontSize":48},"color":"#FFFFFF","strokeWidth":0,"scale":1,"rotate":0,"show":"enter","place":{"nextTo":{"id":"tri","dir":"LEFT"}}});
      ctx.dsl.node({"id":"lb","type":"MathTex","props":{"latex":"b","fontSize":48},"color":"#FFFFFF","strokeWidth":0,"scale":1,"rotate":0,"show":"enter","place":{"nextTo":{"id":"tri","dir":"DOWN"}}});
      ctx.dsl.node({"id":"lc","type":"MathTex","props":{"latex":"c","fontSize":48},"color":"#FFFFFF","strokeWidth":0,"scale":1,"rotate":0,"show":"enter","place":{"at":[0.3,0.65]}});
      ctx.dsl.anim({"type":"Create","target":"tri","at":0,"duration":2000,"ease":"smooth"});
      ctx.dsl.anim({"type":"Write","target":"la","at":2000,"duration":938,"ease":"smooth"});
      ctx.dsl.anim({"type":"Write","target":"lb","at":2281,"duration":938,"ease":"smooth"});
      ctx.dsl.anim({"type":"Write","target":"lc","at":2563,"duration":937,"ease":"smooth"});"
    `);
  });

  it('引用不存在的元素时报错，这一场仍能播', async () => {
    const sb = film([
      scene(
        's',
        [el('c', 'Circle', { radius: 0.4 })],
        [step('p', [{ type: 'Create', target: 'missing' }], 0.4)],
        0.2,
      ),
    ]);
    const part = translateStoryboard(sb)[0];
    expect(part?.errors.map((issue) => issue.message)).toEqual(['引用的元素 "missing" 不存在']);
    const { show } = await run(sb);
    expect(show.errors.map((issue) => issue.message)).toContain('引用的元素 "missing" 不存在');
    expect(show.duration).toBeGreaterThan(0);
    expect(show.scenes[0]?.end).toBeCloseTo(sceneDuration(sb.scenes[0]!, 0), 5);
  });

  it('不安全的函数表达式不进转译产物', () => {
    const sb = film([
      scene(
        's',
        [el('fg', 'FunctionGraph', { expr: 'globalThis.foo' })],
        [step('p', [{ type: 'Create', target: 'fg' }])],
      ),
    ]);
    const part = translateStoryboard(sb)[0];
    expect(part?.errors.map((issue) => issue.message)).toEqual(['函数表达式包含不允许的内容']);
    expect(part?.code).not.toContain('globalThis');
  });

  it('14 种元素和 18 种动画都能编译能播', async () => {
    const scenes: Scene[] = [
      scene(
        'el_shapes',
        [
          el('c', 'Circle', { radius: 0.4 }, { at: [-3, 1] }),
          el('s', 'Square', { sideLength: 1 }, { at: [-1, 1] }),
          el('r', 'Rectangle', {}, { at: [1, 1] }),
          el('p', 'Polygon', {
            points: [
              [-0.4, -0.3],
              [0.4, -0.3],
              [0, 0.4],
            ],
          }),
          el('l', 'Line', { start: [-2, -1], end: [2, -1] }),
          el('a', 'Arrow', { start: [0, 0], end: [1.2, 0.8] }),
          el('d', 'Dot', {}, { at: [3, 1] }),
        ],
        [
          step('p', [
            { type: 'Create', target: 'c' },
            { type: 'Create', target: 's' },
            { type: 'DrawBorderThenFill', target: 'r' },
            { type: 'Create', target: 'p' },
            { type: 'Create', target: 'l' },
            { type: 'GrowFromCenter', target: 'a' },
            { type: 'FadeIn', target: 'd' },
          ]),
        ],
      ),
      scene(
        'el_text',
        [
          el('t', 'Text', { text: '你好' }, { at: [0, 1] }),
          el('m', 'MathTex', { latex: 'a^2' }, { at: [0, -1] }),
        ],
        [
          step('p', [
            { type: 'Write', target: 't' },
            { type: 'Write', target: 'm' },
          ]),
        ],
      ),
      scene(
        'el_axes',
        [
          el('ax', 'Axes', {}),
          el('fg', 'FunctionGraph', { expr: 'Math.sin(x)', axes: 'ax' }),
          el('np', 'NumberPlane', {}),
        ],
        [
          step('p', [
            { type: 'Create', target: 'ax' },
            { type: 'Create', target: 'fg' },
            { type: 'FadeIn', target: 'np' },
          ]),
        ],
      ),
      scene(
        'el_brace',
        [el('ln', 'Line', { start: [-1, 0], end: [1, 0] }), el('br', 'Brace', { target: 'ln', dir: 'DOWN' })],
        [
          step('p', [
            { type: 'Create', target: 'ln' },
            { type: 'FadeIn', target: 'br' },
          ]),
        ],
      ),
      scene(
        'el_group',
        [
          el('gc', 'Circle', { radius: 0.3 }, { at: [-0.4, 0] }),
          el('gd', 'Dot', {}, { nextTo: { id: 'gc', dir: 'RIGHT' } }),
          el('g', 'Group', { children: ['gc', 'gd'] }),
        ],
        [step('p', [{ type: 'GrowFromCenter', target: 'g' }])],
      ),
      scene(
        'an_fade',
        [el('c', 'Circle', { radius: 0.5 })],
        [step('in', [{ type: 'FadeIn', target: 'c' }]), step('out', [{ type: 'FadeOut', target: 'c' }])],
      ),
      scene(
        'an_uncreate',
        [el('c', 'Square', { sideLength: 1 })],
        [step('in', [{ type: 'Create', target: 'c' }]), step('out', [{ type: 'Uncreate', target: 'c' }])],
      ),
      scene(
        'an_motion',
        [el('c', 'Circle', { radius: 0.4 }), el('t', 'Text', { text: '移' }, { at: [1, 1] })],
        [
          step('in', [
            { type: 'FadeIn', target: 'c' },
            { type: 'FadeIn', target: 't' },
          ]),
          step('shift', [{ type: 'Shift', target: 'c', params: { by: [1, 0] } }]),
          step('move', [{ type: 'MoveTo', target: 'c', params: { at: [2, -1] } }]),
          step('rot', [{ type: 'Rotate', target: 't', params: { degrees: 30 } }]),
          step('scale', [{ type: 'ScaleInPlace', target: 't', params: { factor: 1.4 } }]),
          step('color', [{ type: 'SetColor', target: 'c', params: { color: '#FFFF00' } }]),
        ],
      ),
      scene(
        'an_attention',
        [el('c', 'Square', { sideLength: 1 }), el('t', 'Text', { text: '看' })],
        [
          step('in', [
            { type: 'FadeIn', target: 'c' },
            { type: 'Write', target: 't' },
          ]),
          step('ind', [{ type: 'Indicate', target: 'c' }]),
          step('wig', [{ type: 'Wiggle', target: 'c' }]),
          step('cir', [{ type: 'Circumscribe', target: 't' }]),
          step('fl', [{ type: 'Flash', target: 'c' }]),
        ],
      ),
      scene(
        'an_transform',
        [
          el('a', 'Square', { sideLength: 1 }, { at: [-1, 0] }),
          el('b', 'Circle', { radius: 0.6 }, { at: [1, 0] }),
        ],
        [
          step('in', [{ type: 'FadeIn', target: 'a' }]),
          step('go', [{ type: 'Transform', target: 'a', to: 'b' }]),
        ],
      ),
      scene(
        'an_tex',
        [
          el('m1', 'MathTex', { latex: 'a+b' }, { at: [-1, 0] }),
          el('m2', 'MathTex', { latex: 'a+c' }, { at: [1, 0] }),
        ],
        [
          step('in', [{ type: 'Write', target: 'm1' }]),
          step('go', [{ type: 'TransformMatchingTex', target: 'm1', to: 'm2' }]),
        ],
      ),
    ];
    const { show } = await run(film(scenes));
    expect(show.errors).toEqual([]);
    expect(show.duration).toBeGreaterThan(1);
    expect(Number.isFinite(show.duration)).toBe(true);
    const coveredEls = new Set(scenes.flatMap((item) => item.elements.map((element) => element.type)));
    const coveredAnims = new Set(
      scenes.flatMap((item) =>
        item.steps.flatMap((itemStep) =>
          itemStep.kind === 'play' ? itemStep.anims.map((anim) => anim.type) : [],
        ),
      ),
    );
    expect([...coveredEls].sort()).toEqual([...ELEMENT_TYPES].sort());
    expect([...coveredAnims].sort()).toEqual([...ANIM_TYPES].sort());
  });

  it('9:16 和 1:1 的舞台像素', async () => {
    expect(stageSize('16:9')).toEqual({ width: 1920, height: 1080 });
    expect(stageSize('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(stageSize('1:1')).toEqual({ width: 1080, height: 1080 });
    for (const aspect of ['9:16', '1:1'] as const) {
      const { stage } = await run(
        film([scene('s', [el('c', 'Dot')], [step('p', [{ type: 'FadeIn', target: 'c' }])])], aspect),
      );
      const canvas = stage.querySelector('#canvas') as HTMLElement;
      const size = stageSize(aspect);
      expect(canvas.dataset.stageWidth).toBe(String(size.width));
      expect(canvas.dataset.stageHeight).toBe(String(size.height));
      expect(canvas.style.width).toBe(`${size.width}px`);
      expect(canvas.style.height).toBe(`${size.height}px`);
    }
  });
});
