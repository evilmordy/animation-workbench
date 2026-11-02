import { z } from 'zod';
import { zhCN } from 'zod/locales';
import {
  ANIMS,
  ANIM_TYPES,
  Color,
  Dir,
  ELEMENTS,
  ELEMENT_TYPES,
  HexColor,
  Id,
  PALETTE_TOKENS,
  Vec2,
} from './registry';

z.config(zhCN());

export const SCHEMA_VERSION = 1;

const Place = z.strictObject({
  at: Vec2.optional(),
  nextTo: z.strictObject({ id: Id, dir: Dir, buff: z.number().min(0).optional() }).optional(),
  toEdge: Dir.optional(),
});

const Style = z.strictObject({
  color: Color.optional(),
  fill: Color.optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
  strokeWidth: z.number().min(0).optional(),
  scale: z.number().positive().optional(),
  rotate: z.number().optional(),
  z: z.number().int().optional(),
});

/** 把子 schema 的错误挂到 base 路径下，保证报错路径指向原 JSON 位置 */
function checkWith(schema: z.ZodType, value: unknown, base: PropertyKey[], ctx: z.RefinementCtx) {
  const r = schema.safeParse(value);
  if (r.success) return;
  for (const issue of r.error.issues) {
    ctx.addIssue({ code: 'custom', message: issue.message, path: [...base, ...issue.path] });
  }
}

export const Element = z
  .strictObject({
    id: Id,
    type: z.enum(ELEMENT_TYPES),
    props: z.record(z.string(), z.unknown()),
    place: Place.optional(),
    style: Style.optional(),
  })
  .superRefine((e, ctx) => checkWith(ELEMENTS[e.type].props, e.props, ['props'], ctx));

export const Anim = z
  .strictObject({
    type: z.enum(ANIM_TYPES),
    target: Id,
    to: Id.optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((a, ctx) => {
    const spec = ANIMS[a.type];
    checkWith(spec.params, a.params ?? {}, ['params'], ctx);
    const needsTo = spec.lifecycle === 'transform';
    if (needsTo && !a.to) ctx.addIssue({ code: 'custom', message: `${a.type} 必须指定 to`, path: ['to'] });
    if (!needsTo && a.to) ctx.addIssue({ code: 'custom', message: `${a.type} 不接受 to`, path: ['to'] });
  });

export const RATES = ['smooth', 'linear', 'easeInOut', 'rushInto', 'thereAndBack'] as const;

export const Step = z.discriminatedUnion('kind', [
  z.strictObject({
    id: Id,
    kind: z.literal('play'),
    anims: z.array(Anim).min(1),
    duration: z.number(),
    rate: z.enum(RATES).optional(),
    lag: z.number().min(0).max(1).optional(),
  }),
  z.strictObject({ id: Id, kind: z.literal('wait'), duration: z.number() }),
]);

export const Scene = z.strictObject({
  id: Id,
  title: z.string(),
  description: z.string(),
  notes: z.string().optional(),
  kind: z.enum(['dsl', 'code']),
  enter: z.enum(['fresh', 'keep']),
  hold: z.number(),
  locked: z.boolean().optional(),
  elements: z.array(Element),
  steps: z.array(Step),
  code: z.string().optional(),
});

export const Storyboard = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  meta: z.strictObject({
    title: z.string(),
    mode: z.enum(['2d', '3d']),
    aspect: z.enum(['16:9', '9:16', '1:1']),
    background: Color,
    stylePreset: z.enum(['3b1b', 'clean', 'custom']),
    palette: z.partialRecord(z.enum(PALETTE_TOKENS), HexColor).optional(),
  }),
  scenes: z.array(Scene),
});

export type Storyboard = z.infer<typeof Storyboard>;
export type Scene = z.infer<typeof Scene>;
export type Element = z.infer<typeof Element>;
export type Step = z.infer<typeof Step>;
export type Anim = z.infer<typeof Anim>;

/** zod 路径转成 JSON 路径字符串，如 scenes[0].elements[1].props.radius */
export function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>(
    (s, k) => (typeof k === 'number' ? `${s}[${k}]` : s ? `${s}.${String(k)}` : String(k)),
    '',
  );
}

export type ParseResult =
  { ok: true; value: Storyboard } | { ok: false; issues: { path: string; message: string }[] };

export function parseStoryboard(data: unknown): ParseResult {
  const r = Storyboard.safeParse(data);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, issues: r.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })) };
}
