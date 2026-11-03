import { Create } from 'manim-web';
import { beforeEach, describe, expect, it } from 'vitest';
import circleFixture from '../../tests/fixtures/code-circle.json';
import { parseStoryboard, type Scene, type Storyboard } from '../shared/schema';
import { validate } from '../shared/validate';
import { runtimeFlags } from './codeScene';
import { interpret } from './interpret';

const defaultCodeScenes = runtimeFlags.codeScenes;

function board(scenes: Scene[]): Storyboard {
  const parsed = parseStoryboard({
    schemaVersion: 1,
    meta: {
      title: 't',
      mode: '2d',
      aspect: '16:9',
      background: '#000000',
      stylePreset: '3b1b',
    },
    scenes,
  });
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => `${i.path} ${i.message}`).join('; '));
  return parsed.value;
}

const codeScene = (code: string, hold = 0.4): Scene => ({
  id: 's_code',
  title: '代码',
  description: '',
  kind: 'code',
  enter: 'fresh',
  hold,
  elements: [],
  steps: [],
  code,
});

const dslCircle = (): Scene => ({
  id: 's_dsl',
  title: '圆',
  description: '',
  kind: 'dsl',
  enter: 'fresh',
  hold: 0.2,
  elements: [{ id: 'c', type: 'Circle', props: { radius: 1 } }],
  steps: [{ id: 'p', kind: 'play', anims: [{ type: 'Create', target: 'c' }], duration: 1 }],
});

function recorder() {
  const waits: number[] = [];
  const plays: unknown[][] = [];
  const rec = {
    async nextSlide() {},
    async wait(duration = 0) {
      waits.push(duration);
    },
    async play(...anims: unknown[]) {
      plays.push(anims);
    },
  };
  return { rec: rec as never, waits, plays };
}

beforeEach(() => {
  runtimeFlags.codeScenes = false;
});

describe('interpretCode', () => {
  it('runtime.codeScenes 默认 false', () => {
    expect(defaultCodeScenes).toBe(false);
  });

  it('手写夹具是合法 v1 分镜', () => {
    expect(parseStoryboard(circleFixture).ok).toBe(true);
    expect(validate(circleFixture)).toEqual([]);
  });

  it('flag 关闭时不执行 code，行为与 v1 跳过一致', async () => {
    const { rec, waits, plays } = recorder();
    const errors: { sceneId?: string; message: string }[] = [];
    await interpret(board([codeScene("throw new Error('nope')", 0)]), rec, (e) => errors.push(e));
    expect(errors).toEqual([{ sceneId: 's_code', message: '代码场景暂不支持，已跳过' }]);
    expect(plays).toEqual([]);
    expect(waits).toEqual([0.1]);
  });

  it('flag 打开时执行函数体，参数是 recorder / M / theme', async () => {
    runtimeFlags.codeScenes = true;
    const parsed = parseStoryboard(circleFixture);
    if (!parsed.ok) throw new Error('fixture');
    const { rec, waits, plays } = recorder();
    const errors: { message: string }[] = [];
    await interpret(parsed.value, rec, (e) => errors.push(e));
    expect(errors).toEqual([]);
    expect(plays).toHaveLength(1);
    const anim = plays[0]?.[0];
    expect(anim).toBeInstanceOf(Create);
    expect((anim as Create).duration).toBe(1);
    expect(waits).toEqual([0.5]);
  });

  it('缺少 code、语法错误、运行时错误都进 onError，不中断后续 dsl', async () => {
    runtimeFlags.codeScenes = true;
    const cases: [Scene, string][] = [
      [codeScene('   '), '代码场景缺少 code'],
      [{ ...codeScene(''), code: undefined }, '代码场景缺少 code'],
      [codeScene('this is not js'), ''],
    ];
    for (const [scene, message] of cases) {
      const { rec, plays } = recorder();
      const errors: { sceneId?: string; message: string }[] = [];
      await expect(
        interpret(board([scene, dslCircle()]), rec, (e) => errors.push(e)),
      ).resolves.toBeUndefined();
      expect(errors[0]?.sceneId).toBe('s_code');
      if (message) expect(errors[0]?.message).toBe(message);
      else expect(errors[0]?.message.length).toBeGreaterThan(0);
      expect(plays).toHaveLength(1);
      expect(plays[0]?.[0]).toBeInstanceOf(Create);
    }

    const { rec, plays } = recorder();
    const errors: { sceneId?: string; message: string }[] = [];
    await interpret(board([codeScene("throw new Error('boom')"), dslCircle()]), rec, (e) => errors.push(e));
    expect(errors).toEqual([{ sceneId: 's_code', message: 'boom' }]);
    expect(plays).toHaveLength(1);
  });
});
