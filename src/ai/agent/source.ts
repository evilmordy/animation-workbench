/** 素材按空行切段，写进 `.awb/anim/source.md`。上下文只放目录，不把全文贴进提示。 */

export const CATALOG_PREVIEW = 40;

export interface SourceParagraph {
  /** 从 1 开始，和 source.md 的 `[n]` 相同。 */
  n: number;
  text: string;
}

/** 空行分段。连续空行只算一次分隔，段内换行保留。 */
export function splitSource(raw: string): SourceParagraph[] {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  return text
    .split(/\n[ \t]*\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((paragraph, index) => ({ n: index + 1, text: paragraph }));
}

export function renderSourceMd(paragraphs: SourceParagraph[]): string {
  if (!paragraphs.length) return '# 素材\n\n（没有导入素材）\n';
  const body = paragraphs.map((paragraph) => `## [${paragraph.n}]\n\n${paragraph.text}`).join('\n\n');
  return `# 素材\n\n${body}\n`;
}

export function previewParagraph(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  if (chars.length <= CATALOG_PREVIEW) return flat;
  return `${chars.slice(0, CATALOG_PREVIEW).join('')}…`;
}

/** 给模型看的目录。每段只留前 40 字，全文在 source.md。 */
export function sourceCatalog(paragraphs: SourceParagraph[]): string {
  if (!paragraphs.length) return '素材目录：没有导入素材。';
  const lines = paragraphs.map((paragraph) => `[${paragraph.n}] ${previewParagraph(paragraph.text)}`);
  return ['素材目录（全文在 .awb/anim/source.md，按空行分段编号）：', ...lines].join('\n');
}
