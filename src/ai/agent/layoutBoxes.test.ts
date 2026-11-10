import { describe, expect, it } from 'vitest';
import { isContentBox, pickLayoutBoxes, type RawLayoutElement } from './layoutBoxes';
import { checkScenes } from './check/index';

function el(patch: Partial<RawLayoutElement> = {}): RawLayoutElement {
  return {
    id: 'label',
    layer: false,
    visibility: 'visible',
    display: 'block',
    opacity: 1,
    width: 40,
    height: 20,
    x: 8,
    y: 8,
    text: '标题',
    childElementCount: 0,
    ...patch,
  };
}

describe('DOM 包围盒', () => {
  it('跳过图层、不可见和过小的元素', () => {
    expect(isContentBox(el())).toBe(true);
    expect(isContentBox(el({ id: 'canvas', text: '' }))).toBe(false);
    expect(isContentBox(el({ awbRole: 'canvas', text: '' }))).toBe(false);
    expect(isContentBox(el({ layer: true }))).toBe(false);
    expect(isContentBox(el({ visibility: 'hidden' }))).toBe(false);
    expect(isContentBox(el({ display: 'none' }))).toBe(false);
    expect(isContentBox(el({ opacity: 0 }))).toBe(false);
    expect(isContentBox(el({ width: 1 }))).toBe(false);
  });

  it('超过 40 个时先留文字框', () => {
    const elements = [
      ...Array.from({ length: 45 }, (_, i) => el({ id: `shape-${i}`, text: '', childElementCount: 1 })),
      el({ id: 'caption', text: '字幕' }),
    ];
    const picked = pickLayoutBoxes(elements);
    expect(picked.truncated).toBe(true);
    expect(picked.boxes).toHaveLength(40);
    expect(picked.boxes[0]).toMatchObject({ id: 'caption', role: 'text', text: '字幕' });
    expect(picked.boxes.some((box) => box.id === 'shape-44')).toBe(false);
  });

  it('视口外的网格线先裁到根 svg，再给出界', () => {
    const clip = { x: 0, y: 0, width: 960, height: 540 };
    // D/线代 s_basis 实拍：变形后的网格组伸出舞台 122px，svg 视口仍是 960×540。
    const grid = el({
      id: '',
      text: '',
      childElementCount: 1,
      x: -100,
      y: -102.5,
      width: 900,
      height: 765,
      svgClip: clip,
    });
    const bare = checkScenes([
      {
        id: 's_basis',
        width: 960,
        height: 540,
        frames: [
          {
            tMs: 18099,
            boxes: [{ id: 'other-2', role: 'other', x: -100, y: -102.5, width: 900, height: 765 }],
          },
        ],
      },
    ]);
    expect(bare.map((issue) => issue.kind)).toEqual(['LAYOUT_OVERFLOW_OTHER']);
    const picked = pickLayoutBoxes([grid]);
    expect(picked.boxes[0]).toMatchObject({ x: 0, y: 0, width: 800, height: 540 });
    const clipped = checkScenes([
      { id: 's_basis', width: 960, height: 540, frames: [{ tMs: 18099, boxes: picked.boxes }] },
    ]);
    expect(clipped).toEqual([]);
    const outside = pickLayoutBoxes([
      el({ id: 'gone', text: '', x: -400, y: 10, width: 40, height: 20, svgClip: clip }),
    ]);
    expect(outside.boxes).toEqual([]);
  });
});
