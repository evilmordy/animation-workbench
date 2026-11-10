import { animate, createTimeline, stagger, utils, type Timeline } from 'animejs';
import { resolveColor, resolvePalette } from '../../shared/palette';
import type { Scene, Storyboard } from '../../shared/schema';
import { AWB_BINDS, wrapSceneCode } from './awb';

/** 舞台坐标系。预览页按容器缩放，时间线仍按这组像素写。 */
export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

export const STAGE_FONT = '"Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

/** 传给场景代码的 anime。只有 v4 这几个入口，没有 v3 的 anime()。 */
export const animeApi = { createTimeline, animate, stagger, utils };

export type AnimeApi = typeof animeApi;

export interface HtmlSceneError {
  sceneId?: string;
  message: string;
}

export interface HtmlShow {
  duration: number;
  scenes: { id: string; start: number; end: number }[];
  errors: HtmlSceneError[];
  seek(t: number): void;
  play(): void;
  pause(): void;
  setRate(rate: number): void;
  time(): number;
  playing(): boolean;
  kill(): void;
}

interface HtmlContext {
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

type SceneFn = (root: HTMLElement, anime: AnimeApi, tl: Timeline, ctx: HtmlContext) => Promise<unknown>;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function compile(code: string): SceneFn {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => SceneFn;
  // helper 在块外。场景里再写 const W 只会遮蔽。注入源码会包一层 tl.add，和 tw 共用 _seen。
  return new AsyncFunction('root', 'anime', 'tl', 'ctx', wrapSceneCode(code));
}

function bindsOf(root: HTMLElement): Array<() => void> {
  const value = (root as HTMLElement & Record<string, unknown>)[AWB_BINDS];
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'function') as Array<() => void>;
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

interface Span {
  id: string;
  startMs: number;
  endMs: number;
  last: boolean;
  root?: HTMLElement;
  binds: Array<() => void>;
}

/**
 * 把分镜录成一条暂停的 anime.js 时间线。对外的秒和预览协议一致，时间线内部是毫秒。
 * seek 只改当前时间。每一场是空图层，上一场在这一场开始的时刻被藏起来。
 */
export async function playHtmlStoryboard(
  sb: Storyboard,
  stage: HTMLElement,
  opts: { loop?: boolean } = {},
): Promise<HtmlShow> {
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

  const master = createTimeline({ autoplay: false, loop: opts.loop ? true : 0 });
  const errors: HtmlSceneError[] = [];
  const spans: Span[] = [];
  let cursor = 0;
  const list = sb.scenes;

  for (let i = 0; i < list.length; i++) {
    const scene = list[i]!;
    const source = scene.kind === 'code' && typeof scene.code === 'string' ? scene.code.trim() : '';
    const holdMs = (Number.isFinite(scene.hold) ? Math.max(0, scene.hold) : 0) * 1000;
    if (!source) {
      errors.push({
        sceneId: scene.id,
        message: scene.kind === 'code' ? '代码场景缺少 code' : 'HTML 播放只跑代码场景，这一场已跳过',
      });
      const dur = Math.max(100, holdMs);
      master.add({ duration: dur }, cursor);
      spans.push({
        id: scene.id,
        startMs: cursor,
        endMs: cursor + dur,
        last: i === list.length - 1,
        binds: [],
      });
      cursor += dur;
      continue;
    }

    const root = layer(scene.id);
    canvas.appendChild(root);
    const tl = createTimeline({
      autoplay: false,
      defaults: { duration: 800, ease: 'inOutQuad' },
    });
    const ctx: HtmlContext = {
      theme,
      sceneId: scene.id,
      title: scene.title,
      hold: Number.isFinite(scene.hold) ? Math.max(0, scene.hold) : 0,
      enter: scene.enter,
      width: STAGE_WIDTH,
      height: STAGE_HEIGHT,
    };
    // 场代码会换掉 tl.add。hold 和最短时长仍走原来的 add，避免被场景里的包装改掉。
    const addTail = tl.add.bind(tl);
    try {
      await compile(source)(root, animeApi, tl, ctx);
    } catch (e) {
      errors.push({ sceneId: scene.id, message: errText(e) });
    }
    const binds = bindsOf(root);
    if (holdMs > 0) addTail({ duration: holdMs });
    let dur = tl.duration;
    if (dur < 100) {
      addTail({ duration: 100 - dur });
      dur = tl.duration;
    }
    master.sync(tl, cursor);
    spans.push({
      id: scene.id,
      startMs: cursor,
      endMs: cursor + dur,
      last: i === list.length - 1,
      root,
      binds,
    });
    cursor += dur;
  }

  const applyFrame = (ms: number) => {
    for (const span of spans) {
      if (!span.root) continue;
      const on = ms >= span.startMs && (span.last ? ms <= span.endMs : ms < span.endMs);
      span.root.style.visibility = on ? 'visible' : 'hidden';
      if (!on) continue;
      for (const draw of span.binds) draw();
    }
  };

  master.pause();
  master.seek(0, true);
  applyFrame(0);
  master.onUpdate = () => applyFrame(master.currentTime);

  const show: HtmlShow = {
    duration: cursor / 1000,
    scenes: spans.map((span) => ({ id: span.id, start: span.startMs / 1000, end: span.endMs / 1000 })),
    errors,
    seek(t) {
      const ms = Math.max(0, Math.min(t * 1000, cursor));
      master.seek(ms, true);
      applyFrame(ms);
    },
    play() {
      master.play();
    },
    pause() {
      master.pause();
    },
    setRate(rate) {
      master.speed = rate;
    },
    time: () => master.currentTime / 1000,
    playing: () => !master.paused,
    kill() {
      master.cancel();
      observer?.disconnect();
      stage.replaceChildren();
    },
  };
  return show;
}
