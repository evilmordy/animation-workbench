import { newId } from '../../shared/id';
import type { LlmMessage, ToolCall, ToolChoice, ToolDef } from '../../platform/types';
import type { Transport } from '../client';

/** 工具要让视觉模型看的图。只接受 data URL，密钥不从这里走。 */
export interface ToolImage {
  url: string;
  caption?: string;
}

/** 字符串是纯文本结果。带 image 时，tool 消息仍是文本，图另外追加成用户图像消息。 */
export type ToolOutput = string | { text: string; image?: ToolImage };

/** 一个工具：给模型看的定义，和本地执行。默认引擎不注册这些工具。 */
export interface ToolSpec {
  definition: ToolDef;
  run: (args: unknown) => ToolOutput | Promise<ToolOutput>;
}

export const echoTool: ToolSpec = {
  definition: {
    type: 'function',
    function: {
      name: 'echo',
      description: '原样返回 text，没有任何副作用',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  },
  run(args) {
    if (!args || typeof args !== 'object' || !('text' in args)) return '';
    return String((args as { text: unknown }).text);
  },
};

export interface ToolLoopResult {
  status: 'done' | 'max_rounds';
  rounds: number;
  text: string;
  finishReason: string | null;
  messages: LlmMessage[];
  calls: { id: string; name: string; arguments: string; result: string }[];
}

export const DEFAULT_TOOL_ROUNDS = 4;

/**
 * 模型返回 tool_calls 就执行已注册的 handler，把结果填成 role:tool 消息，再继续。
 * 没有 tool_calls 时停。轮数到上限后不再请求模型。不写分镜，也不改默认 engine。
 * jsonMode 缺省为 null，避免强制 json_object。
 */
export async function runToolLoop(opts: {
  messages: LlmMessage[];
  tools: ToolSpec[];
  transport: Transport;
  maxRounds?: number;
  toolChoice?: ToolChoice;
  jsonMode?: boolean | null;
  title?: string;
}): Promise<ToolLoopResult> {
  const maxRounds = opts.maxRounds ?? DEFAULT_TOOL_ROUNDS;
  const messages = opts.messages.slice();
  const calls: ToolLoopResult['calls'] = [];
  const byName = new Map(opts.tools.map((tool) => [tool.definition.function.name, tool]));
  const defs = opts.tools.map((tool) => tool.definition);
  let text = '';
  let finishReason: string | null = null;
  let rounds = 0;

  while (rounds < maxRounds) {
    rounds += 1;
    const res = await opts.transport(messages, {
      requestId: newId('req'),
      title: opts.title ?? '工具',
      onDelta: () => {},
      jsonMode: opts.jsonMode === undefined ? null : opts.jsonMode,
      tools: defs.length ? defs : undefined,
      toolChoice: opts.toolChoice,
    });
    text = res.text;
    finishReason = res.finishReason ?? null;
    const toolCalls = res.toolCalls ?? [];
    if (!toolCalls.length) {
      messages.push({ role: 'assistant', content: text });
      return { status: 'done', rounds, text, finishReason, messages, calls };
    }
    messages.push({ role: 'assistant', content: text, tool_calls: toolCalls });
    const images: ToolImage[] = [];
    for (const call of toolCalls) {
      const output = await runOne(byName, call);
      calls.push({
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
        result: output.text,
      });
      messages.push({ role: 'tool', tool_call_id: call.id, content: output.text });
      if (output.image) images.push(output.image);
    }
    // 工具结果必须紧挨着 assistant 的 tool_calls。图放在全部 tool 消息之后，用 S4 的用户图像消息。
    if (images.length) {
      messages.push({
        role: 'user',
        content: images.flatMap((image) => [
          { type: 'text' as const, text: image.caption ?? '截帧' },
          { type: 'image_url' as const, image_url: { url: image.url } },
        ]),
      });
    }
  }
  return { status: 'max_rounds', rounds, text, finishReason, messages, calls };
}

function normalizeOutput(value: ToolOutput): { text: string; image?: ToolImage } {
  if (typeof value === 'string') return { text: value };
  const text = typeof value?.text === 'string' ? value.text : '';
  const url = value?.image?.url;
  if (!url || !url.startsWith('data:image/png;base64,')) return { text };
  return { text, image: { url, caption: value.image?.caption } };
}

async function runOne(
  byName: Map<string, ToolSpec>,
  call: ToolCall,
): Promise<{ text: string; image?: ToolImage }> {
  const spec = byName.get(call.function.name);
  if (!spec) return { text: `未知工具：${call.function.name}` };
  let args: unknown = {};
  if (call.function.arguments.trim()) {
    try {
      args = JSON.parse(call.function.arguments) as unknown;
    } catch {
      return { text: 'arguments 不是 JSON' };
    }
  }
  try {
    return normalizeOutput(await spec.run(args));
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e) };
  }
}
