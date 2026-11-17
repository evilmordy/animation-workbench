import { describe, expect, it } from 'vitest';
import { rewriteIntent } from './rewrite';

describe('按场景描述重写', () => {
  it('只用标题和描述，不带旧签名', () => {
    const text = rewriteIntent([
      { id: 's1', title: '圆', description: '一个圆慢慢出现' },
      { id: 's2', title: '', description: '' },
    ]);
    expect(text).toContain('s1');
    expect(text).toContain('一个圆慢慢出现');
    expect(text).toContain('s2');
    expect(text).not.toContain('(scene, M, ctx)');
  });
});
