import { describe, expect, it } from 'vitest';
import { locate } from './jsonpath';

const text = JSON.stringify({ a: { 'b"x': [1, { c: 'hi' }] }, d: true }, null, 2);
const at = (path: string) => {
  const r = locate(text, path);
  return r && text.slice(r.from, r.to);
};

describe('locate', () => {
  it('定位对象、数组、字符串和转义键', () => {
    expect(at('a.b"x[0]')).toBe('1');
    expect(at('a.b"x[1].c')).toBe('"hi"');
    expect(at('d')).toBe('true');
    expect(at('')).toBe(text);
  });

  it('不存在的路径退到父级', () => {
    expect(at('a.b"x[1].missing')).toBe('{\n        "c": "hi"\n      }');
    expect(at('zzz')).toBe(text);
  });

  it('非法 JSON 返回 null', () => {
    expect(locate('{ "a": ', 'a')).toBeNull();
  });
});
