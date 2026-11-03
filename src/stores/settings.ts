import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { providerById } from '../ai/providers';
import { platform } from '../platform';

export interface AiSettings {
  /** api：通过 Rust 调用服务商；manual：复制提示词到网页版 AI，再粘贴结果 */
  mode: 'api' | 'manual';
  providerId: string;
  models: Record<string, string>;
  temperature: number;
  concurrency: number;
  /** 日志里记录完整的提示词和回答（默认只记元数据） */
  logFullContent: boolean;
  jsonMode: Record<string, boolean>;
}

const DEFAULTS: AiSettings = {
  mode: 'api',
  providerId: 'deepseek',
  models: {},
  temperature: 0.3,
  concurrency: 2,
  logFullContent: false,
  jsonMode: {},
};

/** 产品行为开关。全部默认关闭，关着的时候界面和导出走 v1。 */
export interface RuntimeSettings {
  codeScenes: boolean;
}

const RUNTIME_DEFAULTS: RuntimeSettings = {
  codeScenes: false,
};

export const useSettingsStore = defineStore('settings', () => {
  const ai = ref<AiSettings>({ ...DEFAULTS });
  const runtime = ref<RuntimeSettings>({ ...RUNTIME_DEFAULTS });
  const loaded = ref(false);

  async function load() {
    const saved = await platform.storeGet<Partial<AiSettings>>('ai');
    const savedRuntime = await platform.storeGet<Partial<RuntimeSettings>>('runtime');
    ai.value = { ...DEFAULTS, ...saved };
    runtime.value = { ...RUNTIME_DEFAULTS, ...savedRuntime };
    loaded.value = true;
  }

  watch(
    ai,
    (v) => {
      if (loaded.value) void platform.storeSet('ai', v);
    },
    { deep: true },
  );

  watch(
    runtime,
    (v) => {
      if (loaded.value) void platform.storeSet('runtime', v);
    },
    { deep: true },
  );

  const model = () => ai.value.models[ai.value.providerId] || providerById(ai.value.providerId).defaultModel;
  const jsonMode = () => ai.value.jsonMode[ai.value.providerId] ?? providerById(ai.value.providerId).jsonMode;

  return { ai, runtime, loaded, load, model, jsonMode };
});
