/** 模型用宽松的分文件代码块交卷。只认 plan / rubric / shared / scenes/<id>.js。 */

export interface AgentFile {
  /** plan.md、rubric.json、shared.js，或 scenes/<id>.js */
  name: string;
  content: string;
}

const FILE_PATH =
  /((?:anim\/)?(?:plan\.md|rubric\.json|shared\.js|scenes\/[A-Za-z_][A-Za-z0-9_-]{0,63}\.js))/;

export function canonicalAnimName(raw: string): string | null {
  const matched = FILE_PATH.exec(raw.trim());
  if (!matched?.[1] || matched[1].includes('..')) return null;
  return matched[1].replace(/^anim\//, '');
}

export function isAnimPath(name: string): boolean {
  return /^(plan\.md|rubric\.json|shared\.js|scenes\/[A-Za-z_][A-Za-z0-9_-]{0,63}\.js)$/.test(name);
}

export function sceneIdFromName(name: string): string | null {
  return /^scenes\/([A-Za-z_][A-Za-z0-9_-]{0,63})\.js$/.exec(name)?.[1] ?? null;
}

function takeNamed(info: string, body: string): { name: string; content: string } | null {
  const fromInfo = canonicalAnimName(info);
  if (fromInfo) return { name: fromInfo, content: body.replace(/\n$/, '') };
  const first = body.split('\n', 1)[0] ?? '';
  const fromLine = /^(?:\/\/|#)\s*(?:file:)?\s*(\S+)\s*$/.exec(first);
  const name = fromLine ? canonicalAnimName(fromLine[1] ?? '') : null;
  if (!name) return null;
  return { name, content: body.slice(first.length + 1).replace(/\n$/, '') };
}

/** 从一轮模型输出里抽出文件。后面的同名块覆盖前面的。没有代码块时，整段 JSON 当作 rubric。 */
export function parseAgentFiles(text: string): AgentFile[] {
  const found = new Map<string, string>();
  const normalized = text.replace(/\r\n/g, '\n');
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  for (let match = fence.exec(normalized); match; match = fence.exec(normalized)) {
    const file = takeNamed(match[1] ?? '', match[2] ?? '');
    if (file && isAnimPath(file.name)) found.set(file.name, file.content);
  }
  if (found.size) return [...found].map(([name, content]) => ({ name, content }));

  const trimmed = normalized.trim();
  if (trimmed.startsWith('{')) {
    try {
      JSON.parse(trimmed);
      return [{ name: 'rubric.json', content: trimmed }];
    } catch {
      return [];
    }
  }
  return [];
}
