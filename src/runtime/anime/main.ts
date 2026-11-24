import { HostMessage, type PreviewMessage, type SceneSpan } from '../../shared/protocol';
import { parseStoryboard } from '../../shared/schema';
import { collectStageElements, spikeRaster } from './domProbe';
import { hitAt } from './pick';
import { playHtmlStoryboard, type HtmlShow } from './player';

const RUNTIME_VERSION = '1.0.0';

interface HtmlPage {
  __ready?: boolean;
  __run?: (storyboard: unknown) => Promise<{
    duration: number;
    scenes: SceneSpan[];
    errors: { sceneId?: string; message: string }[];
    buildMs: number;
  }>;
  __seek?: (t: number) => void;
  __play?: () => void;
  __pause?: () => void;
  __awbExport?: {
    scenes: SceneSpan[];
    duration: number;
    seek: (t: number) => void;
    time: () => number;
  };
}

const page = window as Window & HtmlPage;

const stage = document.getElementById('stage');
const embedded = document.getElementById('awb-storyboard');

function spansOf(show: HtmlShow): SceneSpan[] {
  return show.scenes.map((scene) => ({ id: scene.id, start: scene.start, end: scene.end }));
}

/** 导出页幻灯片：每场播到自己的 end 就停。→ / 空格下一场，← 上一场开头。loop 时首尾相接。 */
function playSlides(show: HtmlShow, loop: boolean) {
  const scenes = show.scenes;
  if (!scenes.length) return;
  let index = 0;
  const playAt = (i: number) => {
    index = i;
    show.seek(scenes[i]!.start);
    show.play();
  };
  const hold = () => {
    const end = scenes[index]!.end;
    show.pause();
    // 非最后一场的 end 同时是下一场的 start；停在边界前一毫秒，这一场仍留在画面上
    show.seek(index < scenes.length - 1 ? end - 0.001 : end);
    if (show.playing()) show.pause();
  };
  window.setInterval(() => {
    if (show.playing() && show.time() >= scenes[index]!.end) hold();
  }, 32);
  window.addEventListener('keydown', (event) => {
    const dir = event.key === 'ArrowRight' || event.key === ' ' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (dir === 0) return;
    event.preventDefault();
    const dest = index + dir;
    if (dest >= 0 && dest < scenes.length) playAt(dest);
    else if (loop) playAt((dest + scenes.length) % scenes.length);
  });
  playAt(0);
}

if (stage && embedded) {
  const sb = parseStoryboard(JSON.parse(embedded.textContent ?? 'null'));
  if (sb.ok) {
    const slides = embedded.dataset.slides === 'true';
    const loop = embedded.dataset.loop === 'true';
    void playHtmlStoryboard(sb.value, stage, { loop: loop && !slides }).then((show) => {
      page.__awbExport = {
        scenes: spansOf(show),
        duration: show.duration,
        seek: (t) => show.seek(t),
        time: () => show.time(),
      };
      if (slides) playSlides(show, loop);
      else show.play();
    });
  } else console.error('分镜数据损坏', sb.issues);
} else if (stage && window.parent !== window) {
  startPreview(stage);
} else if (stage) {
  let show: HtmlShow | null = null;
  page.__ready = true;
  page.__run = async (storyboard) => {
    const t0 = performance.now();
    show?.kill();
    show = null;
    const parsed = parseStoryboard(storyboard);
    if (!parsed.ok) {
      return {
        duration: 0,
        scenes: [],
        errors: [{ message: parsed.issues[0]?.message ?? '分镜结构错误' }],
        buildMs: 0,
      };
    }
    const next = await playHtmlStoryboard(parsed.value, stage);
    show = next;
    return {
      duration: next.duration,
      scenes: spansOf(next),
      errors: next.errors,
      buildMs: Math.round(performance.now() - t0),
    };
  };
  page.__seek = (t) => {
    show?.seek(t);
  };
  page.__play = () => show?.play();
  page.__pause = () => show?.pause();
}

function startPreview(stageEl: HTMLElement) {
  const post = (m: PreviewMessage) => window.parent.postMessage(m, '*');
  let current: HtmlShow | null = null;
  let duration = 0;
  let lastT = -1;
  let queued: { data: unknown; startAt?: number } | null = null;
  let busy = false;

  window.addEventListener('error', (e) => post({ type: 'error', message: e.message }));
  window.addEventListener('unhandledrejection', (e) => post({ type: 'error', message: String(e.reason) }));

  async function load(data: unknown, startAt?: number) {
    const parsed = parseStoryboard(data);
    if (!parsed.ok) {
      const issue = parsed.issues[0];
      post({ type: 'error', message: `分镜结构错误：${issue?.path ?? ''} ${issue?.message ?? ''}`.trim() });
      return;
    }
    current?.kill();
    current = null;
    const show = await playHtmlStoryboard(parsed.value, stageEl);
    current = show;
    duration = show.duration;
    for (const error of show.errors) post({ type: 'error', ...error });
    if (startAt) show.seek(Math.min(startAt, show.duration));
    post({ type: 'loaded', duration: show.duration, scenes: spansOf(show), buildMs: 0 });
  }

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

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const m = HostMessage.safeParse(e.data);
    if (!m.success) return;
    switch (m.data.type) {
      case 'load':
        void requestLoad(m.data.storyboard, m.data.startAt);
        break;
      case 'play':
        if (current && current.time() >= duration - 1e-3) current.seek(0);
        current?.play();
        break;
      case 'pause':
        current?.pause();
        break;
      case 'seek':
        current?.seek(Math.max(0, Math.min(m.data.t, duration)));
        break;
      case 'setRate':
        current?.setRate(m.data.rate);
        break;
      case 'probe':
        void replyProbe(m.data.id, m.data.raster !== false);
        break;
      case 'pick':
        replyPick(m.data.id, m.data.x, m.data.y);
        break;
    }
  });

  function replyPick(id: string, x: number, y: number) {
    const hit = hitAt(stageEl, x, y);
    post({ type: 'picked', id, point: hit.point, element: hit.element });
  }

  async function replyProbe(id: string, raster: boolean) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const rect = stageEl.getBoundingClientRect();
    const elements = collectStageElements(stageEl);
    const shot = raster ? await spikeRaster(stageEl) : { ms: 0, dataUrl: undefined, error: undefined };
    post({
      type: 'probed',
      id,
      width: rect.width,
      height: rect.height,
      elements,
      raster: shot.dataUrl ?? null,
      rasterMs: shot.ms,
      ...(shot.error ? { rasterError: shot.error } : {}),
    });
  }

  setInterval(() => {
    if (!current) return;
    const t = current.time();
    if (t === lastT && !current.playing()) return;
    lastT = t;
    post({ type: 'time', t, playing: current.playing() });
  }, 1000 / 15);
  setInterval(() => post({ type: 'heartbeat' }), 1000);

  post({
    type: 'ready',
    runtimeVersion: RUNTIME_VERSION,
    caps: { webcodecs: typeof VideoEncoder !== 'undefined' },
  });
}
