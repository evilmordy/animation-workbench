import { platform } from '../../platform';
import { useProjectStore } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { aiSession } from '../session';
import { agentToolsEnabled, diskFrameStore, runVisionReview, visionContext } from './frames';
import type { AgentLogEvent } from './log';
import { budgetFromSettings } from './log';
import type { AgentBudget, AgentHost, AgentResult, RunAgentOpts } from './loop';
import { DEFAULT_AGENT_BUDGET, runAgent } from './loop';
import { isAnimPath } from './parse';

/** 把 agent 的旁路文件放进 <project>/.awb/anim/，不改 PROJECT_DIRS，也不另立一套撤销。 */
export function projectAgentHost(): AgentHost {
  const project = useProjectStore();
  return {
    getStoryboard: () => project.storyboard,
    updateStoryboard: (next) => project.update(next),
    async writeFile(name, text) {
      if (!isAnimPath(name)) throw new Error(`拒绝写入：${name}`);
      if (!project.dir) throw new Error('没有打开的项目');
      const base = await platform.join(project.dir, '.awb', 'anim');
      await platform.mkdir(base);
      const parts = name.split('/');
      const sub = parts.length === 2 ? parts[0] : undefined;
      if (sub) await platform.mkdir(await platform.join(base, sub));
      await platform.writeTextAtomic(await platform.join(base, ...parts), text);
    },
    async readFile(name) {
      if (!isAnimPath(name) || !project.dir) return null;
      const file = await platform.join(project.dir, '.awb', 'anim', ...name.split('/'));
      if (!(await platform.exists(file))) return null;
      return platform.readText(file);
    },
  };
}

function isCancelled(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: unknown }).code === 'cancelled';
}

/** 用当前会话的模型通道跑 agent。json_mode 不传，避免强制 json_object。 */
export async function runProjectAgent(
  intent: string,
  opts: {
    signal?: AbortSignal;
    budget?: Partial<AgentBudget>;
    onPhase?: RunAgentOpts['onPhase'];
    onLog?: (event: AgentLogEvent) => void;
  } = {},
): Promise<AgentResult> {
  const session = aiSession();
  const settings = useSettingsStore();
  const project = useProjectStore();
  const budget = opts.budget ?? budgetFromSettings(settings.agentBudget);
  const transport: RunAgentOpts['transport'] = (messages, call) =>
    session.transport(messages, { ...call, jsonMode: null });
  const result = await runAgent({
    intent,
    host: projectAgentHost(),
    budget,
    signal: opts.signal,
    onPhase: opts.onPhase,
    onLog: opts.onLog,
    onCancelRequest: (id) => session.cancel(id),
    transport,
  });
  // 闭环工具默认关。关掉时不截帧，runAgent 仍是一次性写 code。
  if (opts.signal?.aborted || result.status !== 'done' || !agentToolsEnabled(settings.runtime.agentTools)) {
    return result;
  }
  const maxTurns = budget.maxTurns ?? DEFAULT_AGENT_BUDGET.maxTurns;
  const spent = result.usage[0] + result.usage[1];
  const remaining = maxTurns - result.turns;
  if (remaining <= 0 || (budget.maxTokens !== undefined && spent >= budget.maxTokens)) {
    opts.onLog?.({ type: 'note', message: '预算已用完，不再做截帧检查' });
    return result;
  }
  opts.onLog?.({ type: 'phase', phase: 'review', turn: result.turns + 1 });
  try {
    const review = await runVisionReview({
      enabled: true,
      messages: [
        {
          role: 'user',
          content:
            '代码场景已经写好。请调用 render_frames，再用 check_layout 和 check_residual 看画面。只根据工具结果说明问题。',
        },
      ],
      transport,
      ctx: visionContext({
        getStoryboard: () => project.storyboard,
        store: project.dir ? diskFrameStore(project.dir) : undefined,
      }),
      maxRounds: remaining,
      signal: opts.signal,
      onCancelRequest: (id) => session.cancel(id),
      onTool: (call) =>
        opts.onLog?.({
          type: 'tool',
          name: call.name,
          arguments: call.arguments,
          result: call.result,
        }),
    });
    if (review.status === 'cancelled' || opts.signal?.aborted) {
      opts.onLog?.({ type: 'status', status: 'cancelled', message: '已取消' });
      return { ...result, status: 'cancelled' };
    }
    if (review.status === 'max_rounds') {
      opts.onLog?.({ type: 'note', message: '截帧检查达到本轮预算，已停下' });
    } else if (review.status === 'done' && review.text.trim()) {
      opts.onLog?.({ type: 'note', message: review.text.trim().slice(0, 500) });
    }
  } catch (e) {
    if (opts.signal?.aborted || isCancelled(e)) {
      opts.onLog?.({ type: 'status', status: 'cancelled', message: '已取消' });
      return { ...result, status: 'cancelled' };
    }
    const message = e instanceof Error ? e.message : String(e);
    opts.onLog?.({ type: 'note', message: `截帧检查失败：${message}` });
  }
  return result;
}
