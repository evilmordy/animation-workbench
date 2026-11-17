/** 共享常量块。行号按折叠后的 code_numbered，改块内行要走 write_shared。 */

export const SHARED_START = '/* @awb-shared */';
export const SHARED_END = '/* @awb-shared-end */';

export function splitShared(code: string): { shared: string; body: string } {
  const start = code.indexOf(SHARED_START);
  const end = code.indexOf(SHARED_END);
  if (start < 0 || end < start) return { shared: '', body: code };
  const shared = code
    .slice(start + SHARED_START.length, end)
    .replace(/^\n/, '')
    .replace(/\n$/, '');
  const before = code.slice(0, start).replace(/\n$/, '');
  const after = code.slice(end + SHARED_END.length).replace(/^\n/, '');
  const body = [before, after].filter((part) => part.length > 0).join('\n');
  return { shared, body };
}

export function joinShared(shared: string, body: string): string {
  const source = shared.trim();
  const code = body.trim();
  if (!source) return code ? `${code}\n` : '';
  return `${SHARED_START}\n${source}\n${SHARED_END}\n${code}\n`;
}

export interface NumberedLine {
  n: number;
  text: string;
  shared: boolean;
}

/** 共享块折成一行，其余按源码换行。行号从 1 开始，给 edit_range 用。 */
export function numberedLines(code: string): NumberedLine[] {
  const { shared, body } = splitShared(code);
  const lines: NumberedLine[] = [];
  if (code.includes(SHARED_START) && code.includes(SHARED_END)) {
    const count = shared ? shared.split('\n').length : 0;
    lines.push({ n: 1, text: `// @awb-shared（${count} 行，见 shared）`, shared: true });
  }
  const normalized = body.endsWith('\n') ? body.slice(0, -1) : body;
  const bodyLines = normalized.length ? normalized.split('\n') : [];
  for (const text of bodyLines) lines.push({ n: lines.length + 1, text, shared: false });
  if (!lines.length) lines.push({ n: 1, text: '', shared: false });
  return lines;
}

export function formatNumbered(code: string): string {
  return numberedLines(code)
    .map((line) => `${String(line.n).padStart(4, ' ')}| ${line.text}`)
    .join('\n');
}

/** 行号是 code_numbered。碰到共享块那一行就拒绝。replacement 为空表示删掉这些行。 */
export function applyRange(
  code: string,
  start: number,
  end: number,
  replacement: string,
): { ok: true; code: string } | { ok: false; message: string } {
  const lines = numberedLines(code);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lines.length) {
    return { ok: false, message: '行号超出 code_numbered' };
  }
  if (lines.slice(start - 1, end).some((line) => line.shared)) {
    return { ok: false, message: '不能改共享常量块，请用 write_shared' };
  }
  const { shared } = splitShared(code);
  const body = lines.filter((line) => !line.shared);
  const bodyStart = lines.slice(0, start - 1).filter((line) => !line.shared).length;
  const bodyEnd = lines.slice(0, end).filter((line) => !line.shared).length;
  const inserted = replacement === '' ? [] : replacement.replace(/\n$/, '').split('\n');
  const next = [
    ...body.slice(0, bodyStart).map((line) => line.text),
    ...inserted,
    ...body.slice(bodyEnd).map((line) => line.text),
  ];
  return { ok: true, code: joinShared(shared, next.join('\n')) };
}

export function replaceShared(code: string, shared: string): string {
  return joinShared(shared, splitShared(code).body);
}
