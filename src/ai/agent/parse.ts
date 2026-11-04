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

/**
 * 截帧 PNG。仍在项目 `.awb/anim/frames/` 下，不进分镜，也不进模型代码块解析。
 * 文件名由场次 id、整片/单场、时间标签拼成，避免把任意路径写进旁路目录。
 */
export function isFramePath(name: string): boolean {
  return /^frames\/[A-Za-z_][A-Za-z0-9_-]{0,63}-(?:sequence|isolated)-(?:start|mid|end|t\d{1,6})\.png$/.test(
    name,
  );
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

function closedFences(normalized: string): { files: Map<string, string>; end: number } {
  const files = new Map<string, string>();
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  let end = 0;
  for (let match = fence.exec(normalized); match; match = fence.exec(normalized)) {
    end = fence.lastIndex;
    const file = takeNamed(match[1] ?? '', match[2] ?? '');
    if (file && isAnimPath(file.name)) files.set(file.name, file.content);
  }
  return { files, end };
}

/** 从一轮模型输出里抽出文件。后面的同名块覆盖前面的。没有代码块时，整段 JSON 当作 rubric。 */
export function parseAgentFiles(text: string): AgentFile[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const { files } = closedFences(normalized);
  if (files.size) return [...files].map(([name, content]) => ({ name, content }));

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

/**
 * 最后一个没有闭合的代码块。能认出路径就带上名字，认不出则 name 为 null。
 * 闭合的文件仍由 parseAgentFiles 负责，这里不把半截内容当成完整文件。
 */
export function unclosedFence(text: string): { name: string | null; content: string } | null {
  const normalized = text.replace(/\r\n/g, '\n');
  const { end } = closedFences(normalized);
  const tail = /```([^\n`]*)\n([\s\S]*)$/.exec(normalized.slice(end));
  const body = tail?.[2] ?? '';
  if (!tail || !body.trim()) return null;
  const file = takeNamed(tail[1] ?? '', body);
  if (file && isAnimPath(file.name)) return { name: file.name, content: file.content };
  return { name: null, content: body.replace(/\n$/, '') };
}
