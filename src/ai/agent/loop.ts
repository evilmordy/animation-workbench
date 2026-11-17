import { newId } from '../../shared/id';
import { messageText, type LlmMessage, type ToolCall } from '../../platform/types';
import type { Transport } from '../client';
import { projectContext } from './context';
import { describeAgentStop, type AgentLogEvent } from './log';
import {
  appendLog,
  applyInspection,
  focusScene,
  nextPhase,
  openMemory,
  redactCode,
  syncStoryboard,
  type AgentHost,
  type Memory,
} from './memory';
import { agentSystemPrompt } from './prompts';
import type { CodeRenderer } from './renderer';
import { toolDefs, type Phase } from './tools/defs';
import { executeTool, localInspect, type Inspect, type ToolOutcome } from './tools/run';

export type { AgentHost } from './memory';

export const TOKEN_BUDGET = 1_200_000;

export interface AgentBudget {
  /** 面板上的轮次安全阀。不传则用 24。 */
  maxTurns?: number;
  /** 累计 prompt + completion。不传则用 120 万。null 表示不设。 */
  maxTokens?: number | null;
  /** 单次补全上限。null 或省略表示请求里不传 max_tokens。 */
  completionTokens?: number | null;
}

export const DEFAULT_AGENT_BUDGET: AgentBudget = {
  maxTurns: 24,
  maxTokens: TOKEN_BUDGET,
  completionTokens: null,
};

export interface AgentResult {
  status: 'done' | 'done_with_issues' | 'stuck' | 'cancelled' | 'budget' | 'error';
  turns: number;
  usage: [number, number];
  sceneIds: string[];
  skippedLocked: string[];
  error?: string;
}

export interface RunAgentOpts {
  /** 用户需求原文。每一轮从状态重建时都会带上，当作指令，不截断。 */
  intent: string;
  /** 导入的讲义。生成开始时写成 source.md，提示里只放段落目录。 */
  source?: string;
  transport: Transport;
  host: AgentHost;
  budget?: AgentBudget;
  renderer?: CodeRenderer;
  /** 精确编辑。不传就是从 PLAN 开始。界面在 PR-11。 */
  edit?: { sceneId: string; instruction: string };
  /** 缺省用运行门之后的 checkScenes，不打开预览。产品入口传入应用内后端。 */
  inspect?: Inspect;
  /** 单轮上下文 token 估计上限。 */
  contextBudget?: number;
  signal?: AbortSignal;
  onPhase?: (phase: 'plan' | 'scene' | 'film' | 'edit') => void;
  onLog?: (event: AgentLogEvent) => void;
  onCancelRequest?: (requestId: string) => void;
}

const PHASE_LOG = { PLAN: 'plan', SCENE: 'scene', FILM: 'film', EDIT: 'edit' } as const;
const PHASE_TITLE = { PLAN: '写 plan', SCENE: '写场景代码', FILM: '整片收尾', EDIT: '改一场' } as const;

function isCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'cancelled'
  );
}

function argsOk(calls: ToolCall[]): boolean {
  return calls.every((call) => {
    try {
      const value = JSON.parse(call.function.arguments || '{}') as unknown;
      return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    } catch {
      return false;
    }
  });
}

type TurnKind = 'filtered' | 'truncated' | 'empty' | 'text-only' | 'tools';

function classify(res: { text: string; finishReason?: string | null; toolCalls?: ToolCall[] }): TurnKind {
  if (res.finishReason === 'content_filter') return 'filtered';
  const calls = res.toolCalls ?? [];
  if (res.finishReason === 'length') return calls.length > 0 && argsOk(calls) ? 'tools' : 'truncated';
  if (!res.text.trim() && calls.length === 0) return 'empty';
  if (calls.length === 0) return 'text-only';
  return 'tools';
}

function messageChars(messages: LlmMessage[]): number {
  return messages.reduce((sum, message) => {
    const content = 'content' in message ? message.content : '';
    return sum + messageText(content).length;
  }, 0);
}

/**
 * 唯一的 agent 循环。每轮从分镜和记忆重建上下文，不累积历史。
 * 不向传输层传 max_tokens；输出被截断时看 finishReason，不把同一请求原样重发。
 */
export async function runAgent(opts: RunAgentOpts): Promise<AgentResult> {
  const maxTurns = opts.budget?.maxTurns ?? DEFAULT_AGENT_BUDGET.maxTurns ?? 24;
  const maxTokens =
    opts.budget && 'maxTokens' in opts.budget ? (opts.budget.maxTokens ?? null) : TOKEN_BUDGET;
  const renderer: CodeRenderer = opts.renderer === 'manim' ? 'manim' : 'anime';
  const inspect = opts.inspect ?? localInspect;
  const usage: [number, number] = [0, 0];
  let turns = 0;
  let phase: Phase = opts.edit ? 'EDIT' : 'PLAN';
  let textStreak = 0;
  let emptyStreak = 0;
  let idleStreak = 0;
  let nudged = false;

  const finish = (status: AgentResult['status'], error?: string): AgentResult => {
    const sb = opts.host.getStoryboard();
    const sceneIds =
      sb?.scenes
        .filter((scene) => scene.kind === 'code' && Boolean(scene.code?.trim()))
        .map((scene) => scene.id) ?? [];
    const skippedLocked = sb?.scenes.filter((scene) => scene.locked).map((scene) => scene.id) ?? [];
    const result: AgentResult = {
      status,
      turns,
      usage,
      sceneIds,
      skippedLocked,
      ...(error ? { error } : {}),
    };
    opts.onLog?.({
      type: 'status',
      status,
      message: describeAgentStop(status, {
        turns,
        maxTurns,
        tokens: usage[0] + usage[1],
        ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
        ...(error ? { error } : {}),
        scenes: sceneIds.length,
        skipped: skippedLocked.length,
      }),
    });
    return result;
  };

  if (!opts.intent.trim()) return finish('error', '需求是空的');
  const initial = opts.host.getStoryboard();
  if (!initial) return finish('error', '没有打开的分镜');
  const source = opts.source ?? '';
  let mem: Memory;
  try {
    mem = await openMemory(opts.host, source, initial);
  } catch (error) {
    return finish('error', error instanceof Error ? error.message : String(error));
  }
  const system = agentSystemPrompt(renderer);

  const overTokens = () => typeof maxTokens === 'number' && usage[0] + usage[1] >= maxTokens;

  const noteIdle = (wrote: boolean) => {
    if (wrote) {
      idleStreak = 0;
      nudged = false;
      mem.shrink = false;
      return null;
    }
    idleStreak += 1;
    if (idleStreak === 3 && !nudged) {
      nudged = true;
      mem.turns.push({
        turn: turns,
        line: `T${turns} 请改代码或 finish`,
        detail: '连续多轮没有写入。请改代码或 finish。',
        images: [],
      });
    }
    if (idleStreak >= 6) return finish('stuck', '连续多轮没有写入');
    return null;
  };

  while (true) {
    if (opts.signal?.aborted) return finish('cancelled');
    if (turns >= maxTurns || overTokens()) return finish('budget');

    const sb = opts.host.getStoryboard();
    if (!sb) return finish('error', '没有打开的分镜');
    syncStoryboard(mem, sb);
    focusScene(mem, sb, opts.edit?.sceneId);

    if (phase === 'FILM' && mem.pendingFilmCheck) {
      mem.pendingFilmCheck = false;
      try {
        const report = await inspect(sb, { sceneIds: sb.scenes.map((scene) => scene.id), film: true });
        applyInspection(
          mem,
          sb.scenes.map((scene) => scene.id),
          report.issues,
          turns,
        );
        const problems = mem.issues.some((issue) => {
          if (issue.status !== 'open' && issue.status !== 'stuck') return false;
          if (issue.severity !== 'blocker' && issue.severity !== 'major') return false;
          return !sb.scenes.find((scene) => scene.id === issue.scene_id)?.locked;
        });
        if (problems) {
          phase = 'SCENE';
          mem.turns.push({
            turn: turns,
            line: '整片体检发现未关闭问题，回到场次',
            detail: '整片体检还有 blocker 或 major，先回到有问题的场。',
            images: [],
          });
        }
      } catch (error) {
        mem.turns.push({
          turn: turns,
          line: '整片体检失败',
          detail: error instanceof Error ? error.message : String(error),
          images: [],
        });
      }
    }

    const messages = projectContext({
      phase,
      mem,
      storyboard: sb,
      intent: opts.intent,
      source,
      system,
      edit: opts.edit,
      budgetTokens: opts.contextBudget,
    });
    const requestId = newId('req');
    const onAbort = () => opts.onCancelRequest?.(requestId);
    opts.signal?.addEventListener('abort', onAbort);
    const logged = PHASE_LOG[phase];
    opts.onPhase?.(logged);
    opts.onLog?.({ type: 'phase', phase: logged, turn: turns + 1 });
    let res: Awaited<ReturnType<Transport>>;
    try {
      res = await opts.transport(messages, {
        requestId,
        title: PHASE_TITLE[phase],
        onDelta: () => {},
        jsonMode: null,
        tools: toolDefs(phase),
        toolChoice: 'auto',
      });
    } catch (error) {
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted || isCancelled(error)) return finish('cancelled');
      return finish('error', error instanceof Error ? error.message : String(error));
    }
    opts.signal?.removeEventListener('abort', onAbort);
    if (opts.signal?.aborted) return finish('cancelled');

    turns += 1;
    if (res.usage) {
      usage[0] += res.usage[0];
      usage[1] += res.usage[1];
    } else {
      usage[0] += Math.max(1, Math.ceil(messageChars(messages) / 4));
      usage[1] += Math.max(1, Math.ceil(res.text.length / 4));
    }
    opts.onLog?.({
      type: 'usage',
      turns,
      usage,
      maxTurns,
      ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
    });
    if (res.text.trim()) opts.onLog?.({ type: 'note', message: res.text.trim().slice(0, 500) });

    const kind = classify(res);
    const truncKey = mem.currentSceneId ?? 'plan';
    try {
      await appendLog(opts.host, {
        turn: turns,
        phase,
        finishReason: res.finishReason ?? null,
        kind,
        tokens: usage[0] + usage[1],
      });
    } catch {
      // 日志写失败不打断生成。
    }

    if (kind === 'filtered') return finish('error', '服务商拦截了这次输出');
    if (kind === 'empty') {
      emptyStreak += 1;
      textStreak = 0;
      mem.turns.push({ turn: turns, line: `T${turns} 空输出`, detail: '上一轮没有输出。', images: [] });
      if (emptyStreak >= 2) return finish('error', '连续两轮空输出');
      const stopped = noteIdle(false);
      if (stopped) return stopped;
      if (overTokens()) return finish('budget');
      continue;
    }
    emptyStreak = 0;
    if (kind === 'truncated') {
      textStreak = 0;
      const calls = res.toolCalls ?? [];
      const received = calls.reduce((sum, call) => sum + call.function.arguments.length, 0) + res.text.length;
      mem.truncations[truncKey] = (mem.truncations[truncKey] ?? 0) + 1;
      const count = mem.truncations[truncKey] ?? 1;
      if (count >= 2) mem.shrink = true;
      const detail = JSON.stringify({
        ok: false,
        error: {
          code: 'TRUNCATED',
          message: `输出被截断（收到 ${received} 字）`,
          hint: '请改用 edit_range 或缩短，不要原样重发',
        },
      });
      mem.turns.push({ turn: turns, line: `T${turns} TRUNCATED ${received} 字`, detail, images: [] });
      opts.onLog?.({ type: 'note', message: `TRUNCATED：收到 ${received} 字` });
      if (count >= 3) {
        const scene = mem.currentSceneId ? mem.scenes[mem.currentSceneId] : undefined;
        if (scene) scene.status = 'stuck';
        else return finish('stuck', '规划输出连续截断');
      }
      const stopped = noteIdle(false);
      if (stopped) return stopped;
      if (overTokens()) return finish('budget');
      continue;
    }
    if (kind === 'text-only') {
      textStreak += 1;
      const fence = res.text.includes('```') ? '代码只能通过 write_scene / edit_range 提交。' : '';
      mem.turns.push({
        turn: turns,
        line: `T${turns} 只有正文`,
        detail: `请用工具提交。${fence}`,
        images: [],
      });
      if (textStreak >= 3) return finish('stuck', '连续三轮只有正文');
      const stopped = noteIdle(false);
      if (stopped) return stopped;
      if (overTokens()) return finish('budget');
      continue;
    }

    textStreak = 0;
    if (res.finishReason === 'length') {
      opts.onLog?.({ type: 'note', message: '输出被截断，但工具参数完整，已执行' });
    }
    let wrote = false;
    const lines: string[] = [];
    const details: string[] = [];
    let images: { dataUrl: string; caption: string }[] = [];
    for (const call of res.toolCalls ?? []) {
      let outcome: ToolOutcome;
      try {
        outcome = await executeTool(call.function.name, call.function.arguments, {
          phase,
          turn: turns,
          host: opts.host,
          mem,
          source,
          editSceneId: opts.edit?.sceneId,
          inspect,
        });
      } catch (error) {
        outcome = {
          content: JSON.stringify({
            ok: false,
            error: {
              code: 'RUNTIME_ERROR',
              message: error instanceof Error ? error.message : String(error),
              hint: '看这条错误',
            },
          }),
        };
      }
      if (outcome.wrote) wrote = true;
      if (outcome.images?.length) images = outcome.images.slice(0, 8);
      const redactedArgs = redactCode(call.function.arguments || '{}');
      const redacted = redactCode(outcome.content);
      lines.push(`${call.function.name} ${redacted.slice(0, 160)}`);
      details.push(`${call.function.name} ${redactedArgs}\n${redacted}`);
      opts.onLog?.({
        type: 'tool',
        name: call.function.name,
        arguments: redactedArgs,
        result: redacted,
      });
      if (outcome.terminal) {
        mem.turns.push({
          turn: turns,
          line: `T${turns} ${lines.join('；')}`,
          detail: details.join('\n\n'),
          images,
        });
        return finish(outcome.terminal);
      }
    }
    mem.turns.push({
      turn: turns,
      line: `T${turns} ${lines.join('；')}`.slice(0, 240),
      detail: details.join('\n\n'),
      images,
    });
    const stopped = noteIdle(wrote);
    if (stopped) return stopped;
    if (overTokens()) return finish('budget');

    const prev = phase;
    const latest = opts.host.getStoryboard() ?? sb;
    phase = nextPhase(phase, latest, mem);
    if (phase === 'FILM' && (prev !== 'FILM' || wrote)) mem.pendingFilmCheck = true;
  }
}
