// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { pickLayoutBoxes } from '../../ai/agent/layoutBoxes';
import { checkScenes } from '../../ai/agent/check';
import { collectStageElements } from './domProbe';

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON() {
      return {};
    },
  } as DOMRect;
}

describe('舞台探针', () => {
  it('出界文字走和截帧同一套包围盒', () => {
    const stage = document.createElement('div');
    stage.id = 'stage';
    document.body.appendChild(stage);
    stage.getBoundingClientRect = () => rect(0, 0, 960, 540);
    const text = document.createElement('div');
    text.id = 'title';
    text.textContent = '出界标题';
    text.style.opacity = '1';
    text.style.visibility = 'visible';
    text.style.display = 'block';
    text.getBoundingClientRect = () => rect(-200, 10, 180, 40);
    stage.appendChild(text);
    const elements = collectStageElements(stage);
    expect(elements.map((el) => ({ id: el.id, opacity: el.opacity, width: el.width, x: el.x }))).toEqual([
      { id: 'title', opacity: 1, width: 180, x: -200 },
    ]);
    const picked = pickLayoutBoxes(elements);
    const issues = checkScenes([
      { id: 's_code', width: 960, height: 540, frames: [{ tMs: 0, boxes: picked.boxes }] },
    ]);
    expect(issues.map((issue) => issue.kind)).toContain('LAYOUT_OVERFLOW_TEXT');
    stage.remove();
  });
});
