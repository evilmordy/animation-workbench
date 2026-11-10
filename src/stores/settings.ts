import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import {
  DEFAULT_AGENT_BUDGET_SETTINGS,
  normalizeAgentBudget,
  type AgentBudgetSettings,
} from '../ai/agent/log';
import type { CodeRenderer } from '../ai/agent/renderer';
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
  /** Agent 写新代码场时的默认。不改 legacy 引擎，也不改已经选过渲染的分镜。 */
  codeRenderer: CodeRenderer;
}

const RUNTIME_DEFAULTS: RuntimeSettings = {
  codeScenes: false,
  agentTools: false,
  codeRenderer: 'anime',
};

function normalizeRuntime(saved: Partial<RuntimeSettings> | null | undefined): RuntimeSettings {
  return {
    ...RUNTIME_DEFAULTS,
    ...saved,
    codeRenderer: saved?.codeRenderer === 'manim' ? 'manim' : 'anime',
  };
}

export const useSettingsStore = defineStore('settings', () => {
  const ai = ref<AiSettings>({ ...DEFAULTS });
  const runtime = ref<RuntimeSettings>({ ...RUNTIME_DEFAULTS });
  /** 默认 legacy。改默认引擎要单独 PR，并且要用户同意。这个 PR 不改。 */
  const engine = ref<GenerationEngine>('legacy');
  const agentBudget = ref<AgentBudgetSettings>({ ...DEFAULT_AGENT_BUDGET_SETTINGS });
  const loaded = ref(false);

  async function load() {
    const saved = await platform.storeGet<Partial<AiSettings>>('ai');
    const savedRuntime = await platform.storeGet<Partial<RuntimeSettings>>('runtime');
    const savedEngine = await platform.storeGet<unknown>('generationEngine');
    const savedBudget = await platform.storeGet<unknown>('agentBudget');
    ai.value = { ...DEFAULTS, ...saved };
    runtime.value = normalizeRuntime(savedRuntime);
    engine.value = savedEngine === 'agentic' ? 'agentic' : 'legacy';
    agentBudget.value = normalizeAgentBudget(savedBudget);
    loaded.value = true;
  }

  function setAgentBudget(patch: Partial<AgentBudgetSettings>) {
    agentBudget.value = normalizeAgentBudget({ ...agentBudget.value, ...patch });
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

  watch(
    agentBudget,
    (v) => {
      if (loaded.value) void platform.storeSet('agentBudget', v);
    },
    { deep: true },
  );

  const model = () => ai.value.models[ai.value.providerId] || providerById(ai.value.providerId).defaultModel;
  const jsonMode = () => ai.value.jsonMode[ai.value.providerId] ?? providerById(ai.value.providerId).jsonMode;

  return { ai, runtime, engine, agentBudget, loaded, load, setAgentBudget, model, jsonMode };
});
