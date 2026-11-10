/**
 * 应用内体检后端。隐藏 iframe 跑 anime 预览，用 probe 拿 DOM 框。
 * foreignObject 像素只在连续两次一致、并且和 DOM 框不矛盾时才送进 checkScenes。
 */
import type { Storyboard } from '../../../shared/schema';
import { PreviewMessage, type SceneSpan } from '../../../shared/protocol';
import {
  isolateScene,
  resolveTime,
  sceneWindow,
  type CaptureBatch,
  type CaptureRequest,
  type CapturedFrame,
  type FrameSource,
} from '../capture';
import { pickLayoutBoxes, type RawLayoutElement } from '../layoutBoxes';
import {
  checkScenes,
  seekTimes,
  type Issue,
  type ResidualProbe,
  type SameMsProbe,
  type SceneCheckInput,
  type SeekProbe,
} from './index';
import { contentRatio, diffPixels, type LayoutBox, type Raster } from './pixels';

/** 单次 foreignObject 不超过这时，才做 7 点后向/乱序。再慢只留场末同毫秒和残留。 */
export const FULL_SEEK_MS = 80;
const STABLE_DELTA = 2;
const SHUFFLE = [4, 0, 6, 2, 5, 1, 3];

export interface ProbeShot {
  width: number;
  height: number;
  elements: RawLayoutElement[];
  raster: Raster | null;
  png: Uint8Array | null;
  rasterMs: number;
  rasterError?: string;
}

export interface CheckDriver {
  load(sb: Storyboard): Promise<{ scenes: SceneSpan[]; duration: number; errors: string[] }>;
  seek(t: number): Promise<void>;
  probe(opts?: { raster?: boolean }): Promise<ProbeShot>;
  close(): void;
}

export interface AppCheckReport {
  issues: Issue[];
  text: string;
  raster: 'ok' | 'unavailable';
  rasterError?: string;
  rasterMs?: number;
  elapsedMs: number;
}

const KIND_TEXT: Record<string, string> = {
  LAYOUT_OVERFLOW_TEXT: '文字出界',
  LAYOUT_OVERFLOW_OTHER: '出界',
  LAYOUT_OVERLAP: '文字重叠',
  BLANK: '空屏',
  RESIDUAL: '换场残留',
  SEEK_SAME_MS: '同毫秒 seek 不一致',
  SEEK_BACKWARD: 'seek 顺序不一致',
  CONSOLE: '控制台错误',
};

export function adoptRaster(first: ProbeShot, second: ProbeShot | null): ProbeShot {
  if (!first.raster || !first.png) return first;
  if (!second?.raster || diffPixels(first.raster, second.raster, STABLE_DELTA)?.count !== 0) {
    return {
      ...first,
      raster: null,
      png: null,
      rasterError: `foreignObject 连续两次不一致（${Math.round(first.rasterMs)}ms），像素没有采用。`,
    };
  }
  return first;
}

/** 有 DOM 内容但出图像素几乎是空的，不能拿去判空屏或残留。 */
export function rejectBlankRaster(shot: ProbeShot, boxes: LayoutBox[]): ProbeShot {
  if (!shot.raster || !boxes.length) return shot;
  if (contentRatio(shot.raster) >= 0.003) return shot;
  return {
    ...shot,
    raster: null,
    png: null,
    rasterError: 'foreignObject 出图几乎是空的，但 DOM 上有内容，像素没有采用。',
  };
}

function sceneTimes(span: SceneSpan): number[] {
  const durationMs = Math.max(0, (span.end - span.start) * 1000);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const ms of seekTimes(durationMs)) {
    let t = span.start + ms / 1000;
    if (span.end > span.start) t = Math.min(Math.max(span.start, t), span.end - 1e-3);
    const key = Math.round(t * 1000);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  if (!out.length) out.push(span.start);
  return out;
}

function endTime(span: SceneSpan): number {
  if (span.end <= span.start) return span.start;
  return Math.min(span.end - 1e-3, span.end);
}

function shuffledTimes(times: number[]): number[] {
  const out: number[] = [];
  for (const index of SHUFFLE) {
    if (index >= times.length) continue;
    const t = times[index];
    if (t === undefined || out.includes(t)) continue;
    out.push(t);
  }
  for (const t of times) if (!out.includes(t)) out.push(t);
  return out;
}

function errorsFor(sceneId: string, errors: string[], firstId: string): string[] {
  return errors.filter((error) => {
    const scoped = /^([A-Za-z_][\w-]*): /.exec(error);
    if (!scoped) return sceneId === firstId;
    return scoped[1] === sceneId;
  });
}

async function stablePair(driver: CheckDriver): Promise<{ adopted: ProbeShot; second: Raster | null }> {
  const first = await driver.probe({ raster: true });
  if (!first.raster) return { adopted: first, second: null };
  const second = await driver.probe({ raster: true });
  const adopted = adoptRaster(first, second);
  return { adopted, second: adopted.raster && second.raster ? second.raster : null };
}

async function stableProbe(driver: CheckDriver): Promise<ProbeShot> {
  return (await stablePair(driver)).adopted;
}

async function seekSuite(driver: CheckDriver, times: number[], start: number): Promise<SeekProbe[] | null> {
  const grab = async (list: number[]) => {
    const map = new Map<number, Raster>();
    for (const t of list) {
      await driver.seek(t);
      const shot = await driver.probe({ raster: true });
      if (!shot.raster) return null;
      map.set(Math.round(t * 1000), shot.raster);
    }
    return map;
  };
  const forward = await grab(times);
  const backward = await grab([...times].reverse());
  const shuffled = await grab(shuffledTimes(times));
  if (!forward || !backward || !shuffled) return null;
  const probes: SeekProbe[] = [];
  for (const t of times) {
    const key = Math.round(t * 1000);
    const a = forward.get(key);
    const b = backward.get(key);
    const c = shuffled.get(key);
    if (!a || !b || !c) return null;
    probes.push({ tMs: Math.max(0, Math.round((t - start) * 1000)), forward: a, backward: b, shuffled: c });
  }
  return probes;
}

function formatReport(issues: Issue[], notes: string[], raster: AppCheckReport['raster']): string {
  const lines: string[] = [];
  if (!issues.length) lines.push('体检没有发现问题。');
  else {
    lines.push(`体检 ${issues.length} 个问题。`);
    for (const issue of issues) {
      const label = KIND_TEXT[issue.kind] ?? issue.kind;
      const text = issue.evidence.text ? ` ${issue.evidence.text}` : '';
      lines.push(`${issue.id} ${issue.scene_id} ${label}${text}`);
    }
  }
  lines.push(
    raster === 'ok'
      ? '像素：foreignObject 连续两次一致，已送入体检。'
      : '像素：没有采用。布局按 DOM 包围盒检查，空屏、残留和 seek 像素项跳过。',
  );
  for (const note of notes) lines.push(note);
  return lines.join('\n');
}

export async function checkStoryboard(sb: Storyboard, driver: CheckDriver): Promise<AppCheckReport> {
  const started = performance.now();
  const code = sb.scenes.filter((scene) => scene.kind === 'code' && scene.code?.trim());
  if (!code.length) {
    return {
      issues: [],
      text: '没有可体检的代码场。',
      raster: 'unavailable',
      elapsedMs: 0,
    };
  }
  const loaded = await driver.load(sb);
  const spans = new Map(loaded.scenes.map((scene) => [scene.id, scene]));
  const inputs: SceneCheckInput[] = [];
  const notes: string[] = [];
  let raster: AppCheckReport['raster'] = 'unavailable';
  let rasterMs: number | undefined;
  const firstId = code[0]?.id ?? '';

  for (const scene of code) {
    const span = spans.get(scene.id) ?? { id: scene.id, start: 0, end: 0 };
    const times = sceneTimes(span);
    const frames: SceneCheckInput['frames'] = [];
    let stageWidth = 0;
    let stageHeight = 0;
    for (const t of times) {
      await driver.seek(t);
      const shot = await driver.probe({ raster: false });
      stageWidth = shot.width;
      stageHeight = shot.height;
      const picked = pickLayoutBoxes(shot.elements);
      frames.push({
        tMs: Math.max(0, Math.round((t - span.start) * 1000)),
        boxes: picked.boxes,
        ...(picked.truncated ? { truncated: true } : {}),
      });
    }
    const end = times.at(-1) ?? span.start;
    await driver.seek(end);
    const pair = await stablePair(driver);
    const probed = rejectBlankRaster(pair.adopted, frames.at(-1)?.boxes ?? []);
    rasterMs = probed.rasterMs;
    const consoleErrors = errorsFor(scene.id, loaded.errors, firstId);
    const base: SceneCheckInput = {
      id: scene.id,
      width: stageWidth || probed.width,
      height: stageHeight || probed.height,
      frames,
      consoleErrors,
    };
    if (!probed.raster) {
      notes.push(`${scene.id}：${probed.rasterError ?? '没有像素'}（${Math.round(probed.rasterMs)}ms）`);
      inputs.push(base);
      continue;
    }
    raster = 'ok';
    notes.push(`${scene.id}：foreignObject 单次 ${Math.round(probed.rasterMs)}ms。`);
    const endFrame = frames.at(-1);
    if (endFrame) endFrame.raster = probed.raster;
    const sameMs: SameMsProbe[] = [];
    if (pair.second) {
      sameMs.push({
        tMs: endFrame?.tMs ?? 0,
        first: probed.raster,
        second: pair.second,
      });
    }
    let residual: ResidualProbe | undefined;
    const isolated = await driver.load(isolateScene(sb, scene.id));
    const iso = isolated.scenes[0];
    if (iso) {
      await driver.seek(endTime(iso));
      const isoShot = rejectBlankRaster(await driver.probe({ raster: true }), frames.at(-1)?.boxes ?? []);
      if (isoShot.raster) {
        residual = {
          tMs: Math.max(0, Math.round((endTime(iso) - iso.start) * 1000)),
          sequence: probed.raster,
          isolated: isoShot.raster,
        };
      } else {
        notes.push(`${scene.id}：单场像素没有采用。${isoShot.rasterError ?? ''}`);
      }
    }
    await driver.load(sb);
    let seek: SeekProbe[] | undefined;
    if (probed.rasterMs <= FULL_SEEK_MS) {
      const suite = await seekSuite(driver, times, span.start);
      if (suite) seek = suite;
      else notes.push(`${scene.id}：后向/乱序采样不完整，未做这项像素比较。`);
    } else {
      notes.push(
        `${scene.id}：foreignObject 单次 ${Math.round(probed.rasterMs)}ms，超过 ${FULL_SEEK_MS}ms，未做 7 点后向/乱序。`,
      );
    }
    inputs.push({
      ...base,
      ...(sameMs.length ? { sameMs } : {}),
      ...(seek?.length ? { seek } : {}),
      ...(residual ? { residual } : {}),
    });
  }

  const issues = checkScenes(inputs);
  const rasterError = raster === 'ok' ? undefined : notes.find((note) => note.includes('：'));
  return {
    issues,
    text: formatReport(issues, notes, raster),
    raster,
    ...(rasterError ? { rasterError } : {}),
    ...(rasterMs != null ? { rasterMs } : {}),
    elapsedMs: Math.round(performance.now() - started),
  };
}

export async function checkStoryboardInApp(
  sb: Storyboard,
  opts: { previewSrc: string },
): Promise<AppCheckReport> {
  const code = sb.scenes.some((scene) => scene.kind === 'code' && scene.code?.trim());
  if (!code) {
    return { issues: [], text: '没有可体检的代码场。', raster: 'unavailable', elapsedMs: 0 };
  }
  const driver = await openHiddenPreview(opts.previewSrc);
  try {
    return await checkStoryboard(sb, driver);
  } finally {
    driver.close();
  }
}

function toCaptured(
  sceneId: string,
  source: FrameSource,
  t: number,
  shot: ProbeShot,
  errors: string[],
): CapturedFrame {
  const picked = pickLayoutBoxes(shot.elements);
  const usable = rejectBlankRaster(shot, picked.boxes);
  const pixels = Boolean(usable.raster && usable.png && usable.png.byteLength > 0);
  return {
    sceneId,
    source,
    t,
    png: pixels && usable.png ? usable.png : new Uint8Array(),
    raster: usable.raster ?? { width: 1, height: 1, rgba: new Uint8Array(4) },
    boxes: picked.boxes,
    ...(picked.truncated ? { boxesTruncated: true } : {}),
    consoleErrors: errors,
    pixels,
    stageWidth: shot.width,
    stageHeight: shot.height,
    ...(pixels ? {} : { rasterError: usable.rasterError ?? shot.rasterError ?? '没有像素' }),
  };
}

export async function captureWithDriver(driver: CheckDriver, request: CaptureRequest): Promise<CaptureBatch> {
  const full = await driver.load(request.storyboard);
  const frames: CapturedFrame[] = [];
  for (const shot of request.shots) {
    const t = resolveTime(sceneWindow(full, shot.sceneId), shot.at);
    await driver.seek(t);
    const sequence = await stableProbe(driver);
    frames.push(toCaptured(shot.sceneId, 'sequence', t, sequence, full.errors));
    if (!shot.isolated) continue;
    const isolatedRun = await driver.load(isolateScene(request.storyboard, shot.sceneId));
    const isolatedT = resolveTime(sceneWindow(isolatedRun, shot.sceneId), shot.at);
    await driver.seek(isolatedT);
    const isolated = await stableProbe(driver);
    const errors = [...full.errors];
    for (const error of isolatedRun.errors) if (!errors.includes(error)) errors.push(error);
    frames.push(toCaptured(shot.sceneId, 'isolated', isolatedT, isolated, errors));
    await driver.load(request.storyboard);
  }
  return { backend: 'app-iframe', frames };
}

export function appFrameCapture(previewSrc: string): (request: CaptureRequest) => Promise<CaptureBatch> {
  return async (request) => {
    const driver = await openHiddenPreview(previewSrc);
    try {
      return await captureWithDriver(driver, request);
    } finally {
      driver.close();
    }
  };
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asElements(raw: unknown[]): RawLayoutElement[] {
  const out: RawLayoutElement[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const el = item as Partial<RawLayoutElement>;
    const clip = el.svgClip;
    const svgClip =
      clip &&
      typeof clip === 'object' &&
      typeof clip.x === 'number' &&
      typeof clip.y === 'number' &&
      typeof clip.width === 'number' &&
      typeof clip.height === 'number'
        ? { x: clip.x, y: clip.y, width: clip.width, height: clip.height }
        : undefined;
    out.push({
      id: typeof el.id === 'string' ? el.id : '',
      layer: Boolean(el.layer),
      visibility: typeof el.visibility === 'string' ? el.visibility : 'visible',
      display: typeof el.display === 'string' ? el.display : 'block',
      opacity: asNumber(el.opacity, 1),
      width: asNumber(el.width),
      height: asNumber(el.height),
      x: asNumber(el.x),
      y: asNumber(el.y),
      text: typeof el.text === 'string' ? el.text : '',
      childElementCount: asNumber(el.childElementCount),
      ...(typeof el.awbRole === 'string' && el.awbRole ? { awbRole: el.awbRole } : {}),
      ...(svgClip ? { svgClip } : {}),
    });
  }
  return out;
}

async function rasterFromDataUrl(
  dataUrl: string,
): Promise<{ png: Uint8Array; raster: Raster } | { error: string }> {
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('PNG 解码失败'));
      img.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 1;
    canvas.height = img.naturalHeight || 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { error: '没有 2d canvas' };
    ctx.drawImage(img, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const base64 = dataUrl.split(',')[1] ?? '';
    const bin = atob(base64);
    const png = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) png[i] = bin.charCodeAt(i);
    return {
      png,
      raster: { width: canvas.width, height: canvas.height, rgba: new Uint8Array(image.data) },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function openHiddenPreview(src: string): Promise<CheckDriver> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('没有 document，不能开隐藏预览'));
      return;
    }
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.cssText =
      'position:fixed;left:0;top:0;width:960px;height:540px;opacity:0.01;pointer-events:none;border:0;z-index:0';
    iframe.src = src;
    let settled = false;
    let closed = false;
    let probeSeq = 0;
    const errors: string[] = [];
    const probes = new Map<string, (shot: ProbeShot | Error) => void>();
    let loadWait:
      ((result: { scenes: SceneSpan[]; duration: number; errors: string[] } | Error) => void) | null = null;
    let readyTimer = 0;

    const cleanup = () => {
      window.clearTimeout(readyTimer);
      window.removeEventListener('message', onMessage);
      iframe.remove();
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const parsed = PreviewMessage.safeParse(event.data);
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.type === 'ready') {
        if (settled) return;
        settled = true;
        window.clearTimeout(readyTimer);
        resolve(driver);
        return;
      }
      if (msg.type === 'error') {
        const line = msg.sceneId ? `${msg.sceneId}: ${msg.message}` : msg.message;
        if (line && !errors.includes(line)) errors.push(line);
        return;
      }
      if (msg.type === 'loaded') {
        const wait = loadWait;
        loadWait = null;
        wait?.({ scenes: msg.scenes, duration: msg.duration, errors: [...errors] });
        errors.length = 0;
        return;
      }
      if (msg.type === 'probed') {
        const wait = probes.get(msg.id);
        probes.delete(msg.id);
        if (!wait) return;
        void shotFromMessage(msg).then(wait, (error: unknown) =>
          wait(error instanceof Error ? error : new Error(String(error))),
        );
      }
    };

    async function shotFromMessage(msg: {
      width: number;
      height: number;
      elements: unknown[];
      raster: string | null;
      rasterMs: number;
      rasterError?: string;
    }): Promise<ProbeShot> {
      const elements = asElements(msg.elements);
      if (!msg.raster) {
        return {
          width: msg.width,
          height: msg.height,
          elements,
          raster: null,
          png: null,
          rasterMs: msg.rasterMs,
          ...(msg.rasterError ? { rasterError: msg.rasterError } : {}),
        };
      }
      const decoded = await rasterFromDataUrl(msg.raster);
      if ('error' in decoded) {
        return {
          width: msg.width,
          height: msg.height,
          elements,
          raster: null,
          png: null,
          rasterMs: msg.rasterMs,
          rasterError: decoded.error,
        };
      }
      return {
        width: msg.width,
        height: msg.height,
        elements,
        raster: decoded.raster,
        png: decoded.png,
        rasterMs: msg.rasterMs,
      };
    }

    function post(message: { type: string; [key: string]: unknown }) {
      const target = iframe.contentWindow;
      if (!target) throw new Error('预览页已关闭');
      target.postMessage(message, '*');
    }

    const driver: CheckDriver = {
      load(storyboard) {
        errors.length = 0;
        const cloned = JSON.parse(JSON.stringify(storyboard)) as Storyboard;
        return new Promise((done, rejectLoad) => {
          const timer = window.setTimeout(() => rejectLoad(new Error('预览加载超时')), 20_000);
          loadWait = (result) => {
            window.clearTimeout(timer);
            if (result instanceof Error) rejectLoad(result);
            else done(result);
          };
          try {
            post({ type: 'load', storyboard: cloned });
          } catch (error) {
            window.clearTimeout(timer);
            rejectLoad(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
      async seek(t) {
        post({ type: 'seek', t });
      },
      probe(opts) {
        const id = `p${++probeSeq}`;
        return new Promise((done, rejectProbe) => {
          const timer = window.setTimeout(() => {
            probes.delete(id);
            rejectProbe(new Error('探针超时'));
          }, 8_000);
          probes.set(id, (shot) => {
            window.clearTimeout(timer);
            if (shot instanceof Error) rejectProbe(shot);
            else done(shot);
          });
          try {
            post({ type: 'probe', id, raster: opts?.raster !== false });
          } catch (error) {
            window.clearTimeout(timer);
            probes.delete(id);
            rejectProbe(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
      close() {
        if (closed) return;
        closed = true;
        for (const wait of probes.values()) wait(new Error('预览页已关闭'));
        probes.clear();
        loadWait?.(new Error('预览页已关闭'));
        cleanup();
      },
    };

    readyTimer = window.setTimeout(() => fail(new Error('预览页没有 ready')), 8_000);
    window.addEventListener('message', onMessage);
    document.body.appendChild(iframe);
  });
}
