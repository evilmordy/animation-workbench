/** 从模型输出里取出 JSON：去掉代码围栏，取第一个 { 到最后一个 }（PLAN T3.3） */
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, error: '输出里没有找到 JSON 对象' };
  try {
    return { ok: true, value: JSON.parse(unfenced.slice(start, end + 1)) };
  } catch (e) {
    return { ok: false, error: `JSON 语法错误：${(e as Error).message}` };
  }
}

/**
 * 流式输出过程中，取出 "key": [ ... ] 数组里已经完整的对象（大纲卡片逐个出现用）。
 * 只做括号配对，字符串里的括号会被正确跳过。
 */
export function completeItems(text: string, key: string): unknown[] {
  const at = text.indexOf(`"${key}"`);
  if (at < 0) return [];
  const open = text.indexOf('[', at);
  if (open < 0) return [];
  const items: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') {
      if (depth++ === 0) start = i;
    } else if (c === '}') {
      if (--depth === 0 && start >= 0) {
        try {
          items.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          return items;
        }
      }
    } else if (c === ']' && depth === 0) break;
  }
  return items;
}
