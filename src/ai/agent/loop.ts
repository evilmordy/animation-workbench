import type { ChatMessage } from '../../platform/types';
import { newId } from '../../shared/id';
import type { Storyboard } from '../../shared/schema';
import type { Transport } from '../client';
import { acceptStoryboard, applyAgentScenes, parseRubric, type PlannedScene } from './apply';
import { describeAgentStop, type AgentLogEvent } from './log';
import { isAnimPath, parseAgentFiles, sceneIdFromName, unclosedFence } from './parse';
import { fenceRetry, openingMessages, planRequest, scenesRequest } from './prompts';
import type { CodeRenderer } from './renderer';

export interface AgentBudget {
  /** 最多调用模型几次。计划占一轮，场景接着写。 */
  maxTurns: number;
  /** 累计 prompt + completion。不传则只受 maxTurns 限制。 */
  maxTokens?: number;
  /** 单次补全上限。null 表示不传 max_tokens。产品入口由 run.ts 放进请求。 */
  completionTokens?: number | null;
}

/**
 * 计划占 1 轮，之后一轮一场。8 轮写不完一场以上的片子。
 * 直接把默认加到 24，不再按场景数另算一笔。面板上限仍是 32。
 */
export const DEFAULT_AGENT_BUDGET: AgentBudget = { maxTurns: 24 };

/** 旁路文件写在项目的 .awb/anim/ 下，名字是 plan.md、rubric.json、shared.js、scenes/<id>.js。 */
export interface AgentHost {
  getStoryboard(): Storyboard | null;
  /** 唯一写分镜的入口。产品里就是 project.update，因此可以撤销。 */
  updateStoryboard(next: Storyboard): void;
  writeFile(name: string, text: string): Promise<void>;
  readFile(name: string): Promise<string | null>;
}

export interface AgentResult {
  status: 'done' | 'cancelled' | 'budget' | 'error';
  turns: number;
  usage: [number, number];
  sceneIds: string[];
  skippedLocked: string[];
  error?: string;
}

export interface RunAgentOpts {
  /** 用户需求原文。每一轮请求都会带上它，当作指令。 */
  intent: string;
  transport: Transport;
  host: AgentHost;
  budget?: Partial<AgentBudget>;
  /** 这一片用哪套代码契约。缺省 GSAP。 */
  renderer?: CodeRenderer;
  signal?: AbortSignal;
  onPhase?: (phase: 'plan' | 'scenes') => void;
  onLog?: (event: AgentLogEvent) => void;
  onCancelRequest?: (requestId: string) => void;
}

function isCancelled(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: unknown }).code === 'cancelled';
}

function lockedIds(sb: Storyboard | null): string[] {
  return sb?.scenes.filter((s) => s.locked).map((s) => s.id) ?? [];
}

function allSatisfied(
  planned: PlannedScene[],
  authored: ReadonlyMap<string, string>,
  sb: Storyboard | null,
): boolean {
  if (!sb || !planned.length) return false;
  return planned.every((p) => {
    const existing = sb.scenes.find((s) => s.id === p.id);
    if (existing?.locked) return true;
    return Boolean(authored.get(p.id)?.trim()) && existing?.kind === 'code' && Boolean(existing.code?.trim());
  });
}

async function writeAnim(host: AgentHost, name: string, text: string) {
  if (!isAnimPath(name)) throw new Error(`拒绝写入：${name}`);
  await host.writeFile(name, text);
}

/**
 * 同一会话里先写 plan.md 和 rubric.json（共享常量可写 shared.js），再写每场 kind:code。
 * 场景代码在计划落盘之后才写入 scenes[]。没有 tool_calls，模型只按代码块交卷。
 */
export async function runAgent(opts: RunAgentOpts): Promise<AgentResult> {
  const maxTurns = opts.budget?.maxTurns ?? DEFAULT_AGENT_BUDGET.maxTurns;
  const renderer: CodeRenderer = opts.renderer === 'manim' ? 'manim' : 'gsap';
  const maxTokens = opts.budget?.maxTokens;
  const usage: [number, number] = [0, 0];
  const sceneIds: string[] = [];
  const skippedLocked = new Set<string>();
  let turns = 0;

  const finish = (status: AgentResult['status'], error?: string): AgentResult => {
    const result: AgentResult = {
      status,
      turns,
      usage,
      sceneIds,
      skippedLocked: [...skippedLocked],
      ...(error ? { error } : {}),
    };
    opts.onLog?.({
      type: 'status',
      status,
      message: describeAgentStop(status, {
        turns,
        maxTurns,
        tokens: usage[0] + usage[1],
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(error ? { error } : {}),
        scenes: sceneIds.length,
        skipped: skippedLocked.size,
      }),
    });
    return result;
  };

  if (!opts.intent.trim()) return finish('error', '需求是空的');
  const initial = opts.host.getStoryboard();
  if (!initial) return finish('error', '没有打开的分镜');

  const startedEmpty = initial.scenes.length === 0;
  let phase: 'plan' | 'scenes' = 'plan';
  let plan = '';
  let rubricText = '';
  let shared = '';
  let rubricTitle = '';
  let planned: PlannedScene[] = [];
  const authored = new Map<string, string>();
  const messages: ChatMessage[] = openingMessages(opts.intent, renderer);
  const overBudget = () => turns >= maxTurns || (maxTokens !== undefined && usage[0] + usage[1] >= maxTokens);

  while (true) {
    if (opts.signal?.aborted) return finish('cancelled');
    if (phase === 'scenes' && allSatisfied(planned, authored, opts.host.getStoryboard()))
      return finish('done');
    if (overBudget()) return finish('budget');

    const requestId = newId('req');
    const onAbort = () => opts.onCancelRequest?.(requestId);
    opts.signal?.addEventListener('abort', onAbort);
    opts.onPhase?.(phase);
    opts.onLog?.({ type: 'phase', phase, turn: turns + 1 });
    let text = '';
    let finishReason: string | null = null;
    try {
      const res = await opts.transport(messages, {
        requestId,
        title: phase === 'plan' ? '写 plan' : '写场景代码',
        onDelta: () => {},
        jsonMode: null,
      });
      text = res.text;
      finishReason = res.finishReason ?? null;
      if (res.usage) {
        usage[0] += res.usage[0];
        usage[1] += res.usage[1];
      } else {
        usage[0] += Math.max(1, Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4));
        usage[1] += Math.max(1, Math.ceil(text.length / 4));
      }
    } catch (e) {
      if (opts.signal?.aborted || isCancelled(e)) return finish('cancelled');
      return finish('error', e instanceof Error ? e.message : String(e));
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
    }
    turns += 1;
    opts.onLog?.({
      type: 'usage',
      turns,
      usage: [usage[0], usage[1]],
      maxTurns,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    });
    if (opts.signal?.aborted) return finish('cancelled');
    if (!text.trim()) {
      const reason = finishReason ?? '无';
      opts.onLog?.({ type: 'note', message: `模型返回空正文（finish_reason=${reason}），已停止` });
      return finish('error', `模型返回空正文（finish_reason=${reason}）`);
    }
    if (finishReason === 'length') {
      opts.onLog?.({
        type: 'note',
        message: '输出被长度上限截断（finish_reason=length）。只收下已闭合的代码块，不会原样重发。',
      });
    }
    messages.push({ role: 'assistant', content: text });

    try {
      const wrote = await absorb(text, finishReason);
      if (wrote === 'cancelled') return finish('cancelled');
      if (wrote === 'stop') return finish('error', '没有打开的分镜');
      if (wrote === 'stalled') return finish('error', '输出不完整，继续请求会和上一轮一样，已停止');
      if (wrote === 'to-scenes') phase = 'scenes';
    } catch (e) {
      if (opts.signal?.aborted || isCancelled(e)) return finish('cancelled');
      return finish('error', e instanceof Error ? e.message : String(e));
    }
  }

  /** 和上一轮用户消息相同时不再发送。截断后原样重发会把轮次烧完。 */
  function pushUser(content: string): 'continue' | 'stalled' {
    let prev = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message?.role === 'user') {
        prev = message.content;
        break;
      }
    }
    if (prev === content) {
      opts.onLog?.({ type: 'note', message: '下一轮请求和上一轮相同，已停止' });
      return 'stalled';
    }
    messages.push({ role: 'user', content });
    return 'continue';
  }

  /** 消化一轮输出。cancelled：这一轮里被取消，调用方不要再请求模型。to-scenes：计划已落盘。 */
  async function absorb(
    text: string,
    finishReason: string | null,
  ): Promise<'continue' | 'cancelled' | 'stop' | 'to-scenes' | 'stalled'> {
    const files = parseAgentFiles(text);
    const open = unclosedFence(text);
    const retryOpen = (): 'continue' | 'stalled' => {
      opts.onLog?.({
        type: 'note',
        message: open?.name
          ? `代码块未闭合（${open.name}），没有当完整文件，已要求重发`
          : '代码块未闭合，认不出路径，已要求重发',
      });
      return pushUser(fenceRetry(opts.intent, open ?? { name: null, content: text }));
    };
    if (phase === 'plan') {
      const planFile = files.find((f) => f.name === 'plan.md');
      const rubricFile = files.find((f) => f.name === 'rubric.json');
      const sharedFile = files.find((f) => f.name === 'shared.js');
      const parsed = rubricFile ? parseRubric(rubricFile.content) : null;
      if (!planFile?.content.trim() || !rubricFile || !parsed) {
        if (open) return retryOpen();
        const why =
          finishReason === 'length' ? '上一轮输出被长度上限截断。' : '上一轮没有同时给出这两个文件。';
        return pushUser(
          `${planRequest(opts.intent, renderer)}\n\n${why}请只补 anim/plan.md 和带 scenes 的 anim/rubric.json，还不要写场景代码。`,
        );
      }
      plan = planFile.content;
      rubricText = rubricFile.content;
      rubricTitle = parsed.title;
      planned = parsed.scenes;
      if (sharedFile) shared = sharedFile.content;
      await writeAnim(opts.host, 'plan.md', plan);
      if (opts.signal?.aborted) return 'cancelled';
      await writeAnim(opts.host, 'rubric.json', rubricText);
      if (opts.signal?.aborted) return 'cancelled';
      if (sharedFile) {
        await writeAnim(opts.host, 'shared.js', shared);
        if (opts.signal?.aborted) return 'cancelled';
      }
      // 计划阶段即使模型提前丢了场景代码，也不写入 scenes[]。
      if (opts.signal?.aborted) return 'cancelled';
      opts.onLog?.({
        type: 'note',
        message: sharedFile ? '已写入 plan.md、rubric.json、shared.js' : '已写入 plan.md、rubric.json',
      });
      const asked = pushUser(
        scenesRequest({
          intent: opts.intent,
          plan,
          rubric: rubricText,
          shared,
          planned,
          authored,
          lockedIds: lockedIds(opts.host.getStoryboard()),
          renderer,
        }),
      );
      return asked === 'stalled' ? 'stalled' : 'to-scenes';
    }

    const sharedFile = files.find((f) => f.name === 'shared.js');
    if (sharedFile) {
      shared = sharedFile.content;
      await writeAnim(opts.host, 'shared.js', shared);
      if (opts.signal?.aborted) return 'cancelled';
    }
    let gotScene = false;
    for (const file of files) {
      const id = sceneIdFromName(file.name);
      if (!id || !file.content.trim()) continue;
      authored.set(id, file.content);
      await writeAnim(opts.host, file.name, file.content);
      if (opts.signal?.aborted) return 'cancelled';
      gotScene = true;
    }
    const current = opts.host.getStoryboard();
    if (!current) return 'stop';
    if ((gotScene || sharedFile) && !opts.signal?.aborted) {
      const applied = applyAgentScenes({
        storyboard: current,
        planned,
        codes: authored,
        shared,
        adoptTitle: startedEmpty && rubricTitle ? rubricTitle : null,
      });
      for (const id of applied.skippedLocked) skippedLocked.add(id);
      if (applied.changed) {
        const accepted = acceptStoryboard(applied.storyboard);
        if (!accepted) throw new Error('写回的分镜无法通过 schema');
        if (opts.signal?.aborted) return 'cancelled';
        opts.host.updateStoryboard(accepted);
        for (const id of applied.written) if (!sceneIds.includes(id)) sceneIds.push(id);
        if (applied.written.length) {
          opts.onLog?.({ type: 'note', message: `已写入场景 ${applied.written.join('、')}` });
        }
      }
    }
    if (opts.signal?.aborted) return 'cancelled';
    if (allSatisfied(planned, authored, opts.host.getStoryboard())) return 'continue';
    if (open) return retryOpen();
    return pushUser(
      scenesRequest({
        intent: opts.intent,
        plan,
        rubric: rubricText,
        shared,
        planned,
        authored,
        lockedIds: lockedIds(opts.host.getStoryboard()),
        renderer,
      }),
    );
  }
}
