import { HostMessage, type PreviewMessage, type SceneSpan } from '../../shared/protocol';
import { parseStoryboard } from '../../shared/schema';
import { GSAP_LICENSE, playGsapStoryboard, type GsapShow } from './player';

const RUNTIME_VERSION = '1.0.0';

interface GsapPage {
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
  __gsapLicense?: string;
  __awbExport?: {
    scenes: SceneSpan[];
    duration: number;
    seek: (t: number) => void;
  };
}

const page = window as Window & GsapPage;
page.__gsapLicense = GSAP_LICENSE;

const stage = document.getElementById('stage');
const embedded = document.getElementById('awb-storyboard');

function spansOf(show: GsapShow): SceneSpan[] {
  return show.scenes.map((scene) => ({ id: scene.id, start: scene.start, end: scene.end }));
}

if (stage && embedded) {
  const sb = parseStoryboard(JSON.parse(embedded.textContent ?? 'null'));
  if (sb.ok) {
    void playGsapStoryboard(sb.value, stage, { loop: embedded.dataset.loop === 'true' }).then((show) => {
      page.__awbExport = {
        scenes: spansOf(show),
        duration: show.duration,
        seek: (t) => {
          show.seek(t);
        },
      };
      show.play();
    });
  } else console.error('分镜数据损坏', sb.issues);
} else if (stage && window.parent !== window) {
  startPreview(stage);
} else if (stage) {
  let show: GsapShow | null = null;
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
    const next = await playGsapStoryboard(parsed.value, stage);
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
  let current: GsapShow | null = null;
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
    const show = await playGsapStoryboard(parsed.value, stageEl);
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
    }
  });

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
    manimWebVersion: 'gsap',
    caps: { webcodecs: typeof VideoEncoder !== 'undefined' },
  });
}
