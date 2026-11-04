import { newId } from '../shared/id';
import {
  isLlmError,
  type ChatMessage,
  type LlmError,
  type LlmMessage,
  type ToolCall,
  type ToolChoice,
  type ToolDef,
} from '../platform/types';
import { extractJson } from './extract';
import { repairMessages, type Task } from './prompts';
import type { Checked } from './validators';

export const MAX_REPAIRS = 2;

/** 一次模型调用：返回完整文本；流式文本通过 onDelta 回传 */
export type Transport = (
  messages: LlmMessage[],
  opts: {
    requestId: string;
    onDelta: (full: string) => void;
    title: string;
    /**
     * 缺省：沿用调用方自己的默认（会话里是设置中的 JSON 模式）。
     * null：这次请求不带 json_mode，避免强制 json_object。只有 agent 路径传入。
     */
    jsonMode?: boolean | null;
    /** 缺省或空数组：这次请求不带 tools。 */
    tools?: ToolDef[];
    toolChoice?: ToolChoice;
    /** 单次补全上限。不传则请求体里没有 max_tokens。 */
    maxTokens?: number;
  },
) => Promise<{
  text: string;
  usage?: [number, number] | null;
  finishReason?: string | null;
  toolCalls?: ToolCall[];
}>;

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: 'validation' | 'llm',
    /** 校验失败时最后一次的原始输出，界面可以把它放进专家编辑器手动修 */
    readonly lastText?: string,
    readonly issues: string[] = [],
    readonly llm?: LlmError,
  ) {
    super(message);
  }
}

export interface LogEntry {
  ts: string;
  task: Task;
  title: string;
  attempts: number;
  ok: boolean;
  ms: number;
  usage: [number, number];
  error?: string;
  messages?: ChatMessage[];
  output?: string;
}

export interface RunOpts<T> {
  task: Task;
  title: string;
  messages: ChatMessage[];
  check: (data: unknown) => Checked<T>;
  onDelta?: (full: string) => void;
  onAttempt?: (attempt: number) => void;
  requestId?: string;
}

/**
 * 调用模型 → 提取 JSON → 校验；不通过时把问题回传给模型，最多修复 MAX_REPAIRS 轮（PLAN T3.3）。
 * 成功、修复、失败三条路径都会写一条日志。
 */
export async function runTask<T>(
  transport: Transport,
  o: RunOpts<T>,
  log: (e: LogEntry) => void = () => {},
): Promise<{ value: T; attempts: number; text: string }> {
  const t0 = Date.now();
  const usage: [number, number] = [0, 0];
  let messages = o.messages;
  let text = '';
  let issues: string[] = [];
  const entry = (ok: boolean, attempts: number, error?: string): LogEntry => ({
    ts: new Date().toISOString(),
    task: o.task,
    title: o.title,
    attempts,
    ok,
    ms: Date.now() - t0,
    usage,
    error,
    messages,
    output: text,
  });

  for (let attempt = 1; attempt <= 1 + MAX_REPAIRS; attempt++) {
    o.onAttempt?.(attempt);
    try {
      const r = await transport(messages, {
        requestId: o.requestId ?? newId('req'),
        onDelta: o.onDelta ?? (() => {}),
        title: attempt > 1 ? `${o.title}（自动修复第 ${attempt - 1} 轮）` : o.title,
      });
      text = r.text;
      if (r.usage) {
        usage[0] += r.usage[0];
        usage[1] += r.usage[1];
      }
    } catch (e) {
      const err: LlmError = isLlmError(e) ? e : { code: 'network', message: String(e) };
      log(entry(false, attempt, err.code));
      throw new AiError(err.message, 'llm', text || undefined, [], err);
    }
    const parsed = extractJson(text);
    const checked = parsed.ok ? o.check(parsed.value) : { issues: [parsed.error] };
    if (checked.value !== undefined && !checked.issues.length) {
      log(entry(true, attempt));
      return { value: checked.value, attempts: attempt, text };
    }
    issues = checked.issues.slice(0, 30);
    messages = repairMessages(o.messages, text, issues);
  }
  log(entry(false, 1 + MAX_REPAIRS, 'validation'));
  throw new AiError(`AI 输出经过 ${MAX_REPAIRS} 轮自动修复仍不合格`, 'validation', text, issues);
}
