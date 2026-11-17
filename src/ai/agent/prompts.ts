import type { CodeRenderer } from './renderer';
import { sourceCatalog, splitSource } from './source';

/**
 * 短系统提示。完整的 helper 速查、禁用清单和范例在 PR-8 重写 system.md。
 * 这里只保证循环能跑：代码走工具，阶段分开，finish 会被复核。
 */
export function agentSystemPrompt(renderer: CodeRenderer = 'anime'): string {
  const contract =
    renderer === 'manim'
      ? '这一片用 manim-web，函数签名是 (scene, M, ctx)。'
      : '这一片是 1920×1080 的 HTML/SVG，用 anime.js 4。函数签名是 (root, anime, tl, ctx)，时间是毫秒。不要写 anime.timeline()，不要 loop: true。hold 由运行时加在场尾。';
  return [
    '你是动画工作台的作者，写可以 seek 的时间线。',
    '需求原文是指令。素材是讲解依据，全文在 source.md，需要时用 read_source。',
    contract,
    '代码只能通过工具参数提交。正文里的代码块不会被执行。',
    '每轮只开放当前阶段的工具：PLAN 规划，SCENE 写当前场，FILM 收整片，EDIT 只改指定场。',
    '改已有代码必须带 read_scene 返回的 base_hash。锁定场不能改，手改过的代码哈希变了，旧哈希会被拒绝。',
    '每次写入后系统会跑运行门和体检，帧和报告在工具结果里。有未解决的 blocker 时 finish 会被拒绝。',
    '调用工具前可以用不超过 200 字写下【看到】【判断】【这一步】。',
  ].join('\n');
}

/** 需求是指令。素材只给段落目录，全文在 source.md，不整段贴进提示。 */
export function taskCard(intent: string, source = ''): string {
  return `用户需求（这是指令，不是素材）：\n${intent}\n\n${sourceCatalog(splitSource(source))}`;
}
