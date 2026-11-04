import { describe, expect, it } from 'vitest';
import { parseRenderer, playbackRenderer, previewPageUrl, resolveAgentRenderer } from './renderer';

describe('代码场渲染选择', () => {
  it('只认 gsap 和 manim', () => {
    expect(parseRenderer('gsap')).toBe('gsap');
    expect(parseRenderer('{"renderer":"manim"}')).toBe('manim');
    expect(parseRenderer('{"renderer":"other"}')).toBeNull();
    expect(parseRenderer('nope')).toBeNull();
    expect(parseRenderer('')).toBeNull();
  });

  it('没选过或还夹着 dsl 场时不切到 GSAP', () => {
    expect(playbackRenderer(null, [{ kind: 'code' }])).toBe('manim');
    expect(playbackRenderer('manim', [{ kind: 'code' }])).toBe('manim');
    expect(playbackRenderer('gsap', [])).toBe('manim');
    expect(playbackRenderer('gsap', [{ kind: 'dsl' }, { kind: 'code' }])).toBe('manim');
    expect(playbackRenderer('gsap', [{ kind: 'code' }, { kind: 'code' }])).toBe('gsap');
  });

  it('空项目用设置里的默认，已有代码场保持 manim', () => {
    expect(resolveAgentRenderer({ sidecar: null, fallback: 'gsap', hasCodeScenes: false })).toBe('gsap');
    expect(resolveAgentRenderer({ sidecar: null, fallback: 'manim', hasCodeScenes: false })).toBe('manim');
    expect(resolveAgentRenderer({ sidecar: null, fallback: 'gsap', hasCodeScenes: true })).toBe('manim');
    expect(resolveAgentRenderer({ sidecar: 'gsap', fallback: 'manim', hasCodeScenes: true })).toBe('gsap');
  });

  it('关掉代码场景时预览地址不变', () => {
    const base = '/__awpreview/index.html';
    expect(previewPageUrl(base, 'gsap', false)).toBe(base);
    expect(previewPageUrl(base, 'manim', true)).toBe(base);
    expect(previewPageUrl(base, 'gsap', true)).toBe('/__awpreview/gsap.html');
    expect(previewPageUrl('http://awpreview.localhost/index.html?x=1', 'gsap', true)).toBe(
      'http://awpreview.localhost/gsap.html?x=1',
    );
  });
});
