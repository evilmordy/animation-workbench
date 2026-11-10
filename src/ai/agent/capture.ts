import type { Storyboard } from '../../shared/schema';
import type { LayoutBox, Raster } from './check/pixels';

export type FrameAt = 'start' | 'mid' | 'end' | number;
export type FrameSource = 'sequence' | 'isolated';

export interface CaptureShot {
  sceneId: string;
  at: FrameAt;
  isolated: boolean;
}

export interface CaptureRequest {
  storyboard: Storyboard;
  shots: CaptureShot[];
}

export interface CapturedFrame {
  sceneId: string;
  source: FrameSource;
  /** 这一帧在它自己的时间线上的秒。整片帧是全片时间，单场帧是该场内部时间。 */
  t: number;
  png: Uint8Array;
  raster: Raster;
  boxes: LayoutBox[];
  /** DOM 框超过上限，文字框已经优先留下。 */
  boxesTruncated?: boolean;
  consoleErrors: string[];
}

export interface CaptureBatch {
  backend: string;
  frames: CapturedFrame[];
}

export interface HarnessRun {
  errors: { sceneId?: string; message: string }[];
  scenes: { id: string; start: number; end: number }[];
  duration: number;
}

/** 与 tests/runtime/code-harness 对齐的预览页。Playwright 和单测假页面都实现它。 */
export interface HarnessPage {
  onConsoleError(listener: (message: string) => void): void;
  gotoHarness(): Promise<void>;
  run(storyboard: Storyboard, enableCodeScenes: boolean): Promise<HarnessRun>;
  seek(t: number): Promise<void>;
  wait(ms: number): Promise<void>;
  grab(): Promise<{ png: Uint8Array; raster: Raster; boxes: LayoutBox[]; boxesTruncated?: boolean }>;
  close(): Promise<void>;
}

/**
 * 单场预览没有 nextSlide 时，build() 报出的 span 往往只盖住 schema 里的停留段。
 * 时间线总长才是这场的真实结尾。多场仍用报出来的 span，不改预览协议。
 */
export function sceneWindow(
  run: { scenes: { id: string; start: number; end: number }[]; duration: number },
  sceneId: string,
): { start: number; end: number } {
  const span = run.scenes.find((item) => item.id === sceneId);
  if (!span) throw new Error(`预览没有场 ${sceneId}`);
  const reported = Math.max(0, span.end - span.start);
  if (run.scenes.length === 1 && run.duration > reported + 0.05) return { start: 0, end: run.duration };
  return { start: span.start, end: span.end };
}

export function resolveTime(span: { start: number; end: number }, at: FrameAt): number {
  const spanLen = Math.max(0, span.end - span.start);
  let offset = 0;
  if (at === 'mid') offset = spanLen / 2;
  else if (at === 'end') offset = Math.max(0, spanLen - 1e-3);
  else if (typeof at === 'number') offset = at;
  const t = span.start + offset;
  if (span.end <= span.start) return span.start;
  return Math.min(Math.max(span.start, t), span.end);
}

export function isolateScene(storyboard: Storyboard, sceneId: string): Storyboard {
  const scene = storyboard.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error(`没有场 ${sceneId}`);
  return { ...storyboard, scenes: [{ ...scene, enter: 'fresh' }] };
}

/**
 * 先整片跑，再按场 seek。需要残留对比时再单独渲染这一场。
 * enableCodeScenes 只传给这个预览页，不改产品里的 runtimeFlags。
 */
export async function captureWithHarness(
  request: CaptureRequest,
  open: () => Promise<HarnessPage>,
  backend = 'playwright',
): Promise<CaptureBatch> {
  const page = await open();
  try {
    const errors: string[] = [];
    page.onConsoleError((message) => {
      if (message && !errors.includes(message)) errors.push(message);
    });
    await page.gotoHarness();
    const full = await page.run(request.storyboard, true);
    for (const error of full.errors) {
      const line = error.sceneId ? `${error.sceneId}: ${error.message}` : error.message;
      if (!errors.includes(line)) errors.push(line);
    }
    const frames: CapturedFrame[] = [];
    for (const shot of request.shots) {
      const t = resolveTime(sceneWindow(full, shot.sceneId), shot.at);
      await page.seek(t);
      await page.wait(200);
      const sequence = await page.grab();
      frames.push({
        sceneId: shot.sceneId,
        source: 'sequence',
        t,
        png: sequence.png,
        raster: sequence.raster,
        boxes: sequence.boxes,
        ...(sequence.boxesTruncated ? { boxesTruncated: true } : {}),
        consoleErrors: [...errors],
      });
      if (!shot.isolated) continue;
      const isolatedRun = await page.run(isolateScene(request.storyboard, shot.sceneId), true);
      const isolatedT = resolveTime(sceneWindow(isolatedRun, shot.sceneId), shot.at);
      await page.seek(isolatedT);
      await page.wait(200);
      const isolated = await page.grab();
      const isolatedErrors = [...errors];
      for (const error of isolatedRun.errors) {
        const line = error.sceneId ? `${error.sceneId}: ${error.message}` : error.message;
        if (!isolatedErrors.includes(line)) isolatedErrors.push(line);
      }
      frames.push({
        sceneId: shot.sceneId,
        source: 'isolated',
        t: isolatedT,
        png: isolated.png,
        raster: isolated.raster,
        boxes: isolated.boxes,
        ...(isolated.boxesTruncated ? { boxesTruncated: true } : {}),
        consoleErrors: isolatedErrors,
      });
      await page.run(request.storyboard, true);
    }
    return { backend, frames };
  } finally {
    await page.close();
  }
}
