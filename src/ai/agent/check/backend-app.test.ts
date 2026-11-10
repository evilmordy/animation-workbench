import { describe, expect, it } from 'vitest';
import { emptyStoryboard } from '../../../shared/project';
import type { Storyboard } from '../../../shared/schema';
import type { RawLayoutElement } from '../layoutBoxes';
import { pickLayoutBoxes } from '../layoutBoxes';
import { checkScenes, type Issue } from './index';
import { solidRaster } from './pixels';
import {
  adoptRaster,
  captureWithDriver,
  checkStoryboard,
  rejectBlankRaster,
  type CheckDriver,
  type ProbeShot,
} from './backend-app';

function codeBoard(code = 'el("t")'): Storyboard {
  const sb = emptyStoryboard('t');
  sb.scenes.push({
    id: 's_code',
    title: '一场',
    description: '',
    kind: 'code',
    enter: 'fresh',
    hold: 1,
    elements: [],
    steps: [],
    code,
  });
  return sb;
}

const overflow: RawLayoutElement = {
  id: 'title',
  layer: false,
  visibility: 'visible',
  display: 'block',
  opacity: 1,
  width: 180,
  height: 40,
  x: -200,
  y: 10,
  text: '出界标题',
  childElementCount: 0,
};

function shot(over: Partial<ProbeShot> = {}): ProbeShot {
  return {
    width: 960,
    height: 540,
    elements: [overflow],
    raster: null,
    png: null,
    rasterMs: 0,
    rasterError: 'foreignObject 没有解码成图片',
    ...over,
  };
}

function driver(reply: (opts?: { raster?: boolean }) => ProbeShot, calls: string[]): CheckDriver {
  return {
    async load(sb) {
      calls.push(`load:${sb.scenes.length}`);
      return {
        scenes: sb.scenes.map((scene, index) => ({ id: scene.id, start: index, end: index + 1 })),
        duration: sb.scenes.length,
        errors: [],
      };
    },
    async seek(t) {
      calls.push(`seek:${t.toFixed(3)}`);
    },
    async probe(opts) {
      calls.push(opts?.raster === false ? 'box' : 'raster');
      return reply(opts);
    },
    close() {
      calls.push('close');
    },
  };
}

function keys(issues: Issue[]): string[] {
  return [
    ...new Set(issues.map((issue) => `${issue.kind}|${issue.scene_id}|${issue.evidence.text ?? ''}`)),
  ].sort();
}

describe('应用内体检', () => {
  it('没有代码场时不打开预览', async () => {
    const calls: string[] = [];
    const report = await checkStoryboard(
      emptyStoryboard('t'),
      driver(() => shot(), calls),
    );
    expect(report.text).toBe('没有可体检的代码场。');
    expect(calls).toEqual([]);
  });

  it('DOM 框和直接 checkScenes 的布局问题一致，没有像素就不做空屏', async () => {
    const calls: string[] = [];
    const report = await checkStoryboard(
      codeBoard(),
      driver(() => shot(), calls),
    );
    const direct = checkScenes([
      {
        id: 's_code',
        width: 960,
        height: 540,
        frames: [{ tMs: 0, boxes: pickLayoutBoxes([overflow]).boxes }],
      },
    ]);
    expect(keys(report.issues)).toEqual(keys(direct));
    expect(report.issues.some((issue) => issue.kind === 'LAYOUT_OVERFLOW_TEXT')).toBe(true);
    expect(report.issues.some((issue) => issue.kind === 'BLANK')).toBe(false);
    expect(report.raster).toBe('unavailable');
    expect(report.text).toContain('出界标题');
    expect(report.text).toContain('没有采用');
    expect(report.text).not.toContain('尚未接入');
    expect(calls.some((call) => call === 'box')).toBe(true);
    expect(calls.filter((call) => call === 'raster')).toEqual(['raster']);
  });

  it('连续两次一致的像素会送进同毫秒和残留', async () => {
    const raster = solidRaster(8, 8, { r: 0, g: 0, b: 0 });
    raster.rgba[0] = 255;
    raster.rgba[3] = 255;
    const calls: string[] = [];
    const report = await checkStoryboard(
      codeBoard(),
      driver(
        () => shot({ raster, png: new Uint8Array([137, 80, 78, 71]), rasterMs: 10, rasterError: undefined }),
        calls,
      ),
    );
    expect(report.raster).toBe('ok');
    expect(report.text).toContain('foreignObject 连续两次一致');
    expect(report.issues.some((issue) => issue.kind === 'SEEK_SAME_MS')).toBe(false);
    expect(report.issues.some((issue) => issue.kind === 'BLANK')).toBe(false);
    expect(calls.filter((call) => call.startsWith('load:')).length).toBeGreaterThan(1);
    expect(calls.filter((call) => call === 'raster').length).toBeGreaterThan(2);
  });

  it('两次不一致或空图都不采用像素', () => {
    const left = solidRaster(2, 2, { r: 0, g: 0, b: 0 });
    const right = solidRaster(2, 2, { r: 255, g: 0, b: 0 });
    const base = shot({ raster: left, png: new Uint8Array([1]), rasterMs: 12, rasterError: undefined });
    expect(adoptRaster(base, { ...base, raster: right }).raster).toBeNull();
    expect(adoptRaster(base, { ...base, raster: right }).rasterError).toContain('不一致');
    expect(adoptRaster(base, base).raster).toBe(left);
    const blank = solidRaster(8, 8, { r: 0, g: 0, b: 0 });
    const dropped = rejectBlankRaster(
      shot({ raster: blank, png: new Uint8Array([1]), rasterError: undefined }),
      pickLayoutBoxes([overflow]).boxes,
    );
    expect(dropped.raster).toBeNull();
    expect(dropped.rasterError).toContain('几乎是空的');
  });

  it('截帧没有像素时不写假图', async () => {
    const batch = await captureWithDriver(
      driver(() => shot(), []),
      { storyboard: codeBoard(), shots: [{ sceneId: 's_code', at: 'end', isolated: true }] },
    );
    expect(batch.backend).toBe('app-iframe');
    expect(batch.frames).toHaveLength(2);
    expect(batch.frames.every((frame) => frame.pixels === false && frame.png.byteLength === 0)).toBe(true);
    expect(batch.frames[0]?.boxes.some((box) => box.text === '出界标题')).toBe(true);
    expect(batch.frames[0]?.stageWidth).toBe(960);
  });
});
