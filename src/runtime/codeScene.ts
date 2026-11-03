import type { Mobject, Player } from 'manim-web';
import * as Manim from 'manim-web';
import type { Palette } from '../shared/palette';
import type { Scene } from '../shared/schema';

type RecordingScene = Parameters<Parameters<Player['sequence']>[0]>[0];

/**
 * 产品开关 `runtime.codeScenes`。
 * 默认 false：kind:code 仍按 v1 跳过（报错 + wait），预览 / 导出 / 专家 JSON 的可感知行为不变。
 * 宿主设置和带 `?codeScenes=1` / `data-code-scenes="1"` 的页面可以在构建前把它打开。
 * 测试夹具也可以直接改这个对象。
 */
export const runtimeFlags = {
  codeScenes: false,
};

/**
 * 预览地址 `?codeScenes=1` 或导出页 `data-code-scenes="1"` 时打开开关。
 * 不会把它关回去，所以测试里预先设好的 true 仍然有效。
 */
export function applyHostCodeSceneFlag(doc: Document | undefined = globalThis.document, href?: string): void {
  if (runtimeFlags.codeScenes) return;
  const search = href ?? (typeof location === 'undefined' ? '' : location.search);
  const fromQuery = new URLSearchParams(search).get('codeScenes') === '1';
  const fromExport = doc?.getElementById('awb-storyboard')?.getAttribute('data-code-scenes') === '1';
  if (fromQuery || fromExport) runtimeFlags.codeScenes = true;
}

/** 录制代理背后的真实场景。TypeScript 的 private 在运行时仍是普通字段。 */
function liveMobjects(rec: RecordingScene): Mobject[] {
  const real = (rec as unknown as { _realScene?: { mobjects?: Iterable<Mobject> } })._realScene;
  return real?.mobjects ? [...real.mobjects] : [];
}

/** 传给场景代码的第三个参数。theme 是已经解析好的调色板。 */
export interface CodeSceneContext {
  theme: Palette;
  sceneId: string;
  title: string;
  enter: Scene['enter'];
  hold: number;
  /**
   * 此刻仍在场景图里的对象。enter:fresh 的场应先把它们 FadeOut。
   * 不要 scene.add：对象会进场景但不进时间线，seek 之后全片都看得见。
   */
  present: () => Mobject[];
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
    present: () => liveMobjects(rec),
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
