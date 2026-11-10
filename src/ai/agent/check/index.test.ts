import { describe, expect, it } from 'vitest';
import { checkScenes, seekTimes, type SceneCheckInput } from './index';
import { solidRaster, type Raster, type Rgb } from './pixels';

function paint(raster: Raster, x: number, y: number, w: number, h: number, color: Rgb) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= raster.width || yy >= raster.height) continue;
      const i = (yy * raster.width + xx) * 4;
      raster.rgba[i] = color.r;
      raster.rgba[i + 1] = color.g;
      raster.rgba[i + 2] = color.b;
      raster.rgba[i + 3] = 255;
    }
  }
}

function picture(width = 48, height = 32): Raster {
  const raster = solidRaster(width, height, { r: 0, g: 0, b: 0 });
  paint(raster, 4, 4, 20, 12, { r: 80, g: 160, b: 220 });
  return raster;
}

function shift(raster: Raster, x: number, y: number, delta: number): Raster {
  const next = solidRaster(raster.width, raster.height, { r: 0, g: 0, b: 0 });
  next.rgba.set(raster.rgba);
  const i = (y * raster.width + x) * 4;
  next.rgba[i] = Math.min(255, (next.rgba[i] ?? 0) + delta);
  return next;
}

/** 线代那场的满屏网格：svg 打了 canvas，线只探出几像素。 */
function linalgGrid(): SceneCheckInput {
  const lines = Array.from({ length: 17 }, (_, index) => ({
    id: `line-${index}`,
    role: 'other' as const,
    x: -4,
    y: index * 4,
    width: 208,
    height: 2,
  }));
  return {
    id: 'linalg',
    width: 200,
    height: 100,
    frames: [
      {
        tMs: 1000,
        raster: picture(200, 100),
        boxes: [
          { id: 'grid', role: 'other', awbRole: 'canvas', x: -80, y: -80, width: 360, height: 260 },
          ...lines,
          { id: 'det', role: 'text', x: 24, y: 20, width: 80, height: 16, text: 'det = 1.55' },
        ],
      },
    ],
    sameMs: [{ tMs: 1000, first: picture(16, 16), second: picture(16, 16) }],
    seek: [
      {
        tMs: 1000,
        forward: picture(16, 16),
        backward: picture(16, 16),
        shuffled: picture(16, 16),
      },
    ],
    residual: { tMs: 1000, sequence: picture(32, 32), isolated: picture(32, 32) },
  };
}

function clean(id: string): SceneCheckInput {
  const frame = picture();
  return {
    id,
    width: frame.width,
    height: frame.height,
    frames: [
      {
        tMs: 800,
        raster: frame,
        boxes: [{ id: 'title', role: 'text', x: 8, y: 8, width: 20, height: 8, text: id }],
      },
    ],
    sameMs: [{ tMs: 800, first: frame, second: frame }],
    seek: [{ tMs: 800, forward: frame, backward: frame, shuffled: frame }],
    residual: { tMs: 800, sequence: frame, isolated: frame },
  };
}

describe('体检', () => {
  it('五题夹具没有 blocker，线代网格不再算非文字出界', () => {
    const topics = [clean('zugeng'), linalgGrid(), clean('mergesort'), clean('transform'), clean('psych')];
    const issues = checkScenes(topics, { turn: 3 });
    expect(issues.filter((issue) => issue.severity === 'blocker')).toEqual([]);
    expect(issues.filter((issue) => issue.scene_id === 'linalg' && issue.kind.startsWith('LAYOUT'))).toEqual(
      [],
    );
    expect(issues.every((issue) => issue.first_turn === 3 && issue.status === 'open')).toBe(true);
  });

  it('贴边不算，打了 canvas 的满屏 svg 不算，真正探出去的才记', () => {
    const issues = checkScenes([
      {
        id: 'overflow',
        width: 200,
        height: 100,
        frames: [
          {
            tMs: 100,
            boxes: [
              { id: 'near', role: 'other', x: -10, y: 0, width: 30, height: 4 },
              { id: 'sheet', role: 'other', awbRole: 'canvas', x: -80, y: -80, width: 400, height: 300 },
              { id: 'axis', role: 'other', x: -80, y: 10, width: 20, height: 4 },
              { id: 'label', role: 'text', x: -90, y: 10, width: 30, height: 12, text: '说明' },
            ],
          },
          {
            tMs: 400,
            boxes: [{ id: 'label', role: 'text', x: -90, y: 10, width: 30, height: 12, text: '说明' }],
          },
        ],
      },
    ]);
    expect(issues.map((issue) => issue.fingerprint)).toEqual([
      'LAYOUT_OVERFLOW_OTHER|overflow|axis|0',
      'LAYOUT_OVERFLOW_TEXT|overflow|说明|0',
    ]);
    expect(issues.map((issue) => issue.severity)).toEqual(['minor', 'major']);
    expect(issues[1]!.fingerprint).toBe('LAYOUT_OVERFLOW_TEXT|overflow|说明|0');
    expect(issues[1]!.id).toBe('L2');
  });

  it('容器里的文字不算字叠，文字互相压住才算', () => {
    const nested = checkScenes([
      {
        id: 'card',
        width: 200,
        height: 100,
        frames: [
          {
            tMs: 0,
            boxes: [
              { id: 'block', role: 'text', x: 0, y: 0, width: 80, height: 40, text: '整段' },
              { id: 'word', role: 'text', x: 8, y: 8, width: 20, height: 12, text: '词' },
            ],
          },
        ],
      },
    ]);
    expect(nested).toEqual([]);

    const stacked = checkScenes([
      {
        id: 'card',
        width: 200,
        height: 100,
        frames: [
          {
            tMs: 0,
            boxes: [
              { id: 'a', role: 'text', x: 0, y: 0, width: 40, height: 20, text: '甲' },
              { id: 'b', role: 'text', x: 10, y: 4, width: 40, height: 20, text: '乙' },
            ],
          },
        ],
      },
    ]);
    expect(stacked.map((issue) => issue.kind)).toEqual(['LAYOUT_OVERLAP']);
    expect(stacked[0]!.severity).toBe('major');
  });

  it('24 个像素不算残留，成块留下的算', () => {
    const stage = solidRaster(200, 200, { r: 0, g: 0, b: 0 });
    const speck = solidRaster(200, 200, { r: 0, g: 0, b: 0 });
    paint(speck, 1, 1, 6, 4, { r: 220, g: 20, b: 20 });
    const quiet = checkScenes([
      { id: 's', width: 200, height: 200, residual: { tMs: 500, sequence: speck, isolated: stage } },
    ]);
    expect(quiet).toEqual([]);

    const leaked = solidRaster(32, 32, { r: 0, g: 0, b: 0 });
    paint(leaked, 4, 4, 10, 10, { r: 220, g: 20, b: 20 });
    const loud = checkScenes([
      {
        id: 's',
        width: 32,
        height: 32,
        residual: { tMs: 500, sequence: leaked, isolated: solidRaster(32, 32, { r: 0, g: 0, b: 0 }) },
      },
    ]);
    expect(loud.map((issue) => [issue.kind, issue.severity, issue.id])).toEqual([
      ['RESIDUAL', 'blocker', 'R1'],
    ]);
  });

  it('同毫秒色差超过 2 才记，后向要同时超过 24 和画面的 0.1%', () => {
    const base = picture(16, 16);
    const two = shift(base, 2, 2, 2);
    const three = shift(base, 2, 2, 3);
    const same = checkScenes([
      { id: 's', width: 16, height: 16, sameMs: [{ tMs: 200, first: base, second: two }] },
    ]);
    expect(same).toEqual([]);
    const drifted = checkScenes([
      { id: 's', width: 16, height: 16, sameMs: [{ tMs: 200, first: base, second: three }] },
    ]);
    expect(drifted.map((issue) => [issue.kind, issue.severity])).toEqual([['SEEK_SAME_MS', 'major']]);

    const hot = shift(base, 2, 2, 30);
    const back = checkScenes([
      {
        id: 's',
        width: 16,
        height: 16,
        seek: [{ tMs: 200, forward: base, backward: hot, shuffled: base }],
      },
    ]);
    expect(back.map((issue) => issue.kind)).toEqual(['SEEK_BACKWARD']);

    const wide = picture(100, 100);
    const one = shift(wide, 2, 2, 30);
    const sparse = checkScenes([
      {
        id: 's',
        width: 100,
        height: 100,
        seek: [{ tMs: 200, forward: wide, backward: one, shuffled: wide }],
      },
    ]);
    expect(sparse).toEqual([]);
  });

  it('黑屏比超过 0.1 才是 blocker，单帧几乎是空的单独记', () => {
    const empty = solidRaster(32, 32, { r: 0, g: 0, b: 0 });
    const full = picture(32, 32);
    const black = checkScenes([{ id: 's', width: 32, height: 32, frames: [{ tMs: 0, raster: empty }] }]);
    expect(black.map((issue) => [issue.kind, issue.severity])).toEqual([
      ['BLANK', 'major'],
      ['BLANK', 'blocker'],
    ]);
    expect(black[0]!.evidence.text).toBe('画面几乎是空的');

    const frames = [
      { tMs: 0, raster: empty },
      ...Array.from({ length: 19 }, (_, i) => ({ tMs: (i + 1) * 500, raster: full })),
    ];
    const sparse = checkScenes([{ id: 's', width: 32, height: 32, frames }]);
    expect(sparse.map((issue) => issue.severity)).toEqual(['major']);
  });

  it('控制台错误和采样时刻', () => {
    const issues = checkScenes([{ id: 's', width: 10, height: 10, consoleErrors: ['', 'pageerror: boom'] }]);
    expect(issues).toMatchObject([
      { id: 'C1', kind: 'CONSOLE', severity: 'major', evidence: { text: 'pageerror: boom' } },
    ]);
    expect(seekTimes(10_000)).toEqual([500, 2000, 3500, 5000, 6500, 8000, 9500]);
  });
});
