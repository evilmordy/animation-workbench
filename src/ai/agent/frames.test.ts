import { inflateSync } from 'node:zlib';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { platform } from '../../platform';
import { resetMockFs } from '../../platform/mock';
import { parseStoryboard, type Scene, type Storyboard } from '../../shared/schema';
import { captureWithHarness, isolateScene, sceneWindow, type HarnessPage } from './capture';
import { diskFrameStore, frameName, planCapture } from './frames';
import { isAnimPath, isFramePath } from './paths';
import { checkLayout, compareResidual, encodePng, solidRaster, type Raster, type Rgb } from './check/pixels';
import { launchPlaywrightHarness } from './playwrightCapture';

const meta = {
  title: 't',
  mode: '2d' as const,
  aspect: '16:9' as const,
  background: '#000000',
  stylePreset: '3b1b' as const,
};

function board(scenes: Scene[]): Storyboard {
  const parsed = parseStoryboard({ schemaVersion: 1, meta, scenes });
  if (!parsed.ok) throw new Error(parsed.issues.map((issue) => `${issue.path} ${issue.message}`).join('; '));
  return parsed.value;
}

function scene(over: Partial<Scene> & Pick<Scene, 'id' | 'kind'>): Scene {
  return {
    title: over.id,
    description: '一场',
    enter: 'fresh',
    hold: 1,
    elements: [],
    steps: [],
    ...over,
  };
}

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

function fakeHarness() {
  const log: string[] = [];
  let closed = false;
  const page: HarnessPage = {
    onConsoleError(listener) {
      listener('pageerror: boom');
    },
    async gotoHarness() {
      log.push('goto');
    },
    async run(sb) {
      log.push(`run:${sb.scenes.map((item) => `${item.id}:${item.enter}`).join('+')}:${sb.scenes.length}`);
      return {
        errors: [],
        scenes: sb.scenes.map((item, index) => ({ id: item.id, start: index, end: index + 1 })),
        duration: sb.scenes.length,
      };
    },
    async seek(t) {
      log.push(`seek:${t}`);
    },
    async wait() {
      log.push('wait');
    },
    async grab() {
      log.push('grab');
      const raster = solidRaster(2, 2, { r: 0, g: 0, b: 0 });
      return { png: encodePng(raster), raster, boxes: [] };
    },
    async close() {
      closed = true;
      log.push('close');
    },
  };
  return {
    page,
    log,
    get closed() {
      return closed;
    },
  };
}

beforeEach(() => {
  resetMockFs();
  setActivePinia(createPinia());
});

describe('截帧路径与像素', () => {
  it('PNG 能被 zlib 解回像素，帧路径只允许 frames/ 下的固定名字', () => {
    const png = encodePng(solidRaster(1, 1, { r: 9, g: 8, b: 7 }));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(8)).toBe(13);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    expect(view.getUint32(16)).toBe(1);
    expect(view.getUint32(20)).toBe(1);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
    const idatLen = view.getUint32(33);
    expect(String.fromCharCode(...png.subarray(37, 41))).toBe('IDAT');
    expect([...inflateSync(png.subarray(41, 41 + idatLen))]).toEqual([0, 9, 8, 7, 255]);

    const name = frameName('s_code', 'sequence', 'start');
    expect(name).toBe('frames/s_code-sequence-start.png');
    expect(isFramePath(name)).toBe(true);
    expect(isAnimPath(name)).toBe(false);
    expect(isFramePath('frames/../storyboard.json')).toBe(false);
    expect(isFramePath('plan.md')).toBe(false);
    expect(isAnimPath('plan.md')).toBe(true);
  });

  it('超出 48px 才算出界，字叠写成摘要', () => {
    const clean = checkLayout({
      width: 32,
      height: 32,
      boxes: [{ id: 'title', role: 'text', x: 2, y: 2, width: 8, height: 4, text: '标题' }],
    });
    expect(clean.summary).toBe('没有发现出界或字叠。');

    const nearEdge = checkLayout({
      width: 32,
      height: 32,
      boxes: [{ id: 'grid', role: 'other', x: -10, y: 0, width: 40, height: 2 }],
    });
    expect(nearEdge.outOfBounds).toEqual([]);

    const crowded = checkLayout({
      width: 32,
      height: 32,
      boxes: [
        { id: 'title', role: 'text', x: -60, y: 4, width: 80, height: 8, text: '标题' },
        { id: 'body', role: 'text', x: -4, y: 6, width: 20, height: 10, text: '说明' },
      ],
    });
    expect(crowded.summary).toContain('出界');
    expect(crowded.summary).toContain('超出左边');
    expect(crowded.summary).toContain('字叠');
    const nested = checkLayout({
      width: 32,
      height: 32,
      boxes: [
        { id: 'card', role: 'other', x: 1, y: 1, width: 20, height: 12 },
        { id: 'label', role: 'text', x: 2, y: 2, width: 10, height: 4, text: '标题' },
      ],
    });
    expect(nested.overlaps).toEqual([]);
    const wrapped = checkLayout({
      width: 40,
      height: 20,
      boxes: [
        { id: 'block', role: 'text', x: 0, y: 0, width: 30, height: 10, text: '整段' },
        { id: 'word', role: 'text', x: 2, y: 2, width: 8, height: 4, text: '词' },
      ],
    });
    expect(wrapped.overlaps).toEqual([]);

    const edge = solidRaster(8, 8, { r: 0, g: 0, b: 0 });
    paint(edge, 0, 0, 8, 1, { r: 255, g: 255, b: 255 });
    const edged = checkLayout({ width: 8, height: 8, boxes: [], raster: edge });
    expect(edged.summary).toContain('布局检查不可用');
    expect(edged.summary).not.toContain('像素');
    const canvas = checkLayout({
      width: 32,
      height: 32,
      boxes: [{ id: 'grid', role: 'other', awbRole: 'canvas', x: -80, y: -80, width: 200, height: 200 }],
    });
    expect(canvas.outOfBounds).toEqual([]);
  });

  it('整片比单场多出的色块算残留，像素相同则不算', () => {
    const isolated = solidRaster(32, 32, { r: 0, g: 0, b: 0 });
    const same = compareResidual(solidRaster(32, 32, { r: 0, g: 0, b: 0 }), isolated);
    expect(same.suspect).toBe(false);
    expect(same.summary).toContain('没有明显换场残留');

    const sequence = solidRaster(32, 32, { r: 0, g: 0, b: 0 });
    paint(sequence, 8, 8, 6, 6, { r: 220, g: 20, b: 20 });
    const leaked = compareResidual(sequence, isolated);
    expect(leaked.suspect).toBe(true);
    expect(leaked.leftoverPixels).toBe(36);
    expect(leaked.summary).toContain('像素差');
    expect(leaked.summary).toContain('不是 opacity');
    const speck = solidRaster(32, 32, { r: 0, g: 0, b: 0 });
    paint(speck, 1, 1, 2, 2, { r: 220, g: 20, b: 20 });
    expect(compareResidual(speck, isolated).suspect).toBe(false);
    expect(compareResidual(sequence, solidRaster(16, 16, { r: 0, g: 0, b: 0 })).summary).toContain(
      '尺寸不同',
    );
  });
});

describe('帧文件', () => {
  it('帧文件写在 .awb/anim/frames，拒绝旁路以外的路径', async () => {
    const png = encodePng(solidRaster(1, 1, { r: 1, g: 2, b: 3 }));
    const store = diskFrameStore('/proj');
    await store.write('frames/s_code-sequence-start.png', png);
    expect([...(await store.read('frames/s_code-sequence-start.png'))!]).toEqual([...png]);
    expect(await platform.exists('/proj/.awb/anim/frames/s_code-sequence-start.png')).toBe(true);
    await expect(store.write('plan.md', png)).rejects.toThrow('拒绝写入');
    await expect(store.write('frames/../../storyboard.json', png)).rejects.toThrow('拒绝写入');
    expect(await store.read('../storyboard.json')).toBeNull();
  });

  it('点名场次可以是 dsl，没有代码场时说明原因', () => {
    const named = planCapture(board([scene({ id: 's_old', kind: 'dsl' })]), {
      sceneIds: ['s_old'],
      isolated: false,
    });
    expect(named.ok).toBe(true);
    if (named.ok) expect(named.request.shots).toEqual([{ sceneId: 's_old', at: 'end', isolated: false }]);
    const empty = planCapture(board([scene({ id: 's_old', kind: 'dsl' })]), {});
    expect(empty.ok).toBe(false);
  });
});

describe('Playwright 预览页协议', () => {
  it('整片 seek 之后再单场渲染，并在失败时关闭页面', async () => {
    const sb = board([scene({ id: 's_code', kind: 'code', enter: 'keep', code: 'x' })]);
    const harness = fakeHarness();
    const batch = await captureWithHarness(
      {
        storyboard: sb,
        shots: [{ sceneId: 's_code', at: 'start', isolated: true }],
      },
      async () => harness.page,
      'fake-harness',
    );
    expect(sb.scenes[0]!.enter).toBe('keep');
    expect(harness.closed).toBe(true);
    expect(harness.log).toEqual([
      'goto',
      'run:s_code:keep:1',
      'seek:0',
      'wait',
      'grab',
      'run:s_code:fresh:1',
      'seek:0',
      'wait',
      'grab',
      'run:s_code:keep:1',
      'close',
    ]);
    expect(batch.backend).toBe('fake-harness');
    expect(batch.frames.map((frame) => frame.source)).toEqual(['sequence', 'isolated']);
    expect(batch.frames[0]!.consoleErrors).toEqual(['pageerror: boom']);
    expect(isolateScene(sb, 's_code').scenes).toHaveLength(1);

    const settled = fakeHarness();
    settled.page.run = async (sb) => ({
      errors: [],
      scenes: [{ id: sb.scenes[0]!.id, start: 0, end: 1 }],
      duration: 4.5,
    });
    await captureWithHarness(
      { storyboard: sb, shots: [{ sceneId: 's_code', at: 'end', isolated: false }] },
      async () => settled.page,
    );
    expect(settled.log.some((line) => line.startsWith('seek:4.49'))).toBe(true);
    expect(sceneWindow({ scenes: [{ id: 's_code', start: 0, end: 1 }], duration: 4.5 }, 's_code')).toEqual({
      start: 0,
      end: 4.5,
    });
    expect(
      sceneWindow(
        {
          scenes: [
            { id: 'a', start: 0, end: 2 },
            { id: 'b', start: 2, end: 5 },
          ],
          duration: 5,
        },
        'b',
      ),
    ).toEqual({ start: 2, end: 5 });

    const broken = fakeHarness();
    broken.page.run = async () => {
      throw new Error('预览崩了');
    };
    await expect(
      captureWithHarness(
        { storyboard: sb, shots: [{ sceneId: 's_code', at: 'start', isolated: false }] },
        async () => broken.page,
      ),
    ).rejects.toThrow('预览崩了');
    expect(broken.closed).toBe(true);
  });

  it('预览文件缺失时不启动浏览器', async () => {
    await expect(launchPlaywrightHarness('/tmp/awb-no-such-runtime-s5')).rejects.toThrow('预览文件不存在');
  });
});
