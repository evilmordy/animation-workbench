import awbSource from '../../../runtime/anime/awb.ts?raw';
import { bannedRuleLabels } from '../check/gate';

function flattenDoc(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .join('');
}

function interfaceSpan(source: string): { comment: string; body: string } {
  const marker = 'export interface AwbSceneScope';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('AwbSceneScope 不在 helper 源里');
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const before = source.slice(Math.max(0, start - 800), start);
  const comment = before.match(/\/\*\*([\s\S]*?)\*\/\s*$/)?.[1] ?? '';
  return { comment, body: source.slice(open + 1, end) };
}

/** 接口成员名。没有紧挨着的 JSDoc 时，速查表会对不上，测试会失败。 */
export function helperMemberNames(source = awbSource): string[] {
  const { body } = interfaceSpan(source);
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/^\s{2}(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[(<:]/gm)].map(
    (match) => match[1] ?? '',
  );
}

export function helperLines(source = awbSource): { name: string; doc: string }[] {
  const { body } = interfaceSpan(source);
  const lines: { name: string; doc: string }[] = [];
  const re = /\/\*\*([\s\S]*?)\*\/\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const match of body.matchAll(re)) {
    const name = match[2] ?? '';
    const doc = flattenDoc(match[1] ?? '');
    if (name && doc) lines.push({ name, doc });
  }
  return lines;
}

/** 时间参数那一句从接口注释里抽出，不手写第二份。 */
export function helperCheatSheet(source = awbSource): string {
  const { comment } = interfaceSpan(source);
  const flat = flattenDoc(comment);
  const aboutAt = flat
    .split('。')
    .map((part) => part.trim())
    .filter((part) => part.includes('at') || part.includes('+=') || part.includes('<<'));
  const timing = aboutAt.length ? `${aboutAt.join('。')}。` : flat;
  const rows = helperLines(source).map((line) => `${line.name} ${line.doc}`);
  return [timing, ...rows].filter(Boolean).join('\n');
}

/** 与运行门同一份规则名，顿号连接。 */
export function bannedCheatSheet(): string {
  return bannedRuleLabels().join('、');
}
