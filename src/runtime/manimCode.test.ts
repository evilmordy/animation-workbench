import { describe, expect, it } from 'vitest';
import { isManimSceneCode } from './manimCode';

describe('拒绝 (scene, M, ctx)', () => {
  it('认 scene.play、M.Circle 和 ctx.present，不认 anime 场', () => {
    expect(isManimSceneCode('await scene.play(new M.Create(circle, { duration: 1 }))')).toBe(true);
    expect(isManimSceneCode('const circle = new M.Circle({ radius: 1.2 });')).toBe(true);
    expect(isManimSceneCode('ctx.present()')).toBe(true);
    expect(
      isManimSceneCode(
        'const el = document.createElement("div");\nroot.appendChild(el);\ntl.add(el, { opacity: [0, 1], duration: 200 }, 0);\n',
      ),
    ).toBe(false);
    expect(isManimSceneCode('')).toBe(false);
  });
});
