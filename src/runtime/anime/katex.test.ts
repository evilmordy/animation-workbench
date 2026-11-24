// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { KATEX_CSS, renderTex } from './katex';

describe('KaTeX 字体', () => {
  it('woff2 全部内联成 data:，样式里不再有字体文件地址', () => {
    expect(KATEX_CSS).not.toContain('url(fonts/');
    expect(KATEX_CSS).toContain('data:font/woff2');
    expect(KATEX_CSS.match(/data:font\/woff2/g)?.length).toBe(20);
  });

  it('公式同步渲染出 katex 节点', () => {
    const node = document.createElement('div');
    document.body.appendChild(node);
    renderTex(node, 'a^2');
    expect(node.querySelector('.katex')).toBeTruthy();
    expect(document.getElementById('awb-katex-css')?.textContent).toContain('data:font/woff2');
    expect(document.getElementById('awb-katex-css')?.textContent).not.toContain('text-shadow');
  });

  it('只把上标再抬高，下标不动', () => {
    const tops = (latex: string) => {
      const node = document.createElement('div');
      document.body.appendChild(node);
      renderTex(node, latex);
      return [...node.querySelectorAll('.vlist > span')].map((el) => (el as HTMLElement).style.top);
    };
    // KaTeX 0.19.1 上标原值是 -3.063em，下标是 -2.55em。只改更靠上的那一行。
    expect(tops('a^2').filter(Boolean)).toEqual(['-3.123em']);
    expect(tops('a_2').filter(Boolean)).toEqual(['-2.55em']);
  });
});
