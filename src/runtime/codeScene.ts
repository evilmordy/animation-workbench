import type { Player } from 'manim-web';
import * as Manim from 'manim-web';
import type { Palette } from '../shared/palette';
import type { Scene } from '../shared/schema';

type RecordingScene = Parameters<Parameters<Player['sequence']>[0]>[0];

/**
 * 产品开关 `runtime.codeScenes`。
 * 默认 false：kind:code 仍按 v1 跳过（报错 + wait），预览 / 导出 / 专家 JSON 的可感知行为不变。
 * 本 PR 不接 UI。测试夹具把 `runtimeFlags.codeScenes` 设为 true 后再执行 scene.code。
 */
export const runtimeFlags = {
  codeScenes: false,
};

/** 传给场景代码的第三个参数。theme 是已经解析好的调色板。 */
export interface CodeSceneContext {
  theme: Palette;
  sceneId: string;
  title: string;
  enter: Scene['enter'];
  hold: number;
}

type CodeFn = (scene: RecordingScene, M: typeof Manim, ctx: CodeSceneContext) => Promise<unknown>;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function compileCode(code: string): CodeFn {
  // 函数体契约：async (scene, M, ctx) => { … }。scene 是 Player.sequence 的录制代理。
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => CodeFn;
  return new AsyncFunction('scene', 'M', 'ctx', code);
}

async function skip(
  scene: Scene,
  rec: RecordingScene,
  onError: (e: { sceneId?: string; message: string }) => void,
) {
  onError({ sceneId: scene.id, message: '代码场景暂不支持，已跳过' });
  await rec.wait(Math.max(0.1, scene.hold));
}

/**
 * 执行 kind:code 场景。失败只上报 onError，不把异常抛出 sequence，避免整片中断。
 * flag 关闭时与 v1 的跳过行为一致，不会编译或执行 scene.code。
 */
export async function interpretCode(
  scene: Scene,
  rec: RecordingScene,
  theme: Palette,
  onError: (e: { sceneId?: string; message: string }) => void,
): Promise<void> {
  if (!runtimeFlags.codeScenes) {
    await skip(scene, rec, onError);
    return;
  }

  const source = typeof scene.code === 'string' ? scene.code.trim() : '';
  if (!source) {
    onError({ sceneId: scene.id, message: '代码场景缺少 code' });
    await rec.wait(Math.max(0.1, scene.hold));
    return;
  }

  const ctx: CodeSceneContext = {
    theme,
    sceneId: scene.id,
    title: scene.title,
    enter: scene.enter,
    hold: scene.hold,
  };
  try {
    await compileCode(source)(rec, Manim, ctx);
    if (scene.hold > 0) await rec.wait(scene.hold);
  } catch (e) {
    onError({ sceneId: scene.id, message: errText(e) });
    try {
      await rec.wait(Math.max(0.1, scene.hold));
    } catch (waitErr) {
      onError({ sceneId: scene.id, message: errText(waitErr) });
    }
  }
}
