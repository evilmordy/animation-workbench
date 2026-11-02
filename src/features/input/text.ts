/** 文本文件解码：先按 UTF-8，出现替换字符时改用 GBK（PLAN T4.1） */
export function decodeText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'gbk' } {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('\uFFFD')) return { text: utf8.replace(/^\uFEFF/, ''), encoding: 'utf-8' };
  return { text: new TextDecoder('gbk').decode(bytes), encoding: 'gbk' };
}

/** 粗略 token 估算：中日韩字符约 1 token/字，其余约 4 字符/token */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/g) ?? []).length;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

export const TEXT_EXTENSIONS = [
  'txt',
  'md',
  'markdown',
  'py',
  'js',
  'ts',
  'java',
  'c',
  'cpp',
  'h',
  'go',
  'rs',
  'cs',
  'json',
  'csv',
  'html',
  'tex',
];
