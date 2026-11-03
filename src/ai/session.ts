import { platform, type ChatReq } from '../platform';
import { useAiStore } from '../stores/ai';
import { useManualStore } from '../stores/manual';
import { useProjectStore } from '../stores/project';
import { useSettingsStore } from '../stores/settings';
import type { LogEntry, Transport } from './client';

/** 按当前设置选择 API 或手动模式，返回传输函数和日志函数（需要在 pinia 激活后调用） */
export function aiSession() {
  const settings = useSettingsStore();
  const ai = useAiStore();
  const manual = useManualStore();
  const project = useProjectStore();

  const api: Transport = async (messages, { requestId, onDelta, jsonMode, tools, toolChoice }) => {
    let full = '';
    const req: ChatReq = {
      request_id: requestId,
      provider_id: settings.ai.providerId,
      model: settings.model(),
      messages,
      temperature: settings.ai.temperature,
    };
    // null 表示这次不传 json_mode（agent 路径）。缺省仍用设置里的 JSON 模式。
    if (jsonMode !== null) req.json_mode = jsonMode ?? settings.jsonMode();
    // 空数组和缺省都不写进请求，旧调用的字段集合不变。
    if (tools?.length) req.tools = tools;
    if (toolChoice !== undefined) req.tool_choice = toolChoice;
    const r = await platform.llmChat(req, (e) => {
      if (e.type === 'Delta') onDelta((full += e.text));
    });
    if (r.usage) ai.addUsage(r.usage[0], r.usage[1]);
    return {
      text: r.text,
      usage: r.usage,
      finishReason: r.finish_reason,
      ...(r.tool_calls?.length ? { toolCalls: r.tool_calls } : {}),
    };
  };

  const byHand: Transport = async (messages, { onDelta, title }) => {
    const text = await manual.request(title, messages);
    onDelta(text);
    return { text };
  };

  /** 写 .awb/ai-log.jsonl；默认只记元数据，开关打开时才记完整提示词和回答 */
  async function log(e: LogEntry) {
    if (!project.dir) return;
    const entry = settings.ai.logFullContent
      ? e
      : {
          ...e,
          messages: undefined,
          output: undefined,
          provider: settings.ai.providerId,
          model: settings.model(),
        };
    try {
      const dir = await platform.join(project.dir, '.awb');
      await platform.mkdir(dir);
      const file = await platform.join(dir, 'ai-log.jsonl');
      const prev = (await platform.exists(file)) ? await platform.readText(file) : '';
      await platform.writeTextAtomic(
        file,
        prev + JSON.stringify({ ...entry, mode: settings.ai.mode }) + '\n',
      );
    } catch (err) {
      console.warn('写 AI 日志失败', err);
    }
  }

  return {
    transport: settings.ai.mode === 'manual' ? byHand : api,
    log: (e: LogEntry) => void log(e),
    cancel: (requestId: string) =>
      settings.ai.mode === 'manual' ? manual.cancel() : void platform.llmCancel(requestId),
    concurrency: settings.ai.mode === 'manual' ? 1 : settings.ai.concurrency,
  };
}
