/** Agent 面板用的预算和日志。纯数据，不写分镜，也不改默认引擎。 */

export interface AgentBudgetSettings {
  maxTurns: number;
  /** null 表示不设 token 上限。 */
  maxTokens: number | null;
  /**
   * 单次补全的 max_tokens。null 表示请求里不传。
   * 不传这个数：DeepSeek 未必接受 65536，截断改由 finishReason 处理。
   * 评测请求同样不传，两边保持一致。
   */
  completionTokens: number | null;
}

/** 轮次仍是面板上的安全阀。真正停手看 120 万 token 和单场 8 次写入。 */
export const DEFAULT_AGENT_BUDGET_SETTINGS: AgentBudgetSettings = {
  maxTurns: 24,
  maxTokens: 1_200_000,
  completionTokens: null,
};

/** DeepSeek 文档里的输出上限是 384K。再大会被拒绝。 */
const MAX_COMPLETION_TOKENS = 393_216;

export type AgentStopStatus = 'done' | 'done_with_issues' | 'stuck' | 'cancelled' | 'budget' | 'error';

export type AgentLogEvent =
  | { type: 'phase'; phase: 'plan' | 'scene' | 'film' | 'edit'; turn: number }
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
  const tokenPresent = Boolean(value && typeof value === 'object' && 'maxTokens' in value);
  const tokenRaw = raw.maxTokens == null ? null : Number(raw.maxTokens);
  const completion = raw.completionTokens;
  return {
    maxTurns: Number.isFinite(turns)
      ? Math.min(128, Math.max(1, Math.round(turns)))
      : DEFAULT_AGENT_BUDGET_SETTINGS.maxTurns,
    maxTokens: !tokenPresent
      ? DEFAULT_AGENT_BUDGET_SETTINGS.maxTokens
      : tokenRaw == null || !Number.isFinite(tokenRaw) || tokenRaw <= 0
        ? null
        : Math.min(2_000_000, Math.round(tokenRaw)),
    completionTokens:
      completion == null || !Number.isFinite(Number(completion)) || Number(completion) <= 0
        ? null
        : Math.min(MAX_COMPLETION_TOKENS, Math.round(Number(completion))),
  };
}

export function budgetFromSettings(value: AgentBudgetSettings): {
  maxTurns: number;
  maxTokens: number | null;
  completionTokens: number | null;
} {
  const normalized = normalizeAgentBudget(value);
  return {
    maxTurns: normalized.maxTurns,
    maxTokens: normalized.maxTokens,
    completionTokens: normalized.completionTokens,
  };
}

const TOOL_TITLES: Record<string, string> = {
  read_storyboard: '读分镜 read_storyboard',
  read_source: '读素材 read_source',
  write_plan: '写计划 write_plan',
  read_scene: '读场 read_scene',
  write_scene: '写场 write_scene',
  edit_range: '改行 edit_range',
  write_shared: '共享常量 write_shared',
  capture_frames: '截帧 capture_frames',
  check: '体检 check',
  update_issues: '问题表 update_issues',
  finish: '结束 finish',
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

const PHASE_LABEL = { plan: '写 plan', scene: '写场景代码', film: '整片收尾', edit: '改一场' } as const;

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
  if (status === 'done' || status === 'done_with_issues') {
    const skipped = info.skipped ? `，跳过 ${info.skipped} 个锁定场景` : '';
    const extra = status === 'done_with_issues' ? '，仍有未关闭的问题' : '';
    return `已写入 ${info.scenes ?? 0} 个代码场景${skipped}${extra}`;
  }
  if (status === 'stuck') return info.error ?? '停滞，已停下';
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
