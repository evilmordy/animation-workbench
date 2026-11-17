import { Create } from 'manim-web';
import { describe, expect, it } from 'vitest';
import circleFixture from '../../tests/fixtures/code-circle.json';
import { parseStoryboard, type Scene, type Storyboard } from '../shared/schema';
import { validate } from '../shared/validate';
import { interpret } from './interpret';

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
  if (!parsed.ok) throw new Error(parsed.issues.map((issue) => `${issue.path} ${issue.message}`).join('; '));
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

describe('manim 代码场报错不崩', () => {
  it('夹具仍是合法 v1，但运行时不执行', async () => {
    expect(parseStoryboard(circleFixture).ok).toBe(true);
    expect(validate(circleFixture)).toEqual([]);
    const parsed = parseStoryboard(circleFixture);
    if (!parsed.ok) throw new Error('fixture');
    const { rec, waits, plays } = recorder();
    const errors: { sceneId?: string; message: string }[] = [];
    await expect(
      interpret({ ...parsed.value, scenes: [...parsed.value.scenes, dslCircle()] }, rec, (error) =>
        errors.push(error),
      ),
    ).resolves.toBeUndefined();
    expect(errors).toEqual([{ sceneId: 's_code', message: '代码场不归 manim 运行时播' }]);
    expect(waits[0]).toBe(0.5);
    expect(plays).toHaveLength(1);
    expect(plays[0]?.[0]).toBeInstanceOf(Create);
  });

  it('代码里的 throw 也不会中断后面的分镜场', async () => {
    const { rec, plays } = recorder();
    const errors: { sceneId?: string; message: string }[] = [];
    await expect(
      interpret(board([codeScene("throw new Error('boom')", 0), dslCircle()]), rec, (error) =>
        errors.push(error),
      ),
    ).resolves.toBeUndefined();
    expect(errors).toEqual([{ sceneId: 's_code', message: '代码场不归 manim 运行时播' }]);
    expect(plays).toHaveLength(1);
    expect(plays[0]?.[0]).toBeInstanceOf(Create);
  });
});
