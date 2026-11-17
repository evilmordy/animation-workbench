import type { LlmMessage, ContentPart } from '../../platform/types';
import type { Storyboard } from '../../shared/schema';
import type { Memory } from './memory';
import { taskCard } from './prompts';
import { splitSource } from './source';
import { formatNumbered } from './tools/code';
import type { Phase } from './tools/defs';

/** 单轮输入目标。超了就按设计书的顺序裁，不在这里写模型名。 */
export const CONTEXT_BUDGET = 60_000;

const OPEN = new Set(['open', 'stuck']);

function tokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function clip(text: string, maxTokens: number): string {
  const max = maxTokens * 4;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（已截断）`;
}

export function projectContext(input: {
  phase: Phase;
  mem: Memory;
  storyboard: Storyboard | null;
  intent: string;
  source: string;
  system: string;
  edit?: { sceneId: string; instruction: string };
  budgetTokens?: number;
}): LlmMessage[] {
  const sb = input.storyboard;
  const budget = input.budgetTokens ?? CONTEXT_BUDGET;
  const shrink = input.mem.shrink;
  const currentId = input.edit?.sceneId ?? input.mem.currentSceneId;
  const current = sb?.scenes.find((scene) => scene.id === currentId);
  const currentState = current ? input.mem.scenes[current.id] : undefined;
  const cited = new Set<number>();
  for (const state of Object.values(input.mem.scenes)) {
    for (const n of state.sourceParagraphs) cited.add(n);
  }
  const paragraphs = splitSource(input.source);
  let sourceBody = shrink
    ? ''
    : paragraphs
        .filter((paragraph) => cited.has(paragraph.n))
        .map((paragraph) => `## [${paragraph.n}]\n${paragraph.text}`)
        .join('\n\n');
  sourceBody = clip(sourceBody, 12_000);

  const plan = shrink ? '' : clip(input.mem.plan, 4_000);
  const sceneTable = (sb?.scenes ?? [])
    .map((scene) => {
      const state = input.mem.scenes[scene.id];
      const summary = state?.summary ? ` ${state.summary}` : '';
      return `${scene.id} ${scene.title} ${state?.status ?? 'planned'} hold=${scene.hold}${summary}`;
    })
    .join('\n');
  let others = shrink
    ? ''
    : (sb?.scenes ?? [])
        .filter((scene) => scene.id !== current?.id)
        .map((scene) => {
          const state = input.mem.scenes[scene.id];
          return `${scene.id} ${scene.title} · ${state?.status ?? 'planned'} · ${state?.summary || '无摘要'}`;
        })
        .join('\n');
  others = clip(others, 2_000);

  const openIssues = input.mem.issues.filter((issue) => OPEN.has(issue.status));
  const waived = input.mem.issues.filter((issue) => issue.status === 'waived').map((issue) => issue.id);
  const issueText = clip(
    [
      ...openIssues
        .slice()
        .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
        .slice(0, 30)
        .map(
          (issue) =>
            `${issue.id} ${issue.severity} ${issue.kind} ${issue.scene_id} ${issue.evidence.text ?? ''}`,
        ),
      waived.length ? `已豁免 ${waived.join(' ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    3_000,
  );

  const recent = input.mem.turns.slice(-2);
  const older = input.mem.turns.slice(0, -2);
  let olderText = shrink ? '' : older.map((turn) => turn.line).join('\n');
  olderText = clip(olderText, 2_000);
  let recentText = recent.map((turn) => turn.detail || turn.line).join('\n\n');
  recentText = clip(recentText, 16_000);

  const code = current ? formatNumbered(current.code ?? '') : '';
  const sections = [
    `阶段 ${input.phase}${current ? `，当前场 ${current.id}` : ''}`,
    input.edit ? `精确编辑 ${input.edit.sceneId}：${input.edit.instruction}` : '',
    shrink ? '上下文已压缩到当前场。' : '',
    taskCard(input.intent, input.source),
    sourceBody ? `计划引用的素材原文：\n${sourceBody}` : '',
    plan
      ? `计划：\n${clip(plan, 4_000)}\n\n场表：\n${clip(sceneTable, 4_000)}`
      : sceneTable
        ? `场表：\n${sceneTable}`
        : '',
    current
      ? `当前场 ${current.id} hash ${currentState?.hash ?? ''} hold ${current.hold}${current.locked ? ' 锁定' : ''}${currentState?.summary === '用户已改，以此为准' ? '\n用户已改，以此为准' : ''}\n${clip(code, 12_000)}`
      : '',
    currentState?.endState ? `上一场结束画面：${currentState.endState}` : '',
    others ? `其他场（没有代码）：\n${others}` : '',
    issueText ? `未关闭问题：\n${issueText}` : '未关闭问题：无',
    olderText ? `更早：\n${olderText}` : '',
    recentText ? `最近：\n${recentText}` : '',
  ].filter((part) => part.trim().length > 0);

  let body = sections.join('\n\n');
  if (tokens(body) > budget) {
    body = sections.filter((part) => !part.startsWith('更早') && !part.startsWith('其他场')).join('\n\n');
  }
  if (tokens(body) > budget) {
    body = sections
      .filter(
        (part) => !part.startsWith('更早') && !part.startsWith('其他场') && !part.startsWith('计划引用'),
      )
      .join('\n\n');
  }
  if (tokens(body) > budget && recentText) {
    const short = sections.map((part) =>
      part.startsWith('最近') ? `最近：\n${clip(recentText, 1_000)}` : part,
    );
    body = short
      .filter(
        (part) => !part.startsWith('更早') && !part.startsWith('其他场') && !part.startsWith('计划引用'),
      )
      .join('\n\n');
  }

  const images = recent.at(-1)?.images.slice(0, 8) ?? [];
  const user: LlmMessage = images.length
    ? {
        role: 'user',
        content: [
          { type: 'text', text: body },
          ...images.flatMap((image) => [
            { type: 'text', text: image.caption } satisfies ContentPart,
            { type: 'image_url', image_url: { url: image.dataUrl } } satisfies ContentPart,
          ]),
        ],
      }
    : { role: 'user', content: body };

  return [{ role: 'system', content: input.system }, user];
}

function severityRank(severity: string): number {
  if (severity === 'blocker') return 0;
  if (severity === 'major') return 1;
  return 2;
}
