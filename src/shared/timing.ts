import type { Scene, Storyboard } from './schema';

/** fresh 场景开头淡出上一场景元素的时长 */
export const FRESH_FADE = 0.5;
export const MIN_STEP = 0.1;
const GRID = 0.05;

const snap = (t: number) => Math.round(t / GRID) * GRID;
const round2 = (t: number) => Math.round(t * 100) / 100;

export const fadeOf = (scene: Scene, index: number) =>
  scene.enter === 'fresh' && index > 0 ? FRESH_FADE : 0;
export const stepsDuration = (scene: Scene) => scene.steps.reduce((s, st) => s + st.duration, 0);

/** 场景时长（PLAN §3.1，派生值） */
export const sceneDuration = (scene: Scene, index: number) =>
  round2(fadeOf(scene, index) + stepsDuration(scene) + scene.hold);

export const totalDuration = (sb: Storyboard) =>
  round2(sb.scenes.reduce((s, sc, i) => s + sceneDuration(sc, i), 0));

/**
 * 拖拽把场景时长调到 target，返回新场景。
 * 变长：多出的加到 hold。变短：先从 hold 里扣；hold 不够时 hold 归零，步骤按比例缩放
 * （每步 ≥ 0.1s，按 0.05s 取整），因此结果可能略长于 target。
 */
export function resizeScene(scene: Scene, index: number, target: number): Scene {
  const current = sceneDuration(scene, index);
  if (target >= current - scene.hold) {
    return { ...scene, hold: Math.max(0, round2(snap(scene.hold + target - current))) };
  }
  const steps = stepsDuration(scene);
  const k = Math.max(0, target - fadeOf(scene, index)) / steps;
  return {
    ...scene,
    hold: 0,
    steps: scene.steps.map((st) => ({ ...st, duration: round2(Math.max(MIN_STEP, snap(st.duration * k))) })),
  };
}
