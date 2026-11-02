import { z } from 'zod';
import fixture from '../../tests/fixtures/pythagoras.json';
import type { ChatMessage } from '../platform/types';
import { describeObject, type Field } from '../shared/fields';
import type { GenerationParams } from '../shared/project';
import { ANIMS, ELEMENTS, type AnimType, type ElementType } from '../shared/registry';
import type { Storyboard } from '../shared/schema';
import editTpl from './prompts/edit.md?raw';
import outlineTpl from './prompts/outline.md?raw';
import repairTpl from './prompts/repair.md?raw';
import sceneTpl from './prompts/scene.md?raw';
import systemTpl from './prompts/system.md?raw';

export type Task = 'outline' | 'scene' | 'edit' | 'repair';

/** 素材进入提示词前的长度上限（字符）；超出时截断并在界面上提示 */
export const SOURCE_BUDGET = { outline: 24_000, scene: 6_000 };

export const Outline = z.object({
  title: z.string().min(1),
  scenes: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string(),
        duration: z.number().positive().max(120),
      }),
    )
    .min(1)
    .max(20),
});
export type Outline = z.infer<typeof Outline>;

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ''));

// ---------- 由注册表生成的规格 ----------

function typeOf(f: Field): string {
  switch (f.kind) {
    case 'number':
      return f.positive ? 'number>0' : 'number';
    case 'vec2':
      return f.key.toLowerCase().includes('range') ? '[min,max]' : '[x,y]';
    case 'range3':
      return '[min,max,step]';
    case 'points':
      return '[[x,y],...]';
    case 'enum':
      return f.options!.join('|');
    case 'ref':
      return '元素id';
    case 'refs':
      return '[元素id,...]';
    case 'color':
      return '颜色';
    default:
      return 'string';
  }
}

const propsLine = (fields: Field[]) =>
  fields.length
    ? `{${fields
        .map(
          (f) =>
            `${f.key}${f.optional ? '?' : ''}: ${typeOf(f)}${f.defaultValue !== undefined ? `=${JSON.stringify(f.defaultValue)}` : ''}`,
        )
        .join(', ')}}`
    : '{}';

export function elementSpec(): string {
  return Object.entries(ELEMENTS)
    .map(([t, s]) => `- ${t}（${s.label}）：${s.desc}。props: ${propsLine(describeObject(s.props, s.refs))}`)
    .join('\n');
}

const LC = { enter: '出场', exit: '离场', transform: '变换，需要 to', other: '在场元素' } as const;
export function animSpec(): string {
  return Object.entries(ANIMS)
    .map(([t, s]) => {
      const params = describeObject(s.params);
      return `- ${t}（${s.label}，${LC[s.lifecycle]}）：${s.desc}${params.length ? `。params: ${propsLine(params)}` : ''}`;
    })
    .join('\n');
}

export function systemPrompt(task: Task): string {
  return fill(systemTpl, {
    task,
    elements: `可用的元素类型：\n${elementSpec()}`,
    anims: `可用的动画类型：\n${animSpec()}`,
    example: JSON.stringify(fixture),
  });
}

// ---------- 参数 ----------

const COMPLEXITY = {
  simple: { perScene: 15, min: 2, max: 4, maxElements: 4 },
  medium: { perScene: 10, min: 4, max: 8, maxElements: 6 },
  complex: { perScene: 8, min: 6, max: 12, maxElements: 10 },
} as const;

export function sceneRange(p: GenerationParams): [number, number] {
  const c = COMPLEXITY[p.complexity];
  const n = Math.round(p.targetDuration / c.perScene);
  const mid = Math.max(c.min, Math.min(c.max, n));
  return [Math.max(1, mid - 1), mid + 1];
}

const TYPE_LABEL = {
  math: '数学',
  physics: '物理',
  algorithm: '算法与代码',
  story: '故事文案',
  general: '通用',
} as const;
const TYPE_HINT = {
  math: '公式用 MathTex，函数用 Axes + FunctionGraph，几何图形配合 Indicate/Circumscribe 强调，推导步骤用 TransformMatchingTex。',
  physics:
    '用 Arrow 表示力、速度等矢量，用 Shift/MoveTo 表现运动，关键量用 MathTex 标注，必要时用 Axes 画图像。',
  algorithm:
    '用一排 Square/Rectangle 表示数组或数据结构，Text 写数值；用 SetColor/Indicate 高亮比较的元素，用 MoveTo 表现交换和移动。',
  story: '以简短的 Text 为主（每段不超过 30 字），配合简单图形作为象征，节奏舒缓，用 FadeIn/FadeOut 切换。',
  general: '图形、文字和公式按需组合，保持画面简洁。',
} as const;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n……（素材过长，已截断）` : s);

// ---------- 消息 ----------

export function outlineMessages(source: string, p: GenerationParams): ChatMessage[] {
  const [a, b] = sceneRange(p);
  return [
    { role: 'system', content: systemPrompt('outline') },
    {
      role: 'user',
      content: fill(outlineTpl, {
        duration: p.targetDuration,
        sceneRange: `${a}–${b}`,
        contentType: TYPE_LABEL[p.contentType],
        typeHint: TYPE_HINT[p.contentType],
        source: clip(source, SOURCE_BUDGET.outline),
      }),
    },
  ];
}

export function sceneMessages(args: {
  outline: Outline;
  index: number;
  sceneId: string;
  source: string;
  params: GenerationParams;
  extra?: string;
}): ChatMessage[] {
  const s = args.outline.scenes[args.index]!;
  return [
    { role: 'system', content: systemPrompt('scene') },
    {
      role: 'user',
      content: fill(sceneTpl, {
        index: args.index + 1,
        title: args.outline.title,
        outline: args.outline.scenes.map((x, i) => `${i + 1}. ${x.title}：${x.description}`).join('\n'),
        sceneId: args.sceneId,
        sceneTitle: s.title,
        sceneDescription: s.description,
        duration: s.duration,
        maxElements: COMPLEXITY[args.params.complexity].maxElements,
        contentType: TYPE_LABEL[args.params.contentType],
        typeHint: TYPE_HINT[args.params.contentType],
        extra: args.extra ? `- 额外要求：${args.extra}` : '',
        source: clip(args.source || '（无）', SOURCE_BUDGET.scene),
      }),
    },
  ];
}

export type EditScope = { kind: 'scene'; sceneId: string } | { kind: 'all' };

export function editMessages(sb: Storyboard, instruction: string, scope: EditScope): ChatMessage[] {
  const locked = sb.scenes.filter((s) => s.locked).map((s) => s.id);
  const target = scope.kind === 'scene' ? sb.scenes.find((s) => s.id === scope.sceneId) : null;
  const current =
    scope.kind === 'scene' && target
      ? JSON.stringify({
          scene: target,
          // 提供前后场景的概要，便于保持衔接
          context: sb.scenes.map((s) => ({ id: s.id, title: s.title, enter: s.enter })),
        })
      : JSON.stringify(sb);
  return [
    { role: 'system', content: systemPrompt('edit') },
    {
      role: 'user',
      content: fill(editTpl, {
        instruction,
        scope:
          scope.kind === 'scene' ? `只修改场景 ${scope.sceneId}（"${target?.title ?? ''}"）` : '整个分镜',
        locked: locked.length ? locked.join('、') : '无',
        current,
      }),
    },
  ];
}

export function repairMessages(history: ChatMessage[], previous: string, issues: string[]): ChatMessage[] {
  return [
    ...history,
    { role: 'assistant', content: previous },
    {
      role: 'user',
      content: fill(repairTpl, {
        issues: issues.map((i) => `- ${i}`).join('\n'),
        previous: '（见上一条回复）',
      }),
    },
  ];
}

export const taskOf = (messages: ChatMessage[]): Task =>
  (/任务类型：(\w+)/.exec(messages[0]?.content ?? '')?.[1] as Task | undefined) ?? 'outline';

export type { AnimType, ElementType };
