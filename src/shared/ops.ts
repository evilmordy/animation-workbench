import { z } from 'zod';
import { newId } from './id';
import { ELEMENTS } from './registry';
import { Scene, type Element, type Storyboard } from './schema';

const allIds = (sb: Storyboard) => {
  const ids = new Set<string>();
  for (const s of sb.scenes) {
    ids.add(s.id);
    s.elements.forEach((e) => ids.add(e.id));
    s.steps.forEach((st) => ids.add(st.id));
  }
  return ids;
};

const withScenes = (sb: Storyboard, scenes: Scene[]): Storyboard => ({ ...sb, scenes });

export function emptyScene(sb: Storyboard, title = '新场景'): Scene {
  return {
    id: newId('s', allIds(sb)),
    title,
    description: '',
    kind: 'dsl',
    enter: 'fresh',
    hold: 1,
    elements: [],
    steps: [],
  };
}

export function insertScene(sb: Storyboard, at: number, scene: Scene = emptyScene(sb)): Storyboard {
  const scenes = [...sb.scenes];
  scenes.splice(Math.max(0, Math.min(at, scenes.length)), 0, scene);
  return withScenes(sb, scenes);
}

export function deleteScene(sb: Storyboard, id: string): Storyboard {
  return withScenes(
    sb,
    sb.scenes.filter((s) => s.id !== id),
  );
}

export function moveScene(sb: Storyboard, from: number, to: number): Storyboard {
  const scenes = [...sb.scenes];
  const [s] = scenes.splice(from, 1);
  if (!s) return sb;
  scenes.splice(Math.max(0, Math.min(to, scenes.length)), 0, s);
  return withScenes(sb, scenes);
}

export function updateScene(sb: Storyboard, id: string, fn: (s: Scene) => Scene): Storyboard {
  return withScenes(
    sb,
    sb.scenes.map((s) => (s.id === id ? fn(s) : s)),
  );
}

/** 把元素引用按 map 改名（只改场景内部定义的元素） */
function renameRefs(e: Element, map: Map<string, string>): Element {
  const r = (id: string) => map.get(id) ?? id;
  const props = { ...e.props };
  for (const key of ELEMENTS[e.type].refs ?? []) {
    const v = props[key];
    if (typeof v === 'string') props[key] = r(v);
    if (Array.isArray(v)) props[key] = v.map((x) => (typeof x === 'string' ? r(x) : x));
  }
  const place = e.place?.nextTo
    ? { ...e.place, nextTo: { ...e.place.nextTo, id: r(e.place.nextTo.id) } }
    : e.place;
  return { ...e, id: r(e.id), props, ...(place ? { place } : {}) };
}

/** 复制场景插到原场景之后；场景、元素、步骤都换新 id，避免和继承来的元素冲突 */
export function duplicateScene(sb: Storyboard, id: string): Storyboard {
  const i = sb.scenes.findIndex((s) => s.id === id);
  const src = sb.scenes[i];
  if (!src) return sb;
  const taken = allIds(sb);
  const fresh = (prefix: string) => {
    const n = newId(prefix, taken);
    taken.add(n);
    return n;
  };
  const map = new Map(src.elements.map((e) => [e.id, fresh(e.id.slice(0, 20))]));
  const r = (x: string) => map.get(x) ?? x;
  const copy: Scene = {
    ...structuredClone(src),
    id: fresh('s'),
    title: `${src.title}（副本）`,
    locked: undefined,
    elements: src.elements.map((e) => renameRefs(structuredClone(e), map)),
    steps: src.steps.map((st) =>
      st.kind === 'wait'
        ? { ...st, id: fresh('st') }
        : {
            ...structuredClone(st),
            id: fresh('st'),
            anims: st.anims.map((a) => ({ ...a, target: r(a.target), ...(a.to ? { to: r(a.to) } : {}) })),
          },
    ),
  };
  if (copy.locked === undefined) delete copy.locked;
  return insertScene(sb, i + 1, copy);
}

// ---------- AI 修改操作（PLAN T3.6） ----------

export const EditOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('replaceScene'), id: z.string(), scene: Scene }),
  z.object({ op: z.literal('insertScene'), after: z.string().nullable(), scene: Scene }),
  z.object({ op: z.literal('deleteScene'), id: z.string() }),
  z.object({ op: z.literal('moveScene'), id: z.string(), after: z.string().nullable() }),
]);
export const EditOps = z.object({ ops: z.array(EditOp).min(1) });
export type EditOp = z.infer<typeof EditOp>;

export interface ApplyResult {
  storyboard: Storyboard;
  /** 被改动/新增的场景 id（用于高亮） */
  changed: string[];
  /** 因场景锁定或 id 不存在而跳过的操作说明 */
  skipped: string[];
}

/** 按顺序应用 AI 返回的操作；锁定的场景不会被修改、删除或移动 */
export function applyOps(sb: Storyboard, ops: EditOp[]): ApplyResult {
  let cur = sb;
  const changed = new Set<string>();
  const skipped: string[] = [];
  const idx = (id: string) => cur.scenes.findIndex((s) => s.id === id);
  const locked = (id: string) => cur.scenes[idx(id)]?.locked === true;
  const after = (id: string | null) => (id === null ? 0 : idx(id) + 1);

  for (const op of ops) {
    if (op.op !== 'insertScene' && idx(op.id) < 0) {
      skipped.push(`${op.op}：场景 ${op.id} 不存在`);
      continue;
    }
    if (op.op !== 'insertScene' && locked(op.id)) {
      skipped.push(`${op.op}：场景 ${op.id} 已锁定`);
      continue;
    }
    switch (op.op) {
      case 'replaceScene':
        cur = updateScene(cur, op.id, (s) => ({ ...op.scene, id: s.id }));
        changed.add(op.id);
        break;
      case 'insertScene': {
        if (op.after !== null && idx(op.after) < 0) {
          skipped.push(`insertScene：锚点场景 ${op.after} 不存在`);
          continue;
        }
        const scene = idx(op.scene.id) >= 0 ? { ...op.scene, id: newId('s', allIds(cur)) } : op.scene;
        cur = insertScene(cur, after(op.after), scene);
        changed.add(scene.id);
        break;
      }
      case 'deleteScene':
        cur = deleteScene(cur, op.id);
        changed.delete(op.id);
        break;
      case 'moveScene': {
        const from = idx(op.id);
        const s = cur.scenes[from]!;
        const rest = deleteScene(cur, op.id);
        const anchor = op.after === null ? 0 : rest.scenes.findIndex((x) => x.id === op.after) + 1;
        cur = insertScene(rest, anchor, s);
        changed.add(op.id);
        break;
      }
    }
  }
  return { storyboard: cur, changed: [...changed], skipped };
}
