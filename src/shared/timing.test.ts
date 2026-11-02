import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/pythagoras.json';
import type { Scene, Storyboard } from './schema';
import { resizeScene, sceneDuration, totalDuration } from './timing';

const sb = fixture as Storyboard;
const s0 = sb.scenes[0]!; // 步骤 2 + 1.5，hold 1，共 4.5

describe('时长', () => {
  it('附录 A：4.5 + 5.5 + 7 = 17', () => {
    expect(sb.scenes.map(sceneDuration)).toEqual([4.5, 5.5, 7]);
    expect(totalDuration(sb)).toBe(17);
  });

  it('fresh 场景（非第一个）加 0.5s 转场', () => {
    const fresh: Scene = { ...sb.scenes[1]!, enter: 'fresh' };
    expect(sceneDuration(fresh, 1)).toBe(6);
    expect(sceneDuration({ ...s0, enter: 'fresh' }, 0)).toBe(4.5);
  });

  it('伸长：多出的时间加到 hold', () => {
    const r = resizeScene(s0, 0, 6.3);
    expect(r.hold).toBe(2.8);
    expect(r.steps).toEqual(s0.steps);
    expect(sceneDuration(r, 0)).toBe(6.3);
  });

  it('缩短但 hold 够扣：只减 hold', () => {
    const r = resizeScene(s0, 0, 4);
    expect(r.hold).toBe(0.5);
    expect(r.steps).toEqual(s0.steps);
  });

  it('缩短超过 hold：hold 归零，步骤按比例缩放并按 0.05 取整', () => {
    const r = resizeScene(s0, 0, 1.75); // 步骤 3.5 → 1.75，比例 0.5
    expect(r.hold).toBe(0);
    expect(r.steps.map((s) => s.duration)).toEqual([1, 0.75]);
    expect(sceneDuration(r, 0)).toBe(1.75);
  });

  it('缩到最小值：每步不少于 0.1s', () => {
    const r = resizeScene(s0, 0, 0.05);
    expect(r.steps.map((s) => s.duration)).toEqual([0.1, 0.1]);
    expect(r.hold).toBe(0);
  });

  it('fresh 场景缩短时扣除转场时间', () => {
    const fresh: Scene = { ...s0, enter: 'fresh' }; // 0.5 + 3.5 + 1 = 5
    const r = resizeScene(fresh, 1, 2.25);
    expect(r.steps.map((s) => s.duration)).toEqual([1, 0.75]);
  });
});
