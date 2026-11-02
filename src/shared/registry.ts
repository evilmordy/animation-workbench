import { z } from 'zod';

// ---------- 基础类型（PLAN §3.1） ----------

export const Id = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/, 'id 只能包含字母、数字、_ 和 -，且以字母或 _ 开头');
export const Vec2 = z.tuple([z.number(), z.number()]);
export const PALETTE_TOKENS = ['primary', 'secondary', 'accent', 'text', 'muted'] as const;
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色必须是 #RRGGBB');
export const Color = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{6}|\$(primary|secondary|accent|text|muted))$/,
    '颜色必须是 #RRGGBB 或 $primary 等调色板令牌',
  );
export const DIRS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'UL', 'UR', 'DL', 'DR'] as const;
export const Dir = z.enum(DIRS);
const Positive = z.number().positive();
const Range2 = z.tuple([z.number(), z.number()]);
const Range3 = z.tuple([z.number(), z.number(), Positive]);

// ---------- 元素 ----------

interface ElementSpec {
  label: string;
  desc: string;
  props: z.ZodObject;
  /** props 里引用其他元素 id 的字段（V3 检查） */
  refs?: readonly string[];
}

const el = <S extends z.ZodObject>(label: string, desc: string, props: S, refs?: readonly string[]) =>
  ({ label, desc, props, refs }) satisfies ElementSpec;

export const ELEMENTS = {
  Circle: el('圆', '以 place.at 为圆心的圆', z.strictObject({ radius: Positive.default(1) })),
  Square: el('正方形', '边长为 sideLength 的正方形', z.strictObject({ sideLength: Positive.default(2) })),
  Rectangle: el(
    '矩形',
    '宽 width、高 height 的矩形',
    z.strictObject({ width: Positive.default(4), height: Positive.default(2) }),
  ),
  Polygon: el('多边形', '按顶点坐标依次连接的闭合多边形', z.strictObject({ points: z.array(Vec2).min(3) })),
  Line: el('线段', '从 start 到 end 的线段', z.strictObject({ start: Vec2, end: Vec2 })),
  Arrow: el('箭头', '从 start 指向 end 的箭头', z.strictObject({ start: Vec2, end: Vec2 })),
  Dot: el('点', '位于 place.at 的实心点', z.strictObject({ radius: Positive.default(0.08) })),
  Text: el(
    '文字',
    '普通文字，中文必须用它',
    z.strictObject({ text: z.string().min(1), fontSize: Positive.default(48) }),
  ),
  MathTex: el(
    '公式',
    'LaTeX 数学公式（不要放中文）',
    z.strictObject({ latex: z.string().min(1), fontSize: Positive.default(48) }),
  ),
  Axes: el(
    '坐标轴',
    'xRange/yRange 为 [最小, 最大, 刻度间隔]',
    z.strictObject({
      xRange: Range3.default([-5, 5, 1]),
      yRange: Range3.default([-3, 3, 1]),
      xLength: Positive.optional(),
      yLength: Positive.optional(),
    }),
  ),
  FunctionGraph: el(
    '函数图像',
    'expr 是关于 x 的 JS 表达式，如 Math.sin(x)；可选 axes 指定所在坐标轴',
    z.strictObject({ expr: z.string().min(1), xRange: Range2.optional(), axes: Id.optional() }),
    ['axes'],
  ),
  NumberPlane: el(
    '坐标网格',
    '带网格的坐标平面',
    z.strictObject({ xRange: Range3.default([-7, 7, 1]), yRange: Range3.default([-4, 4, 1]) }),
  ),
  Brace: el(
    '大括号',
    '贴在 target 元素 dir 一侧的大括号',
    z.strictObject({ target: Id, dir: Dir.default('DOWN') }),
    ['target'],
  ),
  Group: el('组', '把 children 中的元素编为一组', z.strictObject({ children: z.array(Id).min(1) }), [
    'children',
  ]),
} as const satisfies Record<string, ElementSpec>;

export type ElementType = keyof typeof ELEMENTS;
export const ELEMENT_TYPES = Object.keys(ELEMENTS) as [ElementType, ...ElementType[]];

// ---------- 动画 ----------

/** enter：只能用于不在场的元素，播放后在场；exit：播放后离场；transform：target 离场、to 入场 */
export type AnimLifecycle = 'enter' | 'exit' | 'transform' | 'other';

interface AnimSpec {
  label: string;
  desc: string;
  lifecycle: AnimLifecycle;
  params: z.ZodObject;
}

const NoParams = z.strictObject({});
const anim = <S extends z.ZodObject>(
  label: string,
  desc: string,
  lifecycle: AnimLifecycle,
  params: S = NoParams as S,
) => ({ label, desc, lifecycle, params }) satisfies AnimSpec;

export const ANIMS = {
  Create: anim('绘制', '描线画出图形', 'enter'),
  Write: anim('书写', '逐笔写出文字或公式', 'enter'),
  FadeIn: anim('淡入', '淡入出现', 'enter'),
  FadeOut: anim('淡出', '淡出并离场', 'exit'),
  DrawBorderThenFill: anim('描边后填充', '先描边再填充颜色', 'enter'),
  Uncreate: anim('擦除', '倒放绘制过程并离场', 'exit'),
  GrowFromCenter: anim('从中心放大', '从中心放大出现', 'enter'),
  Transform: anim('变形', 'target 变形为 to（target 离场，to 入场）', 'transform'),
  TransformMatchingTex: anim('公式变形', '按相同的 TeX 片段把 target 变为 to', 'transform'),
  Shift: anim('平移', '按向量 by 平移', 'other', z.strictObject({ by: Vec2 })),
  MoveTo: anim('移动到', '移动到坐标 at', 'other', z.strictObject({ at: Vec2 })),
  Rotate: anim('旋转', '逆时针旋转 degrees 度', 'other', z.strictObject({ degrees: z.number() })),
  ScaleInPlace: anim('原地缩放', '以自身中心缩放 factor 倍', 'other', z.strictObject({ factor: Positive })),
  SetColor: anim('变色', '颜色渐变为 color', 'other', z.strictObject({ color: Color })),
  Indicate: anim('强调', '短暂放大并高亮', 'other'),
  Circumscribe: anim('圈出', '沿外框画一圈', 'other'),
  Flash: anim('闪光', '向外放射闪光', 'other'),
  Wiggle: anim('摆动', '左右摆动吸引注意', 'other'),
} as const satisfies Record<string, AnimSpec>;

export type AnimType = keyof typeof ANIMS;
export const ANIM_TYPES = Object.keys(ANIMS) as [AnimType, ...AnimType[]];
