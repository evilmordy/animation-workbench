/** Agent 面板用的预算和日志。纯数据，不写分镜，也不改默认引擎。 */

export interface AgentBudgetSettings {
  maxTurns: number;
  /** null 表示不设 token 上限。 */
  maxTokens: number | null;
}

/** 与 loop 里的 DEFAULT_AGENT_BUDGET.maxTurns 一致。不在这里改引擎默认值。 */
export const DEFAULT_AGENT_BUDGET_SETTINGS: AgentBudgetSettings = {
  maxTurns: 8,
  maxTokens: null,
};

export type AgentStopStatus = 'done' | 'cancelled' | 'budget' | 'error';

export type AgentLogEvent =
  | { type: 'phase'; phase: 'plan' | 'scenes' | 'review'; turn: number }
  | { type: 'note'; message: string }
  | { type: 'tool'; name: string; arguments: string; result: string }
  | { type: 'usage'; turns: number; usage: [number, number]; maxTurns: number; maxTokens?: number }
  | { type: 'status'; status: AgentStopStatus; message: string };

export interface AgentLogLine {
  id: number;
  kind: 'phase' | 'note' | 'tool' | 'status';
  title: string;
  detail?: string;
}

export function normalizeAgentBudget(value: unknown): AgentBudgetSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<AgentBudgetSettings>) : {};
  const turns = Number(raw.maxTurns);
  const tokens = raw.maxTokens == null ? null : Number(raw.maxTokens);
  return {
    maxTurns: Number.isFinite(turns)
      ? Math.min(32, Math.max(1, Math.round(turns)))
      : DEFAULT_AGENT_BUDGET_SETTINGS.maxTurns,
    maxTokens:
      tokens == null || !Number.isFinite(tokens) || tokens <= 0
        ? null
        : Math.min(2_000_000, Math.round(tokens)),
  };
}

export function budgetFromSettings(value: AgentBudgetSettings): { maxTurns: number; maxTokens?: number } {
  const normalized = normalizeAgentBudget(value);
  return normalized.maxTokens == null
    ? { maxTurns: normalized.maxTurns }
    : { maxTurns: normalized.maxTurns, maxTokens: normalized.maxTokens };
}

const TOOL_TITLES: Record<string, string> = {
  render_frames: '截帧 render_frames',
  view_image: '看图 view_image',
  check_layout: '版面 check_layout',
  check_residual: '换场残留 check_residual',
  console_errors: '控制台 console_errors',
};

/** 工具结果按原文展示。data URL 换成占位，避免把整张图铺进日志。 */
export function formatToolLog(call: { name: string; arguments: string; result: string }): {
  title: string;
  detail: string;
} {
  const title = TOOL_TITLES[call.name] ?? `工具 ${call.name}`;
  const args = call.arguments.trim() || '{}';
  const result = call.result.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, '[图片]');
  return { title, detail: `参数 ${args}\n${result}` };
}

const PHASE_LABEL = { plan: '写 plan', scenes: '写场景代码', review: '截帧检查' } as const;

export function describeAgentStop(
  status: AgentStopStatus,
  info: {
    turns: number;
    maxTurns: number;
    tokens: number;
    maxTokens?: number;
    error?: string;
    scenes?: number;
    skipped?: number;
  },
): string {
  if (status === 'cancelled') return '已取消';
  if (status === 'budget') {
    const tokens =
      info.maxTokens !== undefined ? `，tokens ${info.tokens}/${info.maxTokens}` : `，tokens ${info.tokens}`;
    return `已达到上限（轮次 ${info.turns}/${info.maxTurns}${tokens}），已停下`;
  }
  if (status === 'done') {
    const skipped = info.skipped ? `，跳过 ${info.skipped} 个锁定场景` : '';
    return `已写入 ${info.scenes ?? 0} 个代码场景${skipped}`;
  }
  return info.error ?? 'Agent 失败';
}

export function lineFromEvent(event: AgentLogEvent, id: number): AgentLogLine | null {
  if (event.type === 'usage') return null;
  if (event.type === 'phase') {
    return { id, kind: 'phase', title: `${PHASE_LABEL[event.phase]}（第 ${event.turn} 轮）` };
  }
  if (event.type === 'note') return { id, kind: 'note', title: event.message };
  if (event.type === 'tool') {
    const formatted = formatToolLog(event);
    return { id, kind: 'tool', title: formatted.title, detail: formatted.detail };
  }
  return { id, kind: 'status', title: event.message };
}
