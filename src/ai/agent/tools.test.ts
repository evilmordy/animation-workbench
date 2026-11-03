import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockPlatform, resetMockFs, setMockLlm } from '../../platform/mock';
import type { ChatReq, LlmMessage, ToolCall } from '../../platform/types';
import { useSettingsStore } from '../../stores/settings';
import type { Transport } from '../client';
import { aiSession } from '../session';
import { echoTool, runToolLoop, type ToolSpec } from './tools';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function call(id: string, name: string, args: string): ToolCall {
  return { id, type: 'function', function: { name, arguments: args } };
}

function scripted(steps: { text: string; toolCalls?: ToolCall[] }[]) {
  const seen: {
    messages: LlmMessage[];
    tools?: ToolSpec['definition'][];
    jsonMode: boolean | null | undefined;
  }[] = [];
  const transport: Transport = async (messages, opts) => {
    seen.push({
      messages: structuredClone(messages),
      tools: opts.tools,
      jsonMode: opts.jsonMode,
    });
    const step = steps.shift();
    if (!step) throw new Error('mock 回答用完了');
    return {
      text: step.text,
      toolCalls: step.toolCalls,
      finishReason: step.toolCalls?.length ? 'tool_calls' : 'stop',
      usage: [1, 1] as [number, number],
    };
  };
  return { transport, seen };
}

beforeEach(() => {
  resetMockFs();
  setActivePinia(createPinia());
});

afterEach(() => {
  setMockLlm(async () => {
    throw { code: 'no_key', message: '浏览器模式没有配置假 LLM' };
  });
});

describe('runToolLoop', () => {
  it('执行 echo，把结果填回 tool 消息后再要最终回答', async () => {
    let ran = 0;
    const echo: ToolSpec = {
      ...echoTool,
      run(args) {
        ran += 1;
        return echoTool.run(args);
      },
    };
    const script = scripted([
      { text: '', toolCalls: [call('c1', 'echo', '{"text":"ping"}')] },
      { text: '收到 ping' },
    ]);
    const image: LlmMessage = {
      role: 'user',
      content: [
        { type: 'text', text: '看图' },
        { type: 'image_url', image_url: { url: PNG } },
      ],
    };
    const result = await runToolLoop({
      messages: [image],
      tools: [echo],
      transport: script.transport,
    });
    expect(result.status).toBe('done');
    expect(result.rounds).toBe(2);
    expect(result.text).toBe('收到 ping');
    expect(result.finishReason).toBe('stop');
    expect(ran).toBe(1);
    expect(result.calls).toEqual([{ id: 'c1', name: 'echo', arguments: '{"text":"ping"}', result: 'ping' }]);
    expect(script.seen).toHaveLength(2);
    expect(script.seen[0]!.jsonMode).toBeNull();
    expect(script.seen[0]!.tools).toEqual([echoTool.definition]);
    expect(script.seen[0]!.messages).toEqual([image]);
    expect(JSON.stringify(script.seen[0]!.messages)).toContain(PNG);
    expect(script.seen[1]!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    const toolMsg = script.seen[1]!.messages[2]!;
    expect(toolMsg).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'ping' });
    expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: '收到 ping' });
  });

  it('到达轮数上限后不再请求模型', async () => {
    const script = scripted([
      { text: '', toolCalls: [call('c1', 'echo', '{"text":"a"}')] },
      { text: '不该再被取走' },
    ]);
    const result = await runToolLoop({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [echoTool],
      transport: script.transport,
      maxRounds: 1,
    });
    expect(result.status).toBe('max_rounds');
    expect(result.rounds).toBe(1);
    expect(script.seen).toHaveLength(1);
    expect(result.calls.map((c) => c.result)).toEqual(['a']);
    expect(result.messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'a' });
  });

  it('未知工具和坏 JSON 不抛错，也不执行 echo', async () => {
    let ran = 0;
    const echo: ToolSpec = {
      ...echoTool,
      run(args) {
        ran += 1;
        return echoTool.run(args);
      },
    };
    const script = scripted([
      {
        text: '',
        toolCalls: [call('bad', 'echo', '{'), call('miss', 'nope', '{}')],
      },
      { text: '停' },
    ]);
    const result = await runToolLoop({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [echo],
      transport: script.transport,
    });
    expect(ran).toBe(0);
    expect(result.status).toBe('done');
    expect(result.calls.map((c) => c.result)).toEqual(['arguments 不是 JSON', '未知工具：nope']);
  });
});

describe('图像 parts 与旧请求', () => {
  it('纯文本请求 JSON 不出现 tools，图像 data URL 原样进入 mock', async () => {
    const plain: ChatReq = {
      request_id: 'r',
      provider_id: 'deepseek',
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.3,
      json_mode: true,
    };
    expect(JSON.stringify(plain)).toBe(
      '{"request_id":"r","provider_id":"deepseek","model":"deepseek-chat","messages":[{"role":"user","content":"hi"}],"temperature":0.3,"json_mode":true}',
    );

    const seen: ChatReq[] = [];
    setMockLlm(async (req) => {
      seen.push(JSON.parse(JSON.stringify(req)) as ChatReq);
      return { text: '圆', toolCalls: [call('c1', 'echo', '{"text":"圆"}')], finishReason: 'tool_calls' };
    });
    const vision: LlmMessage = {
      role: 'user',
      content: [
        { type: 'text', text: '看图' },
        { type: 'image_url', image_url: { url: PNG } },
      ],
    };
    const result = await mockPlatform.llmChat(
      {
        request_id: 'img',
        provider_id: 'x',
        model: 'm',
        messages: [vision],
        tools: [echoTool.definition],
        tool_choice: 'auto',
      },
      () => {},
    );
    expect(seen[0]!.messages).toEqual([vision]);
    expect(seen[0]!.tools).toEqual([echoTool.definition]);
    expect(seen[0]!.tool_choice).toBe('auto');
    expect(JSON.stringify(seen[0]!.messages)).toContain(PNG);
    expect(result.tool_calls).toEqual([call('c1', 'echo', '{"text":"圆"}')]);
    expect(result.finish_reason).toBe('tool_calls');
    expect(result.text).toBe('圆');
  });

  it('会话缺省不带 tools，显式传入才转发，且 json_mode 语义不变', async () => {
    const settings = useSettingsStore();
    await settings.load();
    const reqs: ChatReq[] = [];
    setMockLlm(async (req) => {
      reqs.push(JSON.parse(JSON.stringify(req)) as ChatReq);
      return 'ok';
    });
    const session = aiSession();
    const opts = { requestId: 'a', title: 't', onDelta: () => {} };
    await session.transport([{ role: 'user', content: 'hi' }], opts);
    expect(JSON.stringify(reqs[0])).toBe(
      '{"request_id":"a","provider_id":"deepseek","model":"deepseek-chat","messages":[{"role":"user","content":"hi"}],"temperature":0.3,"json_mode":true}',
    );
    expect(reqs[0] && 'tools' in reqs[0]).toBe(false);
    expect(reqs[0] && 'tool_choice' in reqs[0]).toBe(false);

    const vision: LlmMessage = {
      role: 'user',
      content: [
        { type: 'text', text: '看图' },
        { type: 'image_url', image_url: { url: PNG } },
      ],
    };
    await session.transport([vision], {
      ...opts,
      requestId: 'b',
      jsonMode: null,
      tools: [echoTool.definition],
      toolChoice: { type: 'function', function: { name: 'echo' } },
    });
    expect(reqs[1] && 'json_mode' in reqs[1]).toBe(false);
    expect(reqs[1]!.messages).toEqual([vision]);
    expect(reqs[1]!.tools).toEqual([echoTool.definition]);
    expect(reqs[1]!.tool_choice).toEqual({ type: 'function', function: { name: 'echo' } });
    expect(settings.jsonMode()).toBe(true);
  });
});
