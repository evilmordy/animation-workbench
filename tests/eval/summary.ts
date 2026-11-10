import type { Transport } from '../../src/ai/client';
import { parseRubric } from '../../src/ai/agent/apply';
import { runScene } from '../../src/ai/agent/check/gate';
import type { Issue } from '../../src/ai/agent/check/index';
import { runAgent, type AgentHost } from '../../src/ai/agent/loop';
import { emptyStoryboard } from '../../src/shared/project';
import type { Storyboard } from '../../src/shared/schema';
import { EVAL_MAX_TOKENS, EVAL_MODEL, EVAL_TEMPERATURE, type Topic, type TopicId } from './topics';

/** 官方 PASS。数学抽查不在这里。黑屏比缺失不算过。 */
export function officialPass(row: {
  gate: boolean;
  layout: boolean;
  residual: boolean;
  seek: boolean;
  backward: boolean;
  shuffle: boolean;
  export: boolean;
  console: boolean;
  blackRatio: number | null;
}): boolean {
  return (
    row.gate &&
    row.layout &&
    row.residual &&
    row.seek &&
    row.backward &&
    row.shuffle &&
    row.export &&
    row.console &&
    row.blackRatio != null &&
    row.blackRatio <= 0.1
  );
}

export interface ScreenFacts {
  issues: Issue[];
  blackRatio: number;
  exportOk: boolean;
  layoutTruncated: boolean;
}

export interface ScreenFlags {
  layout: boolean;
  residual: boolean;
  seek: boolean;
  backward: boolean;
  shuffle: boolean;
  export: boolean;
  console: boolean;
  blackRatio: number | null;
  layoutTruncated: boolean;
}

/** 把 checkScenes 的问题译成 S8d 表格里的各列。单帧「几乎是空的」不单独否决。 */
export function flagsFromScreen(facts: ScreenFacts): ScreenFlags {
  const seekLabel = (label: string) =>
    facts.issues.some((issue) => issue.kind === 'SEEK_BACKWARD' && issue.fingerprint.split('|')[2] === label);
  return {
    layout: !facts.issues.some((issue) => issue.kind.startsWith('LAYOUT_')),
    residual: !facts.issues.some((issue) => issue.kind === 'RESIDUAL'),
    seek: !facts.issues.some((issue) => issue.kind === 'SEEK_SAME_MS'),
    backward: !seekLabel('backward'),
    shuffle: !seekLabel('shuffled'),
    export: facts.exportOk,
    console: !facts.issues.some((issue) => issue.kind === 'CONSOLE'),
    blackRatio: facts.blackRatio,
    layoutTruncated: facts.layoutTruncated,
  };
}

const FAILED_SCREEN: ScreenFlags = {
  layout: false,
  residual: false,
  seek: false,
  backward: false,
  shuffle: false,
  export: false,
  console: false,
  blackRatio: null,
  layoutTruncated: false,
};

/** 导出 HTML：运行时内联、没有外链脚本、代码场标记打开。 */
export function exportPasses(html: string, runtimeSource: string): boolean {
  const runtime = runtimeSource.replace(/<\/script/gi, '<\\/script');
  if (!runtime || !html.includes(runtime)) return false;
  if (!html.includes('data-code-scenes="1"')) return false;
  return !/<script\b[^>]*\bsrc\s*=\s*["']https?:/i.test(html);
}

export function mathNote(id: TopicId, text: string): string {
  if (id === 'zugeng') {
    const hemi = hasVolume(text, '2/3');
    const ball = hasVolume(text, '4/3');
    return `抽查：${hemi ? '见' : '缺'} (2/3)πR³；${ball ? '见' : '缺'} (4/3)πR³。不计入 PASS。`;
  }
  if (id === 'linalg') {
    const matrix = text.includes('矩阵');
    const det = /行列式|\bdet\b/i.test(text);
    return `抽查：${matrix ? '见' : '缺'}矩阵；${det ? '见' : '缺'}行列式。只记出现，不计入 PASS。`;
  }
  if (id === 'mergesort') {
    const ok = /O\s*\(\s*n\s*log\s*n\s*\)/i.test(text);
    return `抽查：${ok ? '见' : '缺'} O(n log n)。不计入 PASS。`;
  }
  if (id === 'transform') {
    const ok = /P\s*\(\s*t\s*\)/.test(text) && /1\s*-\s*t/.test(text);
    return `抽查：${ok ? '见' : '缺'} P(t)=(1-t)·A+t·B。不计入 PASS。`;
  }
  const ok = text.includes('蔡格尼克') || text.includes('未完成');
  return `抽查：${ok ? '见' : '缺'}蔡格尼克或未完成。不计入 PASS。`;
}

function hasVolume(text: string, frac: '2/3' | '4/3'): boolean {
  const fracOk = text.includes(frac) || (frac === '2/3' && text.includes('⅔'));
  const pi = /π|\\pi|\bpi\b/i.test(text);
  const cube = /R³|R\^3|R\*\*3/.test(text);
  return fracOk && pi && cube;
}

export interface EvalRow {
  id: TopicId;
  intent: string;
  model: string;
  temperature: number;
  maxTokens: number;
  status: string;
  scenes: number;
  turns: number;
  tokens: number;
  elapsedMs: number;
  writes: number;
  stuck: string[];
  gate: boolean;
  gateErrors: string[];
  layout: boolean;
  residual: boolean;
  seek: boolean;
  backward: boolean;
  shuffle: boolean;
  export: boolean;
  console: boolean;
  blackRatio: number | null;
  layoutTruncated: boolean;
  waived: string[];
  math: string;
  pass: boolean;
  screen: 'ran' | 'skipped' | 'failed';
  screenError?: string;
  issues: string[];
}

export async function gateStoryboard(sb: Storyboard): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  let other = 0;
  for (const scene of sb.scenes) {
    if (scene.kind !== 'code' || !scene.code?.trim()) {
      errors.push(`${scene.id}: 没有代码`);
      continue;
    }
    const result = await runScene(scene.code, {
      hold: scene.hold,
      otherDurationMs: other,
      sceneId: scene.id,
      title: scene.title,
      enter: scene.enter,
    });
    if (!result.ok) errors.push(`${scene.id}: ${result.error.code} ${result.error.message}`);
    else other += result.durationMs;
  }
  if (other > 600_000) errors.push('整片超过 600 秒');
  return { ok: errors.length === 0 && sb.scenes.length > 0, errors };
}

function corpus(files: ReadonlyMap<string, string>, sb: Storyboard): string {
  return [...files.values(), ...sb.scenes.map((scene) => scene.code ?? '')].join('\n');
}

/**
 * 用当前产品的 runAgent 写一场片子，再跑运行门。
 * screen 缺省时不截帧，画面各列记为未过，避免没采到像素还报 PASS。
 */
export async function evaluateTopic(opts: {
  topic: Topic;
  transport: Transport;
  screen?: (sb: Storyboard) => Promise<ScreenFacts>;
  maxTurns?: number;
}): Promise<EvalRow> {
  const files = new Map<string, string>();
  let sb: Storyboard = emptyStoryboard(opts.topic.id);
  let writes = 0;
  const host: AgentHost = {
    getStoryboard: () => sb,
    updateStoryboard(next) {
      sb = next;
    },
    async writeFile(name, text) {
      if (name.startsWith('scenes/')) writes += 1;
      files.set(name, text);
    },
    async readFile(name) {
      return files.get(name) ?? null;
    },
  };
  const started = Date.now();
  const result = await runAgent({
    intent: opts.topic.intent,
    transport: opts.transport,
    host,
    renderer: 'anime',
    budget: { maxTurns: opts.maxTurns ?? 24, completionTokens: EVAL_MAX_TOKENS },
  });
  const elapsedMs = Date.now() - started;
  const planned = parseRubric(files.get('rubric.json') ?? '');
  const written = new Set(result.sceneIds);
  const stuck =
    result.status === 'done'
      ? []
      : (planned?.scenes.map((scene) => scene.id).filter((id) => !written.has(id)) ?? []);
  const gate = await gateStoryboard(sb);
  let flags = FAILED_SCREEN;
  let screen: EvalRow['screen'] = 'skipped';
  let screenError: string | undefined;
  let issues: string[] = [];
  const hasCode = sb.scenes.some((scene) => scene.kind === 'code' && scene.code?.trim());
  if (opts.screen && hasCode) {
    try {
      const facts = await opts.screen(sb);
      flags = flagsFromScreen(facts);
      issues = facts.issues.map((issue) => issue.fingerprint);
      screen = 'ran';
    } catch (error) {
      screen = 'failed';
      screenError = error instanceof Error ? error.message : String(error);
    }
  } else if (opts.screen) {
    screen = 'failed';
    screenError = '没有可体检的代码场';
  }
  const scored = {
    gate: gate.ok,
    layout: flags.layout,
    residual: flags.residual,
    seek: flags.seek,
    backward: flags.backward,
    shuffle: flags.shuffle,
    export: flags.export,
    console: flags.console,
    blackRatio: flags.blackRatio,
  };
  return {
    id: opts.topic.id,
    intent: opts.topic.intent,
    model: EVAL_MODEL,
    temperature: EVAL_TEMPERATURE,
    maxTokens: EVAL_MAX_TOKENS,
    status: result.status,
    scenes: sb.scenes.length,
    turns: result.turns,
    tokens: result.usage[0] + result.usage[1],
    elapsedMs,
    writes,
    stuck,
    gateErrors: gate.errors,
    ...scored,
    layoutTruncated: flags.layoutTruncated,
    waived: [],
    math: mathNote(opts.topic.id, corpus(files, sb)),
    pass: officialPass(scored),
    screen,
    ...(screenError ? { screenError } : {}),
    issues,
  };
}

/** DeepSeek 请求体。不含密钥，也不打开 json_object。 */
export function deepseekRequestBody(messages: { role: string; content: string }[]): {
  model: string;
  messages: { role: string; content: string }[];
  temperature: number;
  max_tokens: number;
} {
  return {
    model: EVAL_MODEL,
    messages,
    temperature: EVAL_TEMPERATURE,
    max_tokens: EVAL_MAX_TOKENS,
  };
}
