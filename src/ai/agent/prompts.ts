import type { CodeRenderer } from './renderer';
import { sourceCatalog, splitSource } from './source';
import exampleMerge from './prompts/example-a.js?raw';
import examplePsych from './prompts/example-b.js?raw';
import systemTpl from './prompts/system.md?raw';
import { bannedCheatSheet, helperCheatSheet } from './prompts/sheet';

/**
 * 系统提示。正文在 system.md，helper 和禁用清单从 awb.ts / gate.ts 生成。
 * 范例按 §4.6 只附一份别题：归并题给心理场，其余题给归并复杂度场。
 * 字数上限只计正文（不含范例）。
 */
export const EXAMPLE_PREFIX =
  '下面是另一道题里写得好的一场，只学结构、节奏和版面（标题、正文区、底部字幕、逐步出现、停顿），不要照抄内容。';

const MANIM_PROMPT = [
  '你是动画作者，这一片用 manim-web，函数签名是 (scene, M, ctx)。',
  '需求原文是指令。素材是讲解依据，全文在 source.md，需要时用 read_source。',
  '代码只能通过 write_scene / edit_range 提交。正文里的 markdown 代码块不会执行。',
  '先 write_plan，再逐场写。写入后看工具结果里的运行门和体检。锁定场跳过。改已有代码带 base_hash。',
  '每轮正文不超过 200 字，按【看到】【判断】【这一步】写。',
  '未锁定场都写完且没有未关闭的 blocker 或 major，才调用 finish。系统会复核。',
].join('\n');

export function exampleChoice(intent: string): 'psych' | 'mergesort' {
  return intent.includes('归并') ? 'psych' : 'mergesort';
}

function fillTemplate(template: string): string {
  return template
    .replaceAll('{{helpers}}', helperCheatSheet())
    .replaceAll('{{banned}}', bannedCheatSheet())
    .trim();
}

/** 不含范例的系统提示，用来卡 ≤ 2500 字。 */
export function agentPromptBody(renderer: CodeRenderer = 'anime'): string {
  return renderer === 'manim' ? MANIM_PROMPT : fillTemplate(systemTpl);
}

export function agentSystemPrompt(renderer: CodeRenderer = 'anime', intent = ''): string {
  const body = agentPromptBody(renderer);
  if (renderer === 'manim') return body;
  const example = (exampleChoice(intent) === 'psych' ? examplePsych : exampleMerge).trim();
  return `${body}\n\n${EXAMPLE_PREFIX}\n\n${example}\n`;
}

/** 需求是指令。素材只给段落目录，全文在 source.md，不整段贴进提示。 */
export function taskCard(intent: string, source = ''): string {
  return `用户需求（这是指令，不是素材）：\n${intent}\n\n${sourceCatalog(splitSource(source))}`;
}
