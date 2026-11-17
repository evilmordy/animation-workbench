// @vitest-environment happy-dom
import { createTimeline, utils } from 'animejs';
import { describe, expect, it } from 'vitest';
import { createDsl, RATE_EASE } from './dsl-lib';
import { KATEX_CSS, renderTex } from './katex';

describe('dsl-lib', () => {
  it('woff2 全部内联，公式能渲染', () => {
    expect(KATEX_CSS).not.toContain('url(fonts/');
    expect(KATEX_CSS.match(/data:font\/woff2/g)?.length).toBe(20);
    const node = document.createElement('div');
    document.body.appendChild(node);
    renderTex(node, 'a^2+b^2=c^2');
    expect(node.querySelector('.katex')).toBeTruthy();
  });

  it('anime.js 4 接受自定义缓动函数', () => {
    const tl = createTimeline({ autoplay: false });
    const node = document.createElement('div');
    document.body.appendChild(node);
    const ease = (t: number) => t * t;
    tl.add(node, { x: [0, 100], duration: 1000, ease }, 0);
    tl.seek(500);
    expect(utils.get(node, 'x', false)).toBeCloseTo(25, 5);
    tl.seek(1000);
    expect(utils.get(node, 'x', false)).toBeCloseTo(100, 5);
    for (const [name, fn] of Object.entries(RATE_EASE)) {
      expect(fn(0)).toBeCloseTo(0, 5);
      if (name === 'thereAndBack') expect(fn(1)).toBeCloseTo(0, 5);
      else expect(fn(1)).toBeCloseTo(1, 5);
    }
  });

  it('圆按帧坐标放到舞台中心偏右', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const tl = createTimeline({ autoplay: false });
    const dsl = createDsl({ root, tl, width: 1920, height: 1080 });
    dsl.node({
      id: 'c',
      type: 'Circle',
      props: { radius: 1 },
      color: '#58C4DD',
      strokeWidth: 4,
      scale: 1,
      rotate: 0,
      show: 'enter',
      place: { at: [1, 0] },
    });
    dsl.anim({ type: 'Create', target: 'c', at: 0, duration: 400, ease: 'linear' });
    const node = root.querySelector('[data-awb-id="c"]') as HTMLElement;
    expect(node).toBeTruthy();
    expect(node.querySelector('ellipse')).toBeTruthy();
    const left = parseFloat(node.style.left);
    const unit = 1080 / 8;
    expect(left + parseFloat(node.style.width) / 2).toBeCloseTo(1920 / 2 + unit, 3);
  });
});
