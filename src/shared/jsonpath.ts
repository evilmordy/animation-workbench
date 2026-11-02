/**
 * 在 JSON 文本里定位某个路径（如 scenes[0].steps[1].duration）对应值的起止偏移，
 * 用于把校验错误标到编辑器的具体位置。文本必须是合法 JSON。
 */
export function locate(json: string, path: string): { from: number; to: number } | null {
  const want = path ? path.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '') : '';
  const spans = new Map<string, { from: number; to: number }>();
  let i = 0;

  const ws = () => {
    while (i < json.length && /\s/.test(json[i]!)) i++;
  };
  const str = () => {
    const start = i++;
    while (i < json.length && json[i] !== '"') i += json[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(json.slice(start, i)) as string;
  };
  const value = (p: string) => {
    ws();
    const from = i;
    const c = json[i];
    if (c === '{') {
      i++;
      ws();
      while (json[i] !== '}') {
        ws();
        const key = str();
        ws();
        i++; // :
        value(p ? `${p}.${key}` : key);
        ws();
        if (json[i] === ',') i++;
        ws();
      }
      i++;
    } else if (c === '[') {
      i++;
      ws();
      let k = 0;
      while (json[i] !== ']') {
        value(p ? `${p}.${k}` : String(k));
        k++;
        ws();
        if (json[i] === ',') i++;
        ws();
      }
      i++;
    } else if (c === '"') {
      str();
    } else {
      while (i < json.length && !/[\s,}\]]/.test(json[i]!)) i++;
    }
    spans.set(p, { from, to: i });
  };

  try {
    value('');
  } catch {
    return null;
  }
  // 路径不存在（例如缺字段）时退到最近的存在的父路径
  for (let p = want; ; p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '') {
    const s = spans.get(p);
    if (s) return s;
    if (!p) return null;
  }
}
