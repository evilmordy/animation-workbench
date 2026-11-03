import type { GenerationEngine } from '../../stores/settings';

/** agentic 必须同时打开 runtime.codeScenes。否则一律走旧生成。 */
export function usesAgenticEngine(engine: GenerationEngine, codeScenes: boolean): boolean {
  return engine === 'agentic' && codeScenes === true;
}

/** AiPanel 的唯一分叉。legacy、或 agentic 但没开代码场景时，调用原来的大纲生成。 */
export async function dispatchGenerate(opts: {
  engine: GenerationEngine;
  codeScenes: boolean;
  legacy: () => Promise<void>;
  agent: () => Promise<void>;
}): Promise<void> {
  if (usesAgenticEngine(opts.engine, opts.codeScenes)) await opts.agent();
  else await opts.legacy();
}
