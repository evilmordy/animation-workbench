import { defineStore } from 'pinia';
import { shallowRef } from 'vue';
import type { ChatMessage } from '../platform/types';

export interface ManualRequest {
  title: string;
  prompt: string;
  resolve: (text: string) => void;
  reject: (e: unknown) => void;
}

/** 手动模式：把提示词交给用户复制到网页版 AI，再等用户把回答粘贴回来 */
export function formatPrompt(messages: ChatMessage[]): string {
  const head = { system: '【说明】', user: '【请求】', assistant: '【你之前的回答】' } as const;
  return messages.map((m) => `${head[m.role]}\n${m.content}`).join('\n\n');
}

export const useManualStore = defineStore('manual', () => {
  const pending = shallowRef<ManualRequest | null>(null);
  const queue: ManualRequest[] = [];

  function next() {
    pending.value = queue.shift() ?? null;
  }

  function request(title: string, messages: ChatMessage[]): Promise<string> {
    return new Promise((resolve, reject) => {
      queue.push({ title, prompt: formatPrompt(messages), resolve, reject });
      if (!pending.value) next();
    });
  }

  function submit(text: string) {
    pending.value?.resolve(text);
    next();
  }

  function cancel() {
    pending.value?.reject({ code: 'cancelled', message: '已取消' });
    for (const r of queue.splice(0)) r.reject({ code: 'cancelled', message: '已取消' });
    pending.value = null;
  }

  return { pending, request, submit, cancel };
});
