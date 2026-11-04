import gsap from 'gsap';
import { resolveColor, resolvePalette } from '../../shared/palette';
import type { Scene, Storyboard } from '../../shared/schema';

/** 舞台坐标系。预览页按容器缩放，时间线仍按这组像素写。 */
export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

export const STAGE_FONT = '"Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * 打包进运行时，避免压缩时把版权声明剪掉。
 * GSAP 3 标准免许可协议：https://gsap.com/standard-license
 */
export const GSAP_LICENSE =
  'GSAP Copyright GreenSock. Subject to the terms at https://gsap.com/standard-license.';

export interface GsapSceneError {
  sceneId?: string;
  message: string;
}

export interface GsapShow {
  duration: number;
  scenes: { id: string; start: number; end: number }[];
  errors: GsapSceneError[];
  seek(t: number): void;
  play(): void;
  pause(): void;
  setRate(rate: number): void;
  time(): number;
  playing(): boolean;
  kill(): void;
}

interface GsapContext {
  theme: {
    primary: string;
    secondary: string;
    accent: string;
    text: string;
    muted: string;
    bg: string;
  };
  sceneId: string;
  title: string;
  hold: number;
  enter: Scene['enter'];
  width: number;
  height: number;
}

type SceneFn = (
  root: HTMLElement,
  gsapApi: typeof gsap,
  tl: gsap.core.Timeline,
  ctx: GsapContext,
) => Promise<unknown>;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function compile(code: string): SceneFn {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => SceneFn;
  return new AsyncFunction('root', 'gsap', 'tl', 'ctx', code);
}

function layer(sceneId: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'awb-layer';
  el.dataset.scene = sceneId;
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.visibility = 'hidden';
  return el;
}

/**
 * 把分镜录成一条暂停的 GSAP 时间线。seek 只改时间，不靠计时器往前推。
 * 每一场是空的图层；上一场在这一场开始的时刻被藏起来，画面上不留残影。
 */
export async function playGsapStoryboard(
  sb: Storyboard,
  stage: HTMLElement,
  opts: { loop?: boolean } = {},
): Promise<GsapShow> {
  const palette = resolvePalette(sb.meta);
  const bg = resolveColor(sb.meta.background, palette);
  const theme = { ...palette, bg };
  stage.replaceChildren();
  stage.style.position = 'relative';
  stage.style.overflow = 'hidden';
  stage.style.background = bg;
  if (stage.clientWidth < 2 || stage.clientHeight < 2) {
    stage.style.width = 'min(100vw, calc(100vh * 16 / 9))';
    stage.style.height = 'min(100vh, calc(100vw * 9 / 16))';
  }

  const canvas = document.createElement('div');
  canvas.id = 'canvas';
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.width = `${STAGE_WIDTH}px`;
  canvas.style.height = `${STAGE_HEIGHT}px`;
  canvas.style.transformOrigin = '0 0';
  canvas.style.background = bg;
  canvas.style.overflow = 'hidden';
  canvas.style.fontFamily = STAGE_FONT;
  canvas.style.color = theme.text;
  stage.appendChild(canvas);

  const fit = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const scale = w >= 2 && h >= 2 ? Math.min(w / STAGE_WIDTH, h / STAGE_HEIGHT) : 1;
    canvas.style.transform = `scale(${scale})`;
  };
  fit();
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit());
  observer?.observe(stage);

  const master = gsap.timeline({ paused: true });
  const errors: GsapSceneError[] = [];
  const spans: { id: string; start: number; end: number }[] = [];
  let cursor = 0;
  const list = sb.scenes;

  for (let i = 0; i < list.length; i++) {
    const scene = list[i]!;
    const source = scene.kind === 'code' && typeof scene.code === 'string' ? scene.code.trim() : '';
    if (!source) {
      errors.push({
        sceneId: scene.id,
        message: scene.kind === 'code' ? '代码场景缺少 code' : 'GSAP 播放只跑代码场景，这一场已跳过',
      });
      const dur = Math.max(0.1, Number.isFinite(scene.hold) ? scene.hold : 0);
      master.set({}, {}, cursor + dur);
      spans.push({ id: scene.id, start: cursor, end: cursor + dur });
      cursor += dur;
      continue;
    }

    const root = layer(scene.id);
    canvas.appendChild(root);
    const tl = gsap.timeline();
    const hold = Number.isFinite(scene.hold) ? Math.max(0, scene.hold) : 0;
    const ctx: GsapContext = {
      theme,
      sceneId: scene.id,
      title: scene.title,
      hold,
      enter: scene.enter,
      width: STAGE_WIDTH,
      height: STAGE_HEIGHT,
    };
    try {
      await compile(source)(root, gsap, tl, ctx);
    } catch (e) {
      errors.push({ sceneId: scene.id, message: errText(e) });
    }
    if (hold > 0) tl.to({}, { duration: hold });
    const dur = Math.max(0.1, tl.duration());
    const end = cursor + dur;
    master.set(root, { autoAlpha: i === 0 ? 1 : 0 }, 0);
    if (i > 0) master.set(root, { autoAlpha: 1 }, cursor);
    master.add(tl, cursor);
    if (i < list.length - 1) master.set(root, { autoAlpha: 0 }, end);
    else master.set({}, {}, end);
    spans.push({ id: scene.id, start: cursor, end });
    cursor = end;
  }

  if (opts.loop && cursor > 0) master.repeat(-1);
  master.pause(0);
  gsap.ticker.sleep();

  const show: GsapShow = {
    duration: cursor,
    scenes: spans,
    errors,
    seek(t) {
      master.seek(Math.max(0, Math.min(t, cursor)), false);
    },
    play() {
      gsap.ticker.wake();
      master.play();
    },
    pause() {
      master.pause();
    },
    setRate(rate) {
      master.timeScale(rate);
    },
    time: () => master.time(),
    playing: () => !master.paused(),
    kill() {
      master.kill();
      observer?.disconnect();
      stage.replaceChildren();
      gsap.ticker.sleep();
    },
  };
  return show;
}
