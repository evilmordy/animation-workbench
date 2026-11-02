/* eslint-disable @typescript-eslint/no-explicit-any -- props/params 已由注册表 schema 校验，这里按类型取值 */
import {
  Arrow,
  Axes,
  Brace,
  Circle,
  Circumscribe,
  Create,
  Dot,
  DrawBorderThenFill,
  FadeIn,
  FadeOut,
  FadeToColor,
  Flash,
  FunctionGraph,
  GrowFromCenter,
  Indicate,
  Line,
  MathTex,
  MoveToTargetPosition,
  NumberPlane,
  Polygon,
  Rectangle,
  ReplacementTransform,
  Rotate,
  ScaleInPlace,
  Shift,
  Square,
  Text,
  TransformMatchingTex,
  Uncreate,
  VGroup,
  Wiggle,
  Write,
  easeInOut,
  linear,
  rushInto,
  smooth,
  thereAndBack,
  type Animation,
  type Mobject,
  type MobjectWithTargetPosition,
} from 'manim-web';
import { resolveColor, type Palette } from '../shared/palette';
import { ELEMENTS, type AnimType, type ElementType } from '../shared/registry';
import type { Anim, Element, Step } from '../shared/schema';
import { isSafeExpr } from '../shared/validate';

type V3 = [number, number, number];
const v3 = (p: readonly number[]): V3 => [p[0] ?? 0, p[1] ?? 0, 0];
const DEG = Math.PI / 180;

export const DIRS: Record<string, V3> = {
  UP: [0, 1, 0],
  DOWN: [0, -1, 0],
  LEFT: [-1, 0, 0],
  RIGHT: [1, 0, 0],
  UL: [-1, 1, 0],
  UR: [1, 1, 0],
  DL: [-1, -1, 0],
  DR: [1, -1, 0],
};

export const RATES = { smooth, linear, easeInOut, rushInto, thereAndBack } as const;

export class BuildError extends Error {
  constructor(
    message: string,
    readonly elementId?: string,
  ) {
    super(message);
  }
}

export interface BuildCtx {
  palette: Palette;
  /** 当前可引用的元素（继承来的 + 已构建的） */
  mobs: Map<string, Mobject>;
}

const need = (ctx: BuildCtx, id: string, by: string) => {
  const m = ctx.mobs.get(id);
  if (!m) throw new BuildError(`引用的元素 "${id}" 不存在`, by);
  return m;
};

/** 构建一个元素（含样式和定位）。MathTex 会等渲染完成，保证尺寸可用于 nextTo / Brace */
export async function buildElement(e: Element, ctx: BuildCtx): Promise<Mobject> {
  const p = ELEMENTS[e.type as ElementType].props.parse(e.props) as Record<string, any>;
  const color = resolveColor(e.style?.color ?? '$text', ctx.palette);
  let m: Mobject;
  switch (e.type as ElementType) {
    case 'Circle':
      m = new Circle({ radius: p.radius, color });
      break;
    case 'Square':
      m = new Square({ sideLength: p.sideLength, color });
      break;
    case 'Rectangle':
      m = new Rectangle({ width: p.width, height: p.height, color });
      break;
    case 'Polygon':
      m = new Polygon({ vertices: p.points.map(v3), color });
      break;
    case 'Line':
      m = new Line({ start: v3(p.start), end: v3(p.end), color });
      break;
    case 'Arrow':
      m = new Arrow({ start: v3(p.start), end: v3(p.end), color });
      break;
    case 'Dot':
      m = new Dot({ radius: p.radius, color });
      break;
    case 'Text':
      m = new Text({ text: p.text, fontSize: p.fontSize, color, fontFamily: 'sans-serif' });
      break;
    case 'MathTex': {
      // manim-web 文档称 fontSize 是倍数，实测与 Text 一样是点数（默认 48）
      const tex = new MathTex({ latex: p.latex, fontSize: p.fontSize });
      await tex.waitForRender();
      tex.setColor(color);
      m = tex;
      break;
    }
    case 'Axes':
      m = new Axes({ xRange: p.xRange, yRange: p.yRange, xLength: p.xLength, yLength: p.yLength, color });
      break;
    case 'NumberPlane':
      m = new NumberPlane({ xRange: p.xRange, yRange: p.yRange });
      break;
    case 'FunctionGraph': {
      if (!isSafeExpr(p.expr)) throw new BuildError('函数表达式包含不允许的内容', e.id);
      const func = new Function('x', `return (${p.expr});`) as (x: number) => number;
      const axes = p.axes ? (need(ctx, p.axes, e.id) as Axes) : undefined;
      m = new FunctionGraph({ func, xRange: p.xRange, color, axes });
      break;
    }
    case 'Brace':
      m = new Brace(need(ctx, p.target, e.id), { direction: DIRS[p.dir], color });
      break;
    case 'Group':
      m = new VGroup(...(p.children as string[]).map((id) => need(ctx, id, e.id)));
      break;
  }
  applyStyle(m, e, ctx.palette);
  place(m, e, ctx);
  return m;
}

function applyStyle(m: Mobject, e: Element, palette: Palette) {
  const s = e.style;
  if (!s) return;
  if (s.fill || s.fillOpacity !== undefined)
    m.setFill(s.fill ? resolveColor(s.fill, palette) : undefined, s.fillOpacity ?? 1);
  if (s.strokeWidth !== undefined) m.setStrokeWidth(s.strokeWidth);
  if (s.scale !== undefined) m.scale(s.scale);
  if (s.rotate) m.rotate(s.rotate * DEG);
}

function place(m: Mobject, e: Element, ctx: BuildCtx) {
  const pl = e.place;
  if (!pl) return;
  if (pl.at) m.moveTo(v3(pl.at));
  if (pl.nextTo) m.nextTo(need(ctx, pl.nextTo.id, e.id), DIRS[pl.nextTo.dir], pl.nextTo.buff);
  if (pl.toEdge) m.toEdge(DIRS[pl.toEdge]!);
}

/** 构建一个动画；duration 是单个动画的时长（lag 情况下由调用方换算） */
export type Rate = Extract<Step, { kind: 'play' }>['rate'];

export function buildAnim(a: Anim, ctx: BuildCtx, duration: number, rate: Rate): Animation {
  const target = need(ctx, a.target, a.target);
  const o = { duration, rateFunc: RATES[rate ?? 'smooth'] };
  const prm = (a.params ?? {}) as Record<string, any>;
  switch (a.type as AnimType) {
    case 'Create':
      return new Create(target, o);
    case 'Write':
      return new Write(target, o);
    case 'FadeIn':
      return new FadeIn(target, o);
    case 'FadeOut':
      return new FadeOut(target, o);
    case 'DrawBorderThenFill':
      return new DrawBorderThenFill(target, o);
    case 'Uncreate':
      return new Uncreate(target, o);
    case 'GrowFromCenter':
      return new GrowFromCenter(target, o);
    case 'Transform':
      return new ReplacementTransform(target, need(ctx, a.to!, a.target), o);
    case 'TransformMatchingTex':
      return new TransformMatchingTex(target as MathTex, need(ctx, a.to!, a.target) as MathTex, o);
    case 'Shift':
      return new Shift(target, { ...o, direction: v3(prm.by) });
    case 'MoveTo':
      (target as MobjectWithTargetPosition).targetPosition = v3(prm.at);
      return new MoveToTargetPosition(target as MobjectWithTargetPosition, o);
    case 'Rotate':
      return new Rotate(target, { ...o, angle: prm.degrees * DEG });
    case 'ScaleInPlace':
      return new ScaleInPlace(target, { ...o, scaleFactor: prm.factor });
    case 'SetColor':
      return new FadeToColor(target, { ...o, color: resolveColor(prm.color, ctx.palette) });
    case 'Indicate':
      return new Indicate(target, o);
    case 'Circumscribe':
      return new Circumscribe(target, o);
    case 'Flash':
      return new Flash(target, o);
    case 'Wiggle':
      return new Wiggle(target, o);
  }
}
