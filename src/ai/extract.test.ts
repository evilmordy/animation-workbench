import { describe, expect, it } from 'vitest';
import { completeItems, extractJson } from './extract';

describe('extractJson', () => {
  it('去掉代码围栏和前后说明', () => {
    expect(extractJson('好的：\n```json\n{"a": 1}\n```\n希望有帮助')).toEqual({ ok: true, value: { a: 1 } });
  });
  it('没有 JSON 或语法错误', () => {
    expect(extractJson('抱歉')).toMatchObject({ ok: false });
    expect(extractJson('{"a": }')).toMatchObject({
      ok: false,
      error: expect.stringContaining('JSON 语法错误'),
    });
  });
});

describe('completeItems', () => {
  it('流式输出中只取完整的对象，字符串里的括号不干扰', () => {
    const partial = '{"title":"t","scenes":[{"title":"a{1}","d":"x\\"}"},{"title":"b"},{"title":"c';
    expect(completeItems(partial, 'scenes')).toEqual([{ title: 'a{1}', d: 'x"}' }, { title: 'b' }]);
    expect(completeItems('{"title":"t"', 'scenes')).toEqual([]);
  });
});
