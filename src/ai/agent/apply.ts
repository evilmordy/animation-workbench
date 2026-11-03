import { parseStoryboard, type Scene, type Storyboard } from '../../shared/schema';

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

/** 从 rubric.json 读出场景表。读不出场景时返回 null。 */
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

/** 把 shared.js 接到函数体前面，让每一场用到同一份常量。场景里已经包含原文时不重复粘贴。 */
export function withShared(shared: string, body: string): string {
  const source = shared.trim();
  const code = body.trim();
  if (!source) return code;
  if (code.includes(source)) return code;
  return `${source}\n${code}`;
}

export interface ApplyInput {
  storyboard: Storyboard;
  planned: PlannedScene[];
  /** 这一轮以及之前模型写下的函数体，不含 shared 前缀。 */
  codes: ReadonlyMap<string, string>;
  shared: string;
  /** 开跑时分镜是空的，且 rubric 有标题时，用来填 meta.title。 */
  adoptTitle: string | null;
}

export interface ApplyOutput {
  storyboard: Storyboard;
  written: string[];
  skippedLocked: string[];
  changed: boolean;
}

function codeScene(
  existing: Scene | undefined,
  plan: PlannedScene | undefined,
  id: string,
  code: string,
): Scene {
  const next: Scene = {
    id,
    title: plan?.title ?? existing?.title ?? id,
    description: plan?.description ?? existing?.description ?? '',
    kind: 'code',
    enter: plan?.enter ?? existing?.enter ?? 'fresh',
    hold: plan?.hold ?? existing?.hold ?? 1,
    elements: [],
    steps: [],
    code,
  };
  if (existing?.notes) next.notes = existing.notes;
  return next;
}

/**
 * 把场景代码写回 scenes[]。locked 的场景原样留下。
 * 不删除计划里没提到的场景。
 */
export function applyAgentScenes(input: ApplyInput): ApplyOutput {
  const scenes = input.storyboard.scenes.map((s) => ({ ...s }));
  const indexById = new Map(scenes.map((s, i) => [s.id, i]));
  const written: string[] = [];
  const skippedLocked: string[] = [];
  const ids = input.planned.map((p) => p.id);
  for (const id of input.codes.keys()) if (!ids.includes(id)) ids.push(id);

  for (const id of ids) {
    const body = input.codes.get(id)?.trim();
    if (!body) continue;
    const existing = input.storyboard.scenes.find((s) => s.id === id);
    if (existing?.locked) {
      skippedLocked.push(id);
      continue;
    }
    const plan = input.planned.find((p) => p.id === id);
    const next = codeScene(existing, plan, id, withShared(input.shared, body));
    const at = indexById.get(id);
    if (at === undefined) {
      indexById.set(id, scenes.length);
      scenes.push(next);
    } else {
      scenes[at] = next;
    }
    written.push(id);
  }

  let meta = input.storyboard.meta;
  if (written.length && input.adoptTitle) meta = { ...meta, title: input.adoptTitle };
  const storyboard: Storyboard = { ...input.storyboard, meta, scenes };
  const changed = JSON.stringify(storyboard) !== JSON.stringify(input.storyboard);
  return { storyboard, written, skippedLocked, changed };
}

/** 写回前再过一遍 schema。失败时不调用 project.update。 */
export function acceptStoryboard(data: Storyboard): Storyboard | null {
  const parsed = parseStoryboard(data);
  return parsed.ok ? parsed.value : null;
}
