import { describe, expect, it } from 'vitest';
import { filmUsesAnime, previewPageUrl } from './renderer';

describe('预览页', () => {
  it('整片都是代码场才换 anime.html', () => {
    expect(filmUsesAnime(false, [{ kind: 'code' }])).toBe(false);
    expect(filmUsesAnime(true, [])).toBe(false);
    expect(filmUsesAnime(true, [{ kind: 'dsl' }])).toBe(false);
    expect(filmUsesAnime(true, [{ kind: 'dsl' }, { kind: 'code' }])).toBe(false);
    expect(filmUsesAnime(true, [{ kind: 'code' }, { kind: 'code' }])).toBe(true);
  });

  it('不走 anime 时预览地址不变', () => {
    const base = '/__awpreview/index.html';
    expect(previewPageUrl(base, false)).toBe(base);
    expect(previewPageUrl(base, true)).toBe('/__awpreview/anime.html');
    expect(previewPageUrl('http://awpreview.localhost/index.html?x=1', true)).toBe(
      'http://awpreview.localhost/anime.html?x=1',
    );
  });
});
