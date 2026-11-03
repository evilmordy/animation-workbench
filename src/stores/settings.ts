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

/** 生成引擎。legacy 走原来的大纲管线；agentic 还要同时打开 runtime.codeScenes 才生效。 */
export type GenerationEngine = 'legacy' | 'agentic';

/** 产品行为开关。全部默认关闭，关着的时候界面和导出走 v1。 */
export interface RuntimeSettings {
  codeScenes: boolean;
  /**
   * 闭环截帧工具。默认关。
   * 关着时不注册 render_frames 等工具，runAgent 仍是一次性写 code。
   * 打开也不改变 generation.engine，也不打开代码场景预览。
   */
  agentTools: boolean;
}

const RUNTIME_DEFAULTS: RuntimeSettings = {
  codeScenes: false,
  agentTools: false,
};

export const useSettingsStore = defineStore('settings', () => {
  const ai = ref<AiSettings>({ ...DEFAULTS });
  const runtime = ref<RuntimeSettings>({ ...RUNTIME_DEFAULTS });
  const engine = ref<GenerationEngine>('legacy');
  const loaded = ref(false);

  async function load() {
    const saved = await platform.storeGet<Partial<AiSettings>>('ai');
    const savedRuntime = await platform.storeGet<Partial<RuntimeSettings>>('runtime');
    const savedEngine = await platform.storeGet<unknown>('generationEngine');
    ai.value = { ...DEFAULTS, ...saved };
    runtime.value = { ...RUNTIME_DEFAULTS, ...savedRuntime };
    engine.value = savedEngine === 'agentic' ? 'agentic' : 'legacy';
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

  watch(
    engine,
    (v) => {
      if (loaded.value) void platform.storeSet('generationEngine', v);
    },
    { flush: 'sync' },
  );

  const model = () => ai.value.models[ai.value.providerId] || providerById(ai.value.providerId).defaultModel;
  const jsonMode = () => ai.value.jsonMode[ai.value.providerId] ?? providerById(ai.value.providerId).jsonMode;

  return { ai, runtime, engine, loaded, load, model, jsonMode };
});
