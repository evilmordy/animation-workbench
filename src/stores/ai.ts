import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { providerById } from '../ai/providers';
import { useSettingsStore } from './settings';

/** 本次运行的 AI 用量统计 */
export const useAiStore = defineStore('ai', () => {
  const settings = useSettingsStore();
  const usage = ref({ prompt: 0, completion: 0, requests: 0 });

  const modelLabel = computed(() =>
    settings.ai.mode === 'manual'
      ? '手动模式'
      : `${providerById(settings.ai.providerId).name} · ${settings.model()}`,
  );

  function addUsage(prompt: number, completion: number) {
    usage.value = {
      prompt: usage.value.prompt + prompt,
      completion: usage.value.completion + completion,
      requests: usage.value.requests + 1,
    };
  }

  return { usage, modelLabel, addUsage };
});
