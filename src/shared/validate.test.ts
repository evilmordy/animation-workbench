import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/pythagoras.json';
import { isSafeExpr, validate, type Issue } from './validate';

const clone = (): any => structuredClone(fixture);
const run = (mutate: (d: any) => void) => {
  const d = clone();
  mutate(d);
  return validate(d);
};
const pick = (issues: Issue[], code: string) => issues.filter((i) => i.code === code);
const play = (id: string, anims: any[], duration = 1) => ({ id, kind: 'play', anims, duration });

describe('validate', () => {
  it('附录 A 没有任何问题', () => {
    expect(validate(fixture)).toEqual([]);
  });

  it('V1：结构错误时只返回 V1', () => {
    const r = run((d) => (d.scenes[0].hold = 'x'));
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((i) => i.code === 'V1' && i.level === 'error')).toBe(true);
  });

  describe('V2 id 唯一', () => {
    it('场景 id 重复', () => {
      const r = run((d) => (d.scenes[1].id = d.scenes[0].id));
      expect(pick(r, 'V2')).toMatchObject([{ path: 'scenes[1].id', level: 'error' }]);
    });
    it('本场景元素 id 重复', () => {
      const r = run((d) => (d.scenes[0].elements[1].id = 'tri'));
      expect(pick(r, 'V2')).toMatchObject([{ path: 'scenes[0].elements[1].id' }]);
    });
    it('与继承的在场元素重复', () => {
      const r = run((d) => d.scenes[2].elements.push({ id: 'sa', type: 'Dot', props: {} }));
      expect(pick(r, 'V2')).toMatchObject([{ path: 'scenes[2].elements[1].id' }]);
    });
    it('正例：已离场元素的 id 可以在后续场景重新使用', () => {
      const r = run((d) => {
        d.scenes[2].elements.push({ id: 'la', type: 'Dot', props: {} });
        d.scenes[2].steps.push(play('st_x', [{ type: 'FadeIn', target: 'la' }]));
      });
      expect(r).toEqual([]);
    });
  });

  describe('V3 引用存在', () => {
    it('动画 target 不存在', () => {
      const r = run((d) => (d.scenes[0].steps[0].anims[0].target = 'nope'));
      expect(pick(r, 'V3')).toMatchObject([{ path: 'scenes[0].steps[0].anims[0].target' }]);
    });
    it('nextTo、Brace、Group、axes 的引用', () => {
      const r = run((d) => {
        d.scenes[0].elements[1].place.nextTo.id = 'ghost';
        d.scenes[0].elements.push(
          { id: 'br', type: 'Brace', props: { target: 'ghost' } },
          { id: 'g', type: 'Group', props: { children: ['tri', 'ghost'] } },
          { id: 'fg', type: 'FunctionGraph', props: { expr: 'x', axes: 'ghost' } },
        );
      });
      expect(pick(r, 'V3').map((i) => i.path)).toEqual([
        'scenes[0].elements[1].place.nextTo.id',
        'scenes[0].elements[4].props.target',
        'scenes[0].elements[5].props.children[1]',
        'scenes[0].elements[6].props.axes',
      ]);
    });
    it('fresh 场景不能引用上一场景的元素', () => {
      const r = run((d) => (d.scenes[2].enter = 'fresh'));
      expect(pick(r, 'V3').length).toBeGreaterThan(0);
    });
  });

  describe('V4 生命周期', () => {
    it('对在场元素再次出场', () => {
      const r = run((d) => d.scenes[0].steps.push(play('st_x', [{ type: 'Create', target: 'tri' }])));
      expect(pick(r, 'V4')).toMatchObject([{ path: 'scenes[0].steps[2].anims[0].target' }]);
    });
    it('对不在场元素使用强调', () => {
      const r = run((d) => d.scenes[1].steps.push(play('st_x', [{ type: 'Indicate', target: 'la' }])));
      expect(pick(r, 'V4')).toMatchObject([{ path: 'scenes[1].steps[3].anims[0].target' }]);
    });
    it('同一步里并行：出场和强调同一元素', () => {
      const r = run((d) => d.scenes[0].steps[0].anims.push({ type: 'Indicate', target: 'tri' }));
      expect(pick(r, 'V4')).toHaveLength(1);
    });
    it('Transform：target 离场，to 必须不在场', () => {
      const ok = run((d) => {
        d.scenes[2].elements.push({ id: 'eq2', type: 'MathTex', props: { latex: 'c^2' } });
        d.scenes[2].steps.push(play('st_x', [{ type: 'Transform', target: 'eq', to: 'eq2' }]));
        d.scenes[2].steps.push(play('st_y', [{ type: 'Indicate', target: 'eq2' }]));
      });
      expect(ok).toEqual([]);
      const bad = run((d) =>
        d.scenes[2].steps.push(play('st_x', [{ type: 'Transform', target: 'eq', to: 'sa' }])),
      );
      expect(pick(bad, 'V4')).toMatchObject([{ path: 'scenes[2].steps[4].anims[0].to' }]);
    });
    it('正例：Group 出场后子元素也在场', () => {
      const r = run((d) => {
        d.scenes[0].elements.push(
          { id: 'd1', type: 'Dot', props: {} },
          { id: 'g', type: 'Group', props: { children: ['d1'] } },
        );
        d.scenes[0].steps.push(
          play('st_x', [{ type: 'FadeIn', target: 'g' }]),
          play('st_y', [{ type: 'Indicate', target: 'd1' }]),
        );
      });
      expect(r).toEqual([]);
    });
  });

  describe('V5 时长', () => {
    it('步骤、wait、hold 的范围', () => {
      const r = run((d) => {
        d.scenes[0].steps[0].duration = 0.05;
        d.scenes[0].steps.push({ id: 'w', kind: 'wait', duration: 0 });
        d.scenes[0].hold = 31;
      });
      expect(pick(r, 'V5').map((i) => i.path)).toEqual(['scenes[0].steps[0].duration', 'scenes[0].hold']);
    });
    it('单场景超过 120s', () => {
      const r = run((d) => {
        for (let i = 0; i < 5; i++) d.scenes[0].steps.push({ id: `w${i}`, kind: 'wait', duration: 25 });
      });
      expect(pick(r, 'V5')).toMatchObject([{ path: 'scenes[0]' }]);
    });
    it('整个项目超过 600s', () => {
      const r = run((d) => {
        for (let i = 0; i < 25; i++)
          d.scenes.push({ ...structuredClone(d.scenes[0]), id: `s_x${i}`, hold: 25 });
      });
      expect(pick(r, 'V5')).toMatchObject([{ path: 'scenes', level: 'error' }]);
    });
  });

  it('V6 坐标出界是警告', () => {
    const r = run((d) => {
      d.scenes[0].elements[0].props.points[0] = [-8, 0];
      d.scenes[0].elements[3].place.at = [0, 3.9];
    });
    expect(r).toMatchObject([
      { code: 'V6', level: 'warning', path: 'scenes[0].elements[0].props.points[0]' },
    ]);
  });

  it('V7 文字长度和公式里的中文', () => {
    const r = run((d) => {
      d.scenes[0].elements.push({ id: 't', type: 'Text', props: { text: '字'.repeat(201) } });
      d.scenes[0].elements[1].props.latex = 'a \\text{边}';
      d.scenes[0].elements[2].props.latex = 'b'.repeat(301);
    });
    expect(pick(r, 'V7').map((i) => [i.level, i.path])).toEqual([
      ['warning', 'scenes[0].elements[1].props.latex'],
      ['error', 'scenes[0].elements[2].props.latex'],
      ['error', 'scenes[0].elements[4].props.text'],
    ]);
  });

  it('V8 表达式白名单', () => {
    for (const ok of ['Math.sin(x)*2', 'Math.pow(x, 2) + 0.5', '-x % 3', '1e-3*x', 'Math.E', '.5*x']) {
      expect(isSafeExpr(ok), ok).toBe(true);
    }
    for (const bad of [
      'alert(1)',
      'x.constructor',
      'Math.random()',
      'window',
      'x;1',
      '`${x}`',
      'Math.sinh(x)',
      'xx',
      '[x]',
    ]) {
      expect(isSafeExpr(bad), bad).toBe(false);
    }
    const r = run((d) =>
      d.scenes[0].elements.push({ id: 'f', type: 'FunctionGraph', props: { expr: 'fetch(x)' } }),
    );
    expect(pick(r, 'V8')).toMatchObject([{ level: 'error', path: 'scenes[0].elements[4].props.expr' }]);
  });
});
