import { onLog, Player, setKatexStylesheetUrl, setMathJaxScriptUrl } from 'manim-web';
import { resolveColor, resolvePalette } from '../shared/palette';
import { HostMessage, type PreviewMessage, type SceneSpan } from '../shared/protocol';
import { parseStoryboard, type Storyboard } from '../shared/schema';
import { sceneDuration } from '../shared/timing';
import { applyHostCodeSceneFlag } from './codeScene';
import { interpret, type RuntimeError } from './interpret';

export { runtimeFlags } from './codeScene';

// 禁用 manim-web 内置的 CDN 回退：离线失败要暴露成错误，而不是悄悄联网
setKatexStylesheetUrl(null);
setMathJaxScriptUrl(null);

export const RUNTIME_VERSION = '1.0.0';
export const MANIM_WEB_VERSION = __MANIM_WEB_VERSION__;

const ASPECT = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 } as const;
const FRAME_H = 8;

export interface BuildOptions {
  controls: boolean;
  slidesMode?: boolean;
  loop?: boolean;
  onError: (e: RuntimeError) => void;
}

export interface Built {
  player: Player;
  aspect: Storyboard['meta']['aspect'];
  scenes: SceneSpan[];
  duration: number;
  buildMs: number;
}

/**
 * 构建（或在同一个 Player 上重建）动画。reuse 给出时复用它：省掉 WebGL 上下文的创建，
 * 这是编辑后重建里最贵的一步。画面比例变化时必须新建（帧尺寸在构造时确定）。
 */
export async function build(
  sb: Storyboard,
  container: HTMLElement,
  opts: BuildOptions,
  reuse?: Player,
): Promise<Built> {
  applyHostCodeSceneFlag();
  const t0 = performance.now();
  const aspect = ASPECT[sb.meta.aspect];
  const background = resolveColor(sb.meta.background, resolvePalette(sb.meta));
  let player: Player;
  if (reuse) {
    player = reuse;
    player.pause();
    player.scene.clear({ render: false });
    player.scene.backgroundColor = background;
  } else {
    container.style.aspectRatio = String(aspect);
    container.style.width = `min(100vw, ${(100 * aspect).toFixed(3)}vh)`;
    player = new Player(container, {
      frameWidth: FRAME_H * aspect,
      frameHeight: FRAME_H,
      backgroundColor: background,
      allowExport: opts.controls,
      allowFullscreen: opts.controls,
      slidesMode: opts.slidesMode ?? false,
      loop: opts.loop ?? false,
    });
  }
  await player.sequence((rec) => interpret(sb, rec, opts.onError));
  const slides = player.timeline.getSlides();
  // 每个分镜场景都应对应一个 slide；空场景等情况对不上时退回按 schema 计算的时长
  let acc = 0;
  const scenes = sb.scenes.map((s, i) => {
    const slide = slides.length === sb.scenes.length ? slides[i] : undefined;
    const start = slide?.startTime ?? acc;
    const end = slide?.endTime ?? acc + sceneDuration(s, i);
    acc = end;
    return { id: s.id, start, end };
  });
  return {
    player,
    aspect: sb.meta.aspect,
    scenes,
    duration: player.timeline.getDuration(),
    buildMs: Math.round(performance.now() - t0),
  };
}

// ---------- 页面入口 ----------

const stage = document.getElementById('stage');
const embedded = document.getElementById('awb-storyboard');

if (stage && embedded) {
  // 导出的独立 HTML：保留 Player 自带控件
  const sb = parseStoryboard(JSON.parse(embedded.textContent ?? 'null'));
  if (sb.ok) {
    void build(sb.value, stage, {
      controls: true,
      slidesMode: embedded.dataset.slides === 'true',
      loop: embedded.dataset.loop === 'true',
      onError: (e) => console.error(e.message),
    }).then((b) => {
      // 供自动化测试检查导出文件是否正常加载
      Object.assign(window, {
        __awbExport: {
          scenes: b.scenes,
          duration: b.duration,
          seek: (t: number) => b.player.seek(t),
          objects: () =>
            [...b.player.scene.mobjects].map((m) => {
              const tag = (m as { awbTag?: unknown }).awbTag;
              return { tag: typeof tag === 'string' ? tag : '', opacity: m.opacity };
            }),
        },
      });
    });
  } else console.error('分镜数据损坏', sb.issues);
} else if (stage && window.parent !== window) {
  startPreview(stage);
}

function startPreview(stage: HTMLElement) {
  const post = (m: PreviewMessage) => window.parent.postMessage(m, '*');
  const hideBar = document.createElement('style');
  hideBar.textContent = '[data-player-bar]{display:none!important}';
  document.head.append(hideBar);

  let current: Built | null = null;
  let lastT = -1;
  // 加载串行执行，排队期间只保留最新的一次（复用 Player 时不能并发重建）
  let queued: { data: unknown; startAt?: number } | null = null;
  let busy = false;

  onLog((e) => {
    if (e.level === 'warn' || e.level === 'error') post({ type: 'log', level: e.level, message: e.message });
  });
  window.addEventListener('error', (e) => post({ type: 'error', message: e.message }));
  window.addEventListener('unhandledrejection', (e) => post({ type: 'error', message: String(e.reason) }));

  async function requestLoad(data: unknown, startAt?: number) {
    queued = { data, startAt };
    if (busy) return;
    busy = true;
    try {
      while (queued) {
        const next: { data: unknown; startAt?: number } = queued;
        queued = null;
        await load(next.data, next.startAt).catch((err) => post({ type: 'error', message: String(err) }));
      }
    } finally {
      busy = false;
    }
  }

  async function load(data: unknown, startAt?: number) {
    const parsed = parseStoryboard(data);
    if (!parsed.ok) {
      const i = parsed.issues[0]!;
      post({ type: 'error', message: `分镜结构错误：${i.path} ${i.message}` });
      return;
    }
    const reuse = current && current.aspect === parsed.value.meta.aspect ? current.player : undefined;
    if (!reuse) {
      current?.player.dispose();
      stage.replaceChildren();
    }
    current = null;
    const built = await build(
      parsed.value,
      stage,
      { controls: false, onError: (e) => post({ type: 'error', ...e }) },
      reuse,
    );
    current = built;
    if (startAt) built.player.seek(Math.min(startAt, built.duration));
    post({ type: 'loaded', duration: built.duration, scenes: built.scenes, buildMs: built.buildMs });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const m = HostMessage.safeParse(e.data);
    if (!m.success) return;
    const p = current?.player;
    switch (m.data.type) {
      case 'load':
        void requestLoad(m.data.storyboard, m.data.startAt);
        break;
      case 'play':
        if (p && p.timeline.getCurrentTime() >= current!.duration - 1e-3) p.seek(0);
        p?.play();
        break;
      case 'pause':
        p?.pause();
        break;
      case 'seek':
        p?.seek(Math.max(0, Math.min(m.data.t, current?.duration ?? 0)));
        break;
      case 'setRate':
        p?.setPlaybackRate(m.data.rate);
        break;
    }
  });

  // 时间同步最多每秒 15 次，只在变化时发送
  setInterval(() => {
    if (!current) return;
    const t = current.player.timeline.getCurrentTime();
    if (t === lastT && !current.player.isPlaying) return;
    lastT = t;
    post({ type: 'time', t, playing: current.player.isPlaying });
  }, 1000 / 15);
  setInterval(() => post({ type: 'heartbeat' }), 1000);

  post({
    type: 'ready',
    runtimeVersion: RUNTIME_VERSION,
    manimWebVersion: MANIM_WEB_VERSION,
    caps: { webcodecs: typeof VideoEncoder !== 'undefined' },
  });
}
