import { ANIMS, ELEMENTS } from './registry';
import { formatPath, parseStoryboard, type Element, type Scene, type Storyboard } from './schema';
import { sceneDuration, totalDuration } from './timing';

export type Level = 'error' | 'warning';
export type Code = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8';
export interface Issue {
  level: Level;
  code: Code;
  path: string;
  message: string;
}

export const FRAME = { x: 7, y: 4 };
const LIMITS = { step: [0.1, 30], wait: [0, 30], hold: [0, 30], scene: 120, total: 600, text: 200, tex: 300 };
const EXPR_TOKEN =
  /\s+|Math\.(?:sin|cos|tan|exp|log|sqrt|abs|pow|PI|E)\b|x\b|\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+|[-+*/%(),]/giy;
const HAN = /\p{Script=Han}/u;

/** V8：FunctionGraph.expr 只允许白名单内的记号 */
export function isSafeExpr(expr: string): boolean {
  EXPR_TOKEN.lastIndex = 0;
  while (EXPR_TOKEN.lastIndex < expr.length) {
    if (!EXPR_TOKEN.exec(expr)) return false;
  }
  return true;
}

/** 完整校验：V1 不通过时只返回结构错误，因为语义规则依赖正确的结构 */
export function validate(data: unknown): Issue[] {
  const r = parseStoryboard(data);
  if (!r.ok) return r.issues.map((i) => ({ level: 'error', code: 'V1', ...i }));
  return validateSemantics(r.value);
}

/** scopes 若传入，会依次填入每个场景开始时继承的在场元素 id（检查器的下拉选项用） */
export function validateSemantics(sb: Storyboard, scopes?: string[][]): Issue[] {
  const issues: Issue[] = [];
  const add = (level: Level, code: Code, path: (string | number)[], message: string) =>
    issues.push({ level, code, path: formatPath(path), message });

  const sceneIds = new Set<string>();
  // 上一场景结束时在场的元素（keep 场景会继承）
  let present = new Map<string, Element>();

  sb.scenes.forEach((scene, si) => {
    const sp: (string | number)[] = ['scenes', si];
    if (sceneIds.has(scene.id)) add('error', 'V2', [...sp, 'id'], `场景 id "${scene.id}" 重复`);
    sceneIds.add(scene.id);

    checkDurations(scene, si, sp, add);
    scopes?.push(scene.enter === 'keep' && scene.kind === 'dsl' ? [...present.keys()] : []);
    if (scene.kind !== 'dsl') {
      present = new Map();
      return;
    }

    const inherited = scene.enter === 'keep' ? present : new Map<string, Element>();
    const scope = new Map(inherited);
    scene.elements.forEach((e, ei) => {
      if (scope.has(e.id)) {
        const where = inherited.has(e.id) ? '与继承自上一场景的在场元素' : '在本场景内';
        add('error', 'V2', [...sp, 'elements', ei, 'id'], `元素 id "${e.id}" ${where}重复`);
      }
      scope.set(e.id, e);
    });

    const ref = (id: string, path: (string | number)[]) => {
      if (!scope.has(id)) add('error', 'V3', path, `引用的元素 "${id}" 不存在于本场景或继承的元素中`);
    };
    scene.elements.forEach((e, ei) => {
      const ep = [...sp, 'elements', ei];
      if (e.place?.nextTo) ref(e.place.nextTo.id, [...ep, 'place', 'nextTo', 'id']);
      for (const key of ELEMENTS[e.type].refs ?? []) {
        const v = e.props[key];
        if (typeof v === 'string') ref(v, [...ep, 'props', key]);
        if (Array.isArray(v))
          v.forEach((id, i) => typeof id === 'string' && ref(id, [...ep, 'props', key, i]));
      }
      checkElement(e, ep, add);
    });

    // V4：同一步里的动画并行执行，检查都基于步骤开始时的状态
    const live = new Set(inherited.keys());
    const membersOf = (id: string) => {
      const e = scope.get(id);
      return e?.type === 'Group' ? [id, ...(e.props.children as string[])] : [id];
    };
    scene.steps.forEach((step, sti) => {
      if (step.kind !== 'play') return;
      const enter: string[] = [];
      const exit: string[] = [];
      step.anims.forEach((a, ai) => {
        const ap = [...sp, 'steps', sti, 'anims', ai];
        ref(a.target, [...ap, 'target']);
        if (a.to) ref(a.to, [...ap, 'to']);
        if (!scope.has(a.target) || (a.to && !scope.has(a.to))) return;

        const lc = ANIMS[a.type].lifecycle;
        if (lc === 'enter') {
          if (live.has(a.target))
            add('error', 'V4', [...ap, 'target'], `"${a.target}" 已在场，不能再用 ${a.type} 出场`);
          enter.push(...membersOf(a.target));
        } else {
          if (!live.has(a.target))
            add('error', 'V4', [...ap, 'target'], `"${a.target}" 不在场，不能使用 ${a.type}`);
          if (lc === 'exit' || lc === 'transform') exit.push(...membersOf(a.target));
          if (lc === 'transform' && a.to) {
            if (live.has(a.to)) add('error', 'V4', [...ap, 'to'], `变形目标 "${a.to}" 已在场`);
            enter.push(...membersOf(a.to));
          }
        }
        if (a.type === 'MoveTo') checkPoint(a.params?.at, [...ap, 'params', 'at'], add);
      });
      exit.forEach((id) => live.delete(id));
      enter.forEach((id) => live.add(id));
    });

    present = new Map([...live].flatMap((id) => (scope.has(id) ? [[id, scope.get(id)!] as const] : [])));
  });

  const total = totalDuration(sb);
  if (total > LIMITS.total) add('error', 'V5', ['scenes'], `总时长 ${total}s 超过 ${LIMITS.total}s`);
  return issues;
}

type Add = (level: Level, code: Code, path: (string | number)[], message: string) => void;

function checkDurations(scene: Scene, si: number, sp: (string | number)[], add: Add) {
  scene.steps.forEach((st, i) => {
    const [min, max] = st.kind === 'play' ? LIMITS.step : LIMITS.wait;
    if (st.duration < min! || st.duration > max!)
      add('error', 'V5', [...sp, 'steps', i, 'duration'], `步骤时长 ${st.duration}s 超出 ${min}–${max}s`);
  });
  const [hmin, hmax] = LIMITS.hold;
  if (scene.hold < hmin! || scene.hold > hmax!)
    add('error', 'V5', [...sp, 'hold'], `停留时长 ${scene.hold}s 超出 ${hmin}–${hmax}s`);
  const d = sceneDuration(scene, si);
  if (d > LIMITS.scene) add('error', 'V5', sp, `场景时长 ${d}s 超过 ${LIMITS.scene}s`);
}

function checkPoint(p: unknown, path: (string | number)[], add: Add) {
  if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return;
  if (Math.abs(p[0]) > FRAME.x || Math.abs(p[1]) > FRAME.y)
    add('warning', 'V6', path, `坐标 (${p[0]}, ${p[1]}) 超出画面范围 x∈[-7,7]、y∈[-4,4]`);
}

function checkElement(e: Element, ep: (string | number)[], add: Add) {
  checkPoint(e.place?.at, [...ep, 'place', 'at'], add);
  const p = e.props;
  if (e.type === 'Polygon')
    (p.points as unknown[]).forEach((pt, i) => checkPoint(pt, [...ep, 'props', 'points', i], add));
  if (e.type === 'Line' || e.type === 'Arrow') {
    checkPoint(p.start, [...ep, 'props', 'start'], add);
    checkPoint(p.end, [...ep, 'props', 'end'], add);
  }
  if (e.type === 'Text' && (p.text as string).length > LIMITS.text)
    add('error', 'V7', [...ep, 'props', 'text'], `文字超过 ${LIMITS.text} 字`);
  if (e.type === 'MathTex') {
    const latex = p.latex as string;
    if (latex.length > LIMITS.tex) add('error', 'V7', [...ep, 'props', 'latex'], `公式超过 ${LIMITS.tex} 字`);
    if (HAN.test(latex))
      add('warning', 'V7', [...ep, 'props', 'latex'], '公式里含中文，中文应放进 Text 元素');
  }
  if (e.type === 'FunctionGraph' && !isSafeExpr(p.expr as string))
    add('error', 'V8', [...ep, 'props', 'expr'], '表达式只能包含 x、数字、+-*/%() 和 Math.sin 等白名单函数');
}

/** 每个场景开始时从上一场景继承的在场元素 id */
export function inheritedIds(sb: Storyboard): string[][] {
  const scopes: string[][] = [];
  validateSemantics(sb, scopes);
  return scopes;
}
