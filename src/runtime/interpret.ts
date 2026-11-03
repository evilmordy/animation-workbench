import { FadeOut, LaggedStart, type Mobject, type Player } from 'manim-web';
import { resolvePalette } from '../shared/palette';
import { ANIMS } from '../shared/registry';
import type { Scene, Storyboard } from '../shared/schema';
import { FRESH_FADE } from '../shared/timing';
import { BuildError, buildAnim, buildElement, type BuildCtx } from './builders';
import { interpretCode } from './codeScene';

type RecordingScene = Parameters<Parameters<Player['sequence']>[0]>[0];

export interface RuntimeError {
  sceneId?: string;
  elementId?: string;
  message: string;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * 把分镜录制进 Player.sequence。每个分镜场景是一个 slide；fresh 场景先用 0.5s 淡出在场元素。
 * 出错的元素/动画会被跳过并上报，保证其余部分仍可预览。
 */
export async function interpret(sb: Storyboard, rec: RecordingScene, onError: (e: RuntimeError) => void) {
  const palette = resolvePalette(sb.meta);
  let present = new Map<string, Mobject>();

  for (const [si, scene] of sb.scenes.entries()) {
    if (si > 0) await rec.nextSlide();
    // kind:code 旁路。flag 默认关时 interpretCode 仍按 v1 跳过；下面的 dsl 路径保持原样。
    if (scene.kind === 'code') {
      await interpretCode(scene, rec, palette, onError);
      continue;
    }
    if (scene.kind !== 'dsl') {
      onError({ sceneId: scene.id, message: '代码场景暂不支持，已跳过' });
      await rec.wait(Math.max(0.1, scene.hold));
      continue;
    }
    if (scene.enter === 'fresh' && si > 0) {
      const outs = [...present.values()].map((m) => new FadeOut(m, { duration: FRESH_FADE }));
      if (outs.length) await rec.play(...outs);
      else await rec.wait(FRESH_FADE);
      present = new Map();
    }
    present = await playScene(scene, rec, { palette, mobs: new Map(present) }, present, onError);
  }
}

async function playScene(
  scene: Scene,
  rec: RecordingScene,
  ctx: BuildCtx,
  inherited: Map<string, Mobject>,
  onError: (e: RuntimeError) => void,
): Promise<Map<string, Mobject>> {
  const fail = (e: unknown, elementId?: string) =>
    onError({
      sceneId: scene.id,
      elementId: e instanceof BuildError ? (e.elementId ?? elementId) : elementId,
      message: errText(e),
    });

  for (const el of scene.elements) {
    try {
      ctx.mobs.set(el.id, await buildElement(el, ctx));
    } catch (e) {
      fail(e, el.id);
    }
  }

  const live = new Map(inherited);
  for (const step of scene.steps) {
    if (step.kind === 'wait') {
      await rec.wait(step.duration);
      continue;
    }
    const n = step.anims.length;
    const lag = n > 1 ? (step.lag ?? 0) : 0;
    // LaggedStart 中相邻动画错开 lag×单个时长，换算后整步总时长仍等于 step.duration
    const each = step.duration / (1 + lag * (n - 1));
    const anims = [];
    for (const a of step.anims) {
      try {
        anims.push(buildAnim(a, ctx, each, step.rate));
        const lc = ANIMS[a.type].lifecycle;
        if (lc === 'exit' || lc === 'transform') live.delete(a.target);
        if (lc === 'enter') live.set(a.target, ctx.mobs.get(a.target)!);
        if (lc === 'transform' && a.to) live.set(a.to, ctx.mobs.get(a.to)!);
      } catch (e) {
        fail(e, a.target);
      }
    }
    try {
      if (!anims.length) await rec.wait(step.duration);
      else if (lag > 0) await rec.play(new LaggedStart(anims, { lagRatio: lag }));
      else await rec.play(...anims);
    } catch (e) {
      fail(e);
    }
  }
  if (scene.hold > 0) await rec.wait(scene.hold);
  return live;
}
