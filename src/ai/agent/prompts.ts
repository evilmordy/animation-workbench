import type { ChatMessage } from '../../platform/types';
import type { PlannedScene } from './apply';
import planTpl from './prompts/plan.md?raw';
import scenesTpl from './prompts/scenes.md?raw';
import systemTpl from './prompts/system.md?raw';

/** 系统提示。需求原文不在这里，而在每一轮的用户消息里。 */
export function agentSystemPrompt(): string {
  return systemTpl.trim();
}

/** 用户需求原文放在消息开头，作为指令，不截断。 */
export function planRequest(intent: string): string {
  return `用户需求（这是指令，不是素材）：\n${intent}\n\n${planTpl.trim()}`;
}

export function scenesRequest(args: {
  intent: string;
  plan: string;
  rubric: string;
  shared: string;
  planned: PlannedScene[];
  authored: ReadonlyMap<string, string>;
  lockedIds: readonly string[];
}): string {
  const written = [...args.authored.entries()]
    .map(([id, code]) => `\`\`\`file:anim/scenes/${id}.js\n${code.trim()}\n\`\`\``)
    .join('\n\n');
  const pending = args.planned
    .filter((p) => !args.lockedIds.includes(p.id) && !args.authored.get(p.id)?.trim())
    .map((p) => p.id);
  return [
    `用户需求（这是指令，不是素材）：\n${args.intent}`,
    scenesTpl.trim(),
    `## plan.md\n${args.plan.trim() || '（无）'}`,
    `## rubric.json\n${args.rubric.trim() || '（无）'}`,
    `## shared.js\n${args.shared.trim() || '（无）'}`,
    `## 已写场景\n${written || '（还没有）'}`,
    `## 锁定、不要覆盖\n${args.lockedIds.length ? args.lockedIds.join('、') : '（无）'}`,
    `## 待写\n${pending.length ? pending.join('、') : '（无）'}`,
  ].join('\n\n');
}

export function openingMessages(intent: string): ChatMessage[] {
  return [
    { role: 'system', content: agentSystemPrompt() },
    { role: 'user', content: planRequest(intent) },
  ];
}
