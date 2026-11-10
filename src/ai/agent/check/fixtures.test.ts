import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from './pixels';
import { checkScenes } from './index';

interface FixtureScene {
  id: string;
  tMs: number;
  width: number;
  height: number;
  truncated: boolean;
  boxes: LayoutBox[];
}

interface FixtureFilm {
  name: string;
  scenes: FixtureScene[];
}

const films = JSON.parse(
  readFileSync(new URL('./fixtures/layout-boxes.json', import.meta.url), 'utf8'),
) as FixtureFilm[];

describe('手写和 D/线代的布局框', () => {
  it('五题手写没有 blocker，D/线代网格线不再出界', () => {
    expect(films.map((film) => film.name)).toEqual([
      'hand/zugeng',
      'hand/linalg',
      'hand/mergesort',
      'hand/transform',
      'hand/psych',
      'D/linalg',
    ]);
    const truncated: string[] = [];
    for (const film of films) {
      const issues = checkScenes(
        film.scenes.map((scene) => ({
          id: scene.id,
          width: scene.width,
          height: scene.height,
          frames: [
            {
              tMs: scene.tMs,
              boxes: scene.boxes,
              ...(scene.truncated ? { truncated: true } : {}),
            },
          ],
        })),
      );
      expect(
        issues.filter((issue) => issue.severity === 'blocker'),
        film.name,
      ).toEqual([]);
      expect(
        issues.filter((issue) => issue.kind.startsWith('LAYOUT')),
        film.name,
      ).toEqual([]);
      for (const scene of film.scenes) {
        if (scene.truncated) truncated.push(`${film.name}/${scene.id}`);
      }
    }
    // 这三场可见框超过 40。截断只出现在 checkLayout 的摘要里，不产生 Issue。
    expect(truncated).toEqual(['hand/linalg/l_basis', 'hand/linalg/l_det', 'hand/transform/t_interp']);
  });
});
