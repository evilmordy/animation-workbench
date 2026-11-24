import { resolveColor, resolvePalette, type Palette } from '../../shared/palette';
import { ANIMS, ELEMENTS, type AnimType, type ElementType } from '../../shared/registry';
import type { Anim, Element, Scene, Storyboard } from '../../shared/schema';
import { fadeOf } from '../../shared/timing';
import { isSafeExpr } from '../../shared/validate';

/** 设计书 §4.7 的五个速率名。缓动函数在 dsl-lib 里。 */
export type RateName = 'smooth' | 'linear' | 'easeInOut' | 'rushInto' | 'thereAndBack';

export interface DslPlace {
  at?: [number, number];
  nextTo?: { id: string; dir: string; buff?: number };
  toEdge?: string;
}

/** 转译产物交给 dsl-lib 的一笔元素。颜色已经解析成 #RRGGBB。 */
export interface DslNodeSpec {
  id: string;
  type: string;
  props: Record<string, unknown>;
  color: string;
  fill?: string;
  fillOpacity?: number;
  strokeWidth: number;
  scale: number;
  rotate: number;
  z?: number;
  place?: DslPlace;
  offset?: [number, number];
  show: 'carry' | 'enter';
}

export interface DslAnimSpec {
  type: string;
  target: string;
  to?: string;
  at: number;
  duration: number;
  ease: RateName;
  params?: Record<string, unknown>;
}

export interface TranslateIssue {
  elementId?: string;
  message: string;
}

export interface TranslatedScene {
  /** 注入代码场的函数体。时间线只覆盖淡出和步骤，hold 仍由播放器补。 */
  code: string;
  errors: TranslateIssue[];
  contentMs: number;
}

interface Mods {
  dx: number;
  dy: number;
  rotate: number;
  scale: number;
  center?: [number, number];
  color?: string;
}

interface Live {
  element: Element;
  mods: Mods;
}

const emptyMods = (): Mods => ({ dx: 0, dy: 0, rotate: 0, scale: 1 });

const msOf = (sec: number) => Math.round(sec * 1000);

function nodeSpec(live: Live, show: 'carry' | 'enter', palette: Palette): DslNodeSpec {
  const el = live.element;
  const props = ELEMENTS[el.type as ElementType].props.parse(el.props) as Record<string, unknown>;
  const style = el.style;
  const text = el.type === 'Text' || el.type === 'MathTex';
  const spec: DslNodeSpec = {
    id: el.id,
    type: el.type,
    props,
    color: live.mods.color ?? resolveColor(style?.color ?? '$text', palette),
    strokeWidth: style?.strokeWidth ?? (text ? 0 : 4),
    scale: (style?.scale ?? 1) * live.mods.scale,
    rotate: (style?.rotate ?? 0) + live.mods.rotate,
    show,
  };
  if (style?.fill) spec.fill = resolveColor(style.fill, palette);
  if (style?.fillOpacity !== undefined) spec.fillOpacity = style.fillOpacity;
  if (style?.z !== undefined) spec.z = style.z;
  if (live.mods.center) {
    spec.place = { at: [live.mods.center[0], live.mods.center[1]] };
  } else if (el.place) {
    const place: DslPlace = {};
    if (el.place.at) place.at = [el.place.at[0], el.place.at[1]];
    if (el.place.nextTo) {
      place.nextTo = { id: el.place.nextTo.id, dir: el.place.nextTo.dir };
      if (el.place.nextTo.buff !== undefined) place.nextTo.buff = el.place.nextTo.buff;
    }
    if (el.place.toEdge) place.toEdge = el.place.toEdge;
    spec.place = place;
  }
  if (!live.mods.center && (live.mods.dx !== 0 || live.mods.dy !== 0)) {
    spec.offset = [live.mods.dx, live.mods.dy];
  }
  return spec;
}

function missing(id: string, by: string): TranslateIssue {
  return { elementId: by, message: `引用的元素 "${id}" 不存在` };
}

function depIds(el: Element): string[] {
  const ids: string[] = [];
  if (el.place?.nextTo) ids.push(el.place.nextTo.id);
  if (el.type === 'Brace' && typeof el.props.target === 'string') ids.push(el.props.target);
  if (el.type === 'FunctionGraph' && typeof el.props.axes === 'string') ids.push(el.props.axes);
  if (el.type === 'Group' && Array.isArray(el.props.children)) {
    for (const id of el.props.children) if (typeof id === 'string') ids.push(id);
  }
  return ids;
}

/** 组、括号、函数图要等被引用的元素先落地。 */
function orderLives(lives: Live[]): Live[] {
  const left = [...lives];
  const done = new Set<string>();
  const out: Live[] = [];
  while (left.length) {
    const index = left.findIndex((live) =>
      depIds(live.element).every((id) => done.has(id) || !left.some((item) => item.element.id === id)),
    );
    const next = left.splice(index === -1 ? 0 : index, 1)[0];
    if (!next) break;
    out.push(next);
    done.add(next.element.id);
  }
  return out;
}

function refsOk(
  el: Element,
  props: Record<string, unknown>,
  built: Set<string>,
  errors: TranslateIssue[],
): boolean {
  const fail = (id: string) => {
    errors.push(missing(id, el.id));
    return false;
  };
  if (el.place?.nextTo && !built.has(el.place.nextTo.id)) return fail(el.place.nextTo.id);
  if (el.type === 'Brace' && !built.has(String(props.target ?? ''))) return fail(String(props.target ?? ''));
  if (el.type === 'Group') {
    const children = Array.isArray(props.children) ? props.children : [];
    for (const id of children) if (typeof id === 'string' && !built.has(id)) return fail(id);
  }
  if (el.type === 'FunctionGraph') {
    if (!isSafeExpr(String(props.expr ?? ''))) {
      errors.push({ elementId: el.id, message: '函数表达式包含不允许的内容' });
      return false;
    }
    if (typeof props.axes === 'string' && !built.has(props.axes)) return fail(props.axes);
  }
  return true;
}

function applyOther(live: Live, anim: Anim, palette: Palette) {
  const params = anim.params ?? {};
  if (anim.type === 'Shift' && Array.isArray(params.by)) {
    const dx = Number(params.by[0] ?? 0);
    const dy = Number(params.by[1] ?? 0);
    if (live.mods.center) live.mods.center = [live.mods.center[0] + dx, live.mods.center[1] + dy];
    else {
      live.mods.dx += dx;
      live.mods.dy += dy;
    }
  } else if (anim.type === 'MoveTo' && Array.isArray(params.at)) {
    live.mods.center = [Number(params.at[0] ?? 0), Number(params.at[1] ?? 0)];
    live.mods.dx = 0;
    live.mods.dy = 0;
  } else if (anim.type === 'Rotate') {
    live.mods.rotate += Number(params.degrees ?? 0);
  } else if (anim.type === 'ScaleInPlace') {
    live.mods.scale *= Number(params.factor ?? 1);
  } else if (anim.type === 'SetColor' && typeof params.color === 'string') {
    live.mods.color = resolveColor(params.color, palette);
  }
}

function translateScene(
  scene: Scene,
  index: number,
  palette: Palette,
  present: Map<string, Live>,
): TranslatedScene {
  const errors: TranslateIssue[] = [];
  const lines: string[] = [];
  const fadeMs = msOf(fadeOf(scene, index));
  const stepsMs = scene.steps.reduce((sum, step) => sum + msOf(step.duration), 0);
  const contentMs = fadeMs + stepsMs;
  lines.push(`ctx.dsl.pad(${contentMs});`);

  const fading = scene.enter === 'fresh' && index > 0;
  const definedIds = new Set(scene.elements.map((el) => el.id));
  const carried = [...present.values()].filter((live) => !definedIds.has(live.element.id));
  if (fading) present.clear();
  else for (const id of definedIds) present.delete(id);

  const built = new Set<string>();
  for (const live of orderLives(carried)) {
    lines.push(`ctx.dsl.node(${JSON.stringify(nodeSpec(live, 'carry', palette))});`);
    built.add(live.element.id);
  }
  if (fading) lines.push(`ctx.dsl.fadeCarried(${fadeMs});`);

  const defined = new Map(scene.elements.map((el) => [el.id, el]));
  const failed = new Set<string>();
  for (const el of scene.elements) {
    let props: Record<string, unknown>;
    try {
      props = ELEMENTS[el.type as ElementType].props.parse(el.props) as Record<string, unknown>;
    } catch (e) {
      errors.push({ elementId: el.id, message: e instanceof Error ? e.message : String(e) });
      failed.add(el.id);
      continue;
    }
    if (!refsOk(el, props, built, errors)) {
      failed.add(el.id);
      continue;
    }
    const live: Live = { element: el, mods: emptyMods() };
    lines.push(`ctx.dsl.node(${JSON.stringify(nodeSpec(live, 'enter', palette))});`);
    built.add(el.id);
  }

  let cursor = fadeMs;
  for (const step of scene.steps) {
    const stepMs = msOf(step.duration);
    if (step.kind === 'wait') {
      cursor += stepMs;
      continue;
    }
    const anims = step.anims;
    const n = anims.length;
    const lag = n > 1 ? (step.lag ?? 0) : 0;
    const each = stepMs / (1 + lag * (n - 1));
    const ease = (step.rate ?? 'smooth') as RateName;
    anims.forEach((anim, i) => {
      const at = cursor + Math.round(i * lag * each);
      const duration = Math.max(1, i === n - 1 ? cursor + stepMs - at : Math.round(each));
      if (!built.has(anim.target)) {
        if (!failed.has(anim.target)) errors.push(missing(anim.target, anim.target));
        return;
      }
      const lifecycle = ANIMS[anim.type as AnimType].lifecycle;
      if (lifecycle === 'transform' && (!anim.to || !built.has(anim.to))) {
        errors.push(missing(anim.to ?? '', anim.target));
        return;
      }
      const spec: DslAnimSpec = { type: anim.type, target: anim.target, at, duration, ease };
      if (anim.to) spec.to = anim.to;
      if (anim.params && Object.keys(anim.params).length) {
        const params = { ...anim.params };
        if (anim.type === 'SetColor' && typeof params.color === 'string') {
          params.color = resolveColor(params.color, palette);
        }
        spec.params = params;
      }
      lines.push(`ctx.dsl.anim(${JSON.stringify(spec)});`);
      if (lifecycle === 'exit' || lifecycle === 'transform') present.delete(anim.target);
      if (lifecycle === 'enter') {
        const el = defined.get(anim.target);
        if (el && !present.has(anim.target)) present.set(anim.target, { element: el, mods: emptyMods() });
        if (el?.type === 'Group' && Array.isArray(el.props.children)) {
          for (const id of el.props.children) {
            if (typeof id !== 'string' || present.has(id)) continue;
            const child = defined.get(id);
            if (child) present.set(id, { element: child, mods: emptyMods() });
          }
        }
      }
      if (lifecycle === 'transform' && anim.to) {
        const el = defined.get(anim.to);
        if (el) present.set(anim.to, { element: el, mods: emptyMods() });
      }
      if (lifecycle === 'other') {
        const live = present.get(anim.target);
        if (live) applyOther(live, anim, palette);
      }
    });
    cursor += stepMs;
  }

  return { code: lines.join('\n'), errors, contentMs };
}

/**
 * 整部片子一起转。keep 要知道上一场还在场的元素，所以不是逐场纯函数。
 * 代码场会把继承清掉：代码图层里没有 DSL 元素。
 */
export function translateStoryboard(sb: Storyboard): TranslatedScene[] {
  const palette = resolvePalette(sb.meta);
  const present = new Map<string, Live>();
  return sb.scenes.map((scene, index) => {
    if (scene.kind !== 'dsl') {
      present.clear();
      return { code: '', errors: [], contentMs: 0 };
    }
    return translateScene(scene, index, palette, present);
  });
}
