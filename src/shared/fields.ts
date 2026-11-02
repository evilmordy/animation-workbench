import type { z } from 'zod';

/** 从注册表的 zod schema 推断表单字段（检查器用），新增类型时不必改界面代码 */

export type FieldKind = 'number' | 'text' | 'vec2' | 'range3' | 'points' | 'enum' | 'ref' | 'refs' | 'color';

export interface Field {
  key: string;
  kind: FieldKind;
  optional: boolean;
  defaultValue?: unknown;
  /** number 的下限；positive 表示必须 > 0 */
  min?: number;
  positive?: boolean;
  options?: string[];
}

interface Def {
  type: string;
  innerType?: z.ZodType;
  defaultValue?: unknown;
  items?: z.ZodType[];
  element?: z.ZodType;
  entries?: Record<string, string>;
  checks?: { _zod: { def: { check: string; value?: number; inclusive?: boolean } } }[];
  shape?: Record<string, z.ZodType>;
}

const defOf = (s: z.ZodType) => (s as unknown as { _zod: { def: Def } })._zod.def;

export function describeField(key: string, schema: z.ZodType, refKeys: readonly string[] = []): Field {
  let s = schema;
  let optional = false;
  let defaultValue: unknown;
  for (;;) {
    const d = defOf(s);
    if (d.type === 'optional') optional = true;
    else if (d.type === 'default') defaultValue = d.defaultValue;
    else break;
    s = d.innerType!;
  }
  const d = defOf(s);
  const base = { key, optional: optional || defaultValue !== undefined, defaultValue };
  if (refKeys.includes(key)) return { ...base, kind: d.type === 'array' ? 'refs' : 'ref' };
  switch (d.type) {
    case 'number': {
      const gt = d.checks?.find((c) => c._zod.def.check === 'greater_than');
      return {
        ...base,
        kind: 'number',
        min: gt?._zod.def.value,
        positive: gt ? gt._zod.def.value === 0 && !gt._zod.def.inclusive : false,
      };
    }
    case 'string':
      return { ...base, kind: /color|fill/i.test(key) ? 'color' : 'text' };
    case 'enum':
      return { ...base, kind: 'enum', options: Object.values(d.entries ?? {}) };
    case 'tuple':
      return { ...base, kind: d.items!.length === 3 ? 'range3' : 'vec2' };
    case 'array':
      return { ...base, kind: defOf(d.element!).type === 'tuple' ? 'points' : 'refs' };
    default:
      return { ...base, kind: 'text' };
  }
}

export function describeObject(schema: z.ZodObject, refKeys: readonly string[] = []): Field[] {
  return Object.entries(schema.shape).map(([k, v]) => describeField(k, v as z.ZodType, refKeys));
}
