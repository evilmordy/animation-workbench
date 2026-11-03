import { describe, expect, it } from 'vitest';
import { parseStoryboard } from '../../src/shared/schema';
import { validate } from '../../src/shared/validate';
import { ZUGENG_MARKERS, zugeng } from './zugeng';

describe('祖暅 kind:code 夹具', () => {
  it('是合法 v1 分镜，四场都是 code', () => {
    expect(parseStoryboard(zugeng).ok).toBe(true);
    expect(validate(zugeng)).toEqual([]);
    expect(zugeng.scenes.map((s) => s.kind)).toEqual(['code', 'code', 'code', 'code']);
    expect(zugeng.scenes.map((s) => s.id)).toEqual(ZUGENG_MARKERS.map((s) => s.id));
    expect(
      zugeng.scenes.every((s) => s.enter === 'fresh' && s.elements.length === 0 && s.steps.length === 0),
    ).toBe(true);
  });

  it('全片共用同一 R，而且录制代码里没有 scene.add', () => {
    const rs = zugeng.scenes.map((s) => s.code?.match(/const R = ([0-9.]+);/)?.[1]);
    const left = zugeng.scenes.map((s) => s.code?.match(/const LEFT = ([0-9.-]+);/)?.[1]);
    const right = zugeng.scenes.map((s) => s.code?.match(/const RIGHT = ([0-9.-]+);/)?.[1]);
    const base = zugeng.scenes.map((s) => s.code?.match(/const BASE = ([0-9.-]+);/)?.[1]);
    expect(new Set(rs)).toEqual(new Set(['1.6']));
    expect(new Set(left)).toEqual(new Set(['-3.2']));
    expect(new Set(right)).toEqual(new Set(['3.2']));
    expect(new Set(base)).toEqual(new Set(['-2.0']));
    for (const s of zugeng.scenes) {
      expect(s.code).toBeTruthy();
      expect(s.code).not.toMatch(/scene\.add\s*\(/);
    }
    for (const s of zugeng.scenes.slice(1)) expect(s.code).toContain('ctx.present()');
  });
});
