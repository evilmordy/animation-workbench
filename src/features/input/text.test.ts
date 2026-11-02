import { describe, expect, it } from 'vitest';
import { decodeText, estimateTokens } from './text';

describe('素材文本', () => {
  it('UTF-8（含 BOM）直接解码', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('勾股定理 abc')]);
    expect(decodeText(bytes)).toEqual({ text: '勾股定理 abc', encoding: 'utf-8' });
  });

  it('GBK 文件出现替换字符时改用 GBK', () => {
    // "勾股定理" 的 GBK 编码
    const gbk = new Uint8Array([0xb9, 0xb4, 0xb9, 0xc9, 0xb6, 0xa8, 0xc0, 0xed]);
    expect(decodeText(gbk)).toEqual({ text: '勾股定理', encoding: 'gbk' });
  });

  it('token 估算', () => {
    expect(estimateTokens('中文四字')).toBe(4);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('PDF 部首字符修正', () => {
  it('部首码位换回正常汉字，其他字符不动', async () => {
    const { fixCjkRadicals } = await import('./cjk');
    expect(fixCjkRadicals('直⻆三⻆形的平⽅，a²，第⼆⻚')).toBe('直角三角形的平方，a²，第二页');
  });
});
