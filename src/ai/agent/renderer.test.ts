import { describe, expect, it } from 'vitest';
import { parseRenderer, playbackRenderer, previewPageUrl, resolveAgentRenderer } from './renderer';

describe('代码场渲染选择', () => {
  it('只认 anime 和 manim', () => {
    expect(parseRenderer('anime')).toBe('anime');
    expect(parseRenderer('{"renderer":"manim"}')).toBe('manim');
    expect(parseRenderer('{"renderer":"other"}')).toBeNull();
    expect(parseRenderer('nope')).toBeNull();
    expect(parseRenderer('')).toBeNull();
  });

  it('没选过或还夹着 dsl 场时不切到 anime.js', () => {
    expect(playbackRenderer(null, [{ kind: 'code' }])).toBe('manim');
    expect(playbackRenderer('manim', [{ kind: 'code' }])).toBe('manim');
    expect(playbackRenderer('anime', [])).toBe('manim');
    expect(playbackRenderer('anime', [{ kind: 'dsl' }, { kind: 'code' }])).toBe('manim');
    expect(playbackRenderer('anime', [{ kind: 'code' }, { kind: 'code' }])).toBe('anime');
  });

  it('空项目用设置里的默认，已有代码场保持 manim', () => {
    expect(resolveAgentRenderer({ sidecar: null, fallback: 'anime', hasCodeScenes: false })).toBe('anime');
    expect(resolveAgentRenderer({ sidecar: null, fallback: 'manim', hasCodeScenes: false })).toBe('manim');
    expect(resolveAgentRenderer({ sidecar: null, fallback: 'anime', hasCodeScenes: true })).toBe('manim');
    expect(resolveAgentRenderer({ sidecar: 'anime', fallback: 'manim', hasCodeScenes: true })).toBe('anime');
  });

  it('关掉代码场景时预览地址不变', () => {
    const base = '/__awpreview/index.html';
    expect(previewPageUrl(base, 'anime', false)).toBe(base);
    expect(previewPageUrl(base, 'manim', true)).toBe(base);
    expect(previewPageUrl(base, 'anime', true)).toBe('/__awpreview/anime.html');
    expect(previewPageUrl('http://awpreview.localhost/index.html?x=1', 'anime', true)).toBe(
      'http://awpreview.localhost/anime.html?x=1',
    );
  });
});
