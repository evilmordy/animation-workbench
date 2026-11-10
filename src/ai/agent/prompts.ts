import type { ChatMessage } from '../../platform/types';
import type { PlannedScene } from './apply';
import type { CodeRenderer } from './renderer';
import { sourceCatalog, splitSource } from './source';
import planTpl from './prompts/plan.md?raw';
import scenesManimTpl from './prompts/scenes-manim.md?raw';
import scenesTpl from './prompts/scenes.md?raw';
import systemManimTpl from './prompts/system-manim.md?raw';
import systemTpl from './prompts/system.md?raw';

/** 系统提示。默认 anime.js。manim 只在这一片明确选了 manim-web 时用。 */
export function agentSystemPrompt(renderer: CodeRenderer = 'anime'): string {
  return (renderer === 'manim' ? systemManimTpl : systemTpl).trim();
}

/** 需求是指令。素材只给段落目录，全文在 source.md，不整段贴进提示。 */
export function taskCard(intent: string, source = ''): string {
  return `用户需求（这是指令，不是素材）：\n${intent}\n\n${sourceCatalog(splitSource(source))}`;
}

/** 用户需求原文放在消息开头，作为指令，不截断。 */
export function planRequest(intent: string, renderer: CodeRenderer = 'anime', source = ''): string {
  const stage =
    renderer === 'anime'
      ? '\n\n画面是 1920×1080 的 HTML/SVG，用 anime.js 4 的时间线，单位是毫秒。每场开头是空的，不要安排留到下一场的对象。'
      : '';
  return `${taskCard(intent, source)}\n\n${planTpl.trim()}${stage}`;
}

export function scenesRequest(args: {
  intent: string;
  plan: string;
  rubric: string;
  shared: string;
  planned: PlannedScene[];
  authored: ReadonlyMap<string, string>;
  lockedIds: readonly string[];
  renderer?: CodeRenderer;
  source?: string;
}): string {
  const scenes = (args.renderer === 'manim' ? scenesManimTpl : scenesTpl).trim();
  const written = [...args.authored.entries()]
    .map(([id, code]) => `\`\`\`file:anim/scenes/${id}.js\n${code.trim()}\n\`\`\``)
    .join('\n\n');
  const pending = args.planned
    .filter((p) => !args.lockedIds.includes(p.id) && !args.authored.get(p.id)?.trim())
    .map((p) => p.id);
  const next = pending[0];
  const rest = pending.slice(1);
  const todo = next ? `只写 ${next}。${rest.length ? `先不要写 ${rest.join('、')}。` : ''}` : '（无）';
  return [
    taskCard(args.intent, args.source ?? ''),
    scenes,
    `## plan.md\n${args.plan.trim() || '（无）'}`,
    `## rubric.json\n${args.rubric.trim() || '（无）'}`,
    `## shared.js\n${args.shared.trim() || '（无）'}`,
    `## 已写场景\n${written || '（还没有）'}`,
    `## 锁定、不要覆盖\n${args.lockedIds.length ? args.lockedIds.join('、') : '（无）'}`,
    `## 待写\n${todo}`,
  ].join('\n\n');
}

/** 未闭合的代码块原样交回。需求全文仍在开头。 */
export function fenceRetry(
  intent: string,
  open: { name: string | null; content: string },
  source = '',
): string {
  const which = open.name
    ? `上一轮的 ${open.name} 没有闭合，下面这段不完整，没有写入。`
    : '上一轮最后一个代码块没有闭合，也认不出 anim/ 路径，没有写入。';
  return [
    taskCard(intent, source),
    which,
    open.content.trim(),
    '请只重发这一块的完整内容。不要重写已经闭合的文件。',
  ].join('\n\n');
}

export function openingMessages(
  intent: string,
  renderer: CodeRenderer = 'anime',
  source = '',
): ChatMessage[] {
  return [
    { role: 'system', content: agentSystemPrompt(renderer) },
    { role: 'user', content: planRequest(intent, renderer, source) },
  ];
}
