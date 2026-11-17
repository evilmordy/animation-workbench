import { parseStoryboard, type Storyboard } from '../../shared/schema';

export interface PlannedScene {
  id: string;
  title: string;
  description: string;
  hold: number;
  enter: 'fresh' | 'keep';
}

const ID_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

export function clampHold(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(30, Math.max(0, n));
}

export function sanitizeId(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/^[^A-Za-z_]+/, '')
    .slice(0, 64);
  return ID_RE.test(cleaned) ? cleaned : '';
}

function looseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/** 从 rubric.json 读出场景表。读不出场景时返回 null。评测用它算没写完的场。 */
export function parseRubric(text: string): { title: string; scenes: PlannedScene[] } | null {
  const data = looseJson(text);
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.scenes)) return null;
  const scenes: PlannedScene[] = [];
  const seen = new Set<string>();
  for (const item of obj.scenes) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = sanitizeId(typeof rec.id === 'string' ? rec.id : '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const holdNum = typeof rec.hold === 'number' ? rec.hold : Number(rec.hold);
    scenes.push({
      id,
      title: typeof rec.title === 'string' && rec.title.trim() ? rec.title.trim() : id,
      description: typeof rec.description === 'string' ? rec.description : '',
      hold: clampHold(Number.isFinite(holdNum) ? holdNum : 1),
      enter: rec.enter === 'keep' ? 'keep' : 'fresh',
    });
  }
  if (!scenes.length) return null;
  return { title: typeof obj.title === 'string' ? obj.title.trim() : '', scenes };
}

/** 写回前再过一遍 schema。失败时不调用 project.update。 */
export function acceptStoryboard(data: Storyboard): Storyboard | null {
  const parsed = parseStoryboard(data);
  return parsed.ok ? parsed.value : null;
}
