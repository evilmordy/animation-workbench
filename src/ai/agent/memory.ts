import type { Issue } from './check';
import { contentHash } from './hash';
import { renderSourceMd, splitSource } from './source';
import type { Phase } from './tools/defs';
import type { Scene, Storyboard } from '../../shared/schema';

/** 旁路文件写在项目的 .awb/anim/ 下。分镜只走 updateStoryboard。 */
export interface AgentHost {
  getStoryboard(): Storyboard | null;
  /** 唯一写分镜的入口。产品里就是 project.update，因此可以撤销。 */
  updateStoryboard(next: Storyboard): void;
  writeFile(name: string, text: string): Promise<void>;
  readFile(name: string): Promise<string | null>;
}

export type SceneStatus = 'planned' | 'written' | 'passing' | 'failing' | 'stuck' | 'locked';

export interface SceneMemory {
  status: SceneStatus;
  hash: string;
  durationMs: number;
  attempts: number;
  writes: number;
  stagnant: number;
  extraUsed: boolean;
  gateOk: boolean;
  fingerprints: string[];
  summary: string;
  endState: string;
  lastReport: string;
  sourceParagraphs: number[];
}

export interface TurnMemory {
  turn: number;
  line: string;
  detail: string;
  images: { dataUrl: string; caption: string }[];
}

export interface Memory {
  scenes: Record<string, SceneMemory>;
  issues: Issue[];
  plan: string;
  sharedHash: string;
  currentSceneId: string | null;
  turns: TurnMemory[];
  /** 同一场连续截断后，下一轮只留当前场。 */
  shrink: boolean;
  truncations: Record<string, number>;
  pendingFilmCheck: boolean;
}

interface MemoryFile {
  scenes?: Record<string, SceneMemory>;
  issues?: Issue[];
  plan?: string;
  sharedHash?: string;
}

export function blankMemory(): Memory {
  return {
    scenes: {},
    issues: [],
    plan: '',
    sharedHash: contentHash(''),
    currentSceneId: null,
    turns: [],
    shrink: false,
    truncations: {},
    pendingFilmCheck: false,
  };
}

function emptyScene(scene: Scene, hash: string): SceneMemory {
  const hasCode = Boolean(scene.code?.trim());
  return {
    status: scene.locked ? 'locked' : hasCode ? 'written' : 'planned',
    hash,
    durationMs: 0,
    attempts: 0,
    writes: 0,
    stagnant: 0,
    extraUsed: false,
    gateOk: false,
    fingerprints: [],
    summary: '',
    endState: '',
    lastReport: '',
    sourceParagraphs: [],
  };
}

/** 分镜哈希和记忆不一致时，以分镜为准，并标出手改。 */
export function syncStoryboard(mem: Memory, sb: Storyboard): void {
  const seen = new Set<string>();
  for (const scene of sb.scenes) {
    seen.add(scene.id);
    const hash = contentHash(scene.code ?? '');
    const prev = mem.scenes[scene.id];
    if (!prev) {
      mem.scenes[scene.id] = emptyScene(scene, hash);
      continue;
    }
    if (scene.locked) prev.status = 'locked';
    if (prev.hash !== hash) {
      prev.hash = hash;
      prev.gateOk = false;
      prev.stagnant = 0;
      prev.fingerprints = [];
      if (!scene.locked) {
        prev.status = scene.code?.trim() ? 'written' : 'planned';
        prev.summary = '用户已改，以此为准';
      }
    }
  }
  for (const id of Object.keys(mem.scenes)) {
    if (!seen.has(id)) delete mem.scenes[id];
  }
}

export function focusScene(mem: Memory, sb: Storyboard, editId?: string): void {
  if (editId) {
    mem.currentSceneId = editId;
    return;
  }
  const current = mem.currentSceneId ? sb.scenes.find((scene) => scene.id === mem.currentSceneId) : undefined;
  const currentState = current ? mem.scenes[current.id] : undefined;
  const usable =
    current &&
    !current.locked &&
    currentState &&
    currentState.status !== 'passing' &&
    currentState.status !== 'stuck' &&
    currentState.status !== 'locked';
  if (usable) return;
  const next = sb.scenes.find((scene) => {
    const state = mem.scenes[scene.id];
    return (
      state &&
      !scene.locked &&
      state.status !== 'passing' &&
      state.status !== 'stuck' &&
      state.status !== 'locked'
    );
  });
  mem.currentSceneId = next?.id ?? sb.scenes.find((scene) => !scene.locked)?.id ?? null;
}

export function nextPhase(phase: Phase, sb: Storyboard, mem: Memory): Phase {
  if (phase === 'EDIT' || phase === 'FILM') return phase;
  if (phase === 'PLAN') return mem.plan.trim() ? 'SCENE' : 'PLAN';
  const unlocked = sb.scenes.filter((scene) => !scene.locked);
  if (unlocked.some((scene) => !mem.scenes[scene.id]?.gateOk)) return 'SCENE';
  const retry = unlocked.find((scene) => {
    const state = mem.scenes[scene.id];
    return state?.status === 'stuck' && !state.extraUsed;
  });
  if (retry) {
    const state = mem.scenes[retry.id];
    if (state) {
      state.extraUsed = true;
      state.status = 'failing';
      state.stagnant = 0;
    }
    mem.currentSceneId = retry.id;
    mem.turns.push({
      turn: mem.turns.length + 1,
      line: `${retry.id} 停滞后再给一次机会`,
      detail: `${retry.id} 已标 stuck，进整片前再改一次。`,
      images: [],
    });
    return 'SCENE';
  }
  return 'FILM';
}

export interface IssueDelta {
  issues: Issue[];
  fixed: string[];
  added: string[];
  stalled: boolean;
}

const OPEN = new Set(['open', 'stuck']);

/** 把一轮体检并进问题表。同一 fingerprint 还在就累加，消失的机器问题标 fixed。 */
export function applyInspection(
  mem: Memory,
  sceneIds: string[],
  incoming: Issue[],
  turn: number,
): IssueDelta {
  const touched = new Set(sceneIds);
  const before = new Set(mem.issues.filter((issue) => OPEN.has(issue.status)).map((issue) => issue.id));
  const incomingFp = new Set(incoming.map((issue) => issue.fingerprint));
  for (const issue of mem.issues) {
    if (!touched.has(issue.scene_id)) continue;
    if (issue.kind === 'CONTENT' || issue.kind === 'USER' || issue.status === 'waived') continue;
    if (OPEN.has(issue.status) && !incomingFp.has(issue.fingerprint)) {
      issue.status = 'fixed';
      issue.last_turn = turn;
    }
  }
  for (const issue of incoming) {
    const prev = mem.issues.find((item) => item.fingerprint === issue.fingerprint);
    if (prev) {
      if (prev.status === 'waived') continue;
      prev.status = 'open';
      prev.last_turn = turn;
      prev.attempts += 1;
      prev.evidence = issue.evidence;
      prev.severity = issue.severity;
      continue;
    }
    const id = mem.issues.some((item) => item.id === issue.id) ? freshIssueId(mem) : issue.id;
    mem.issues.push({ ...issue, id, first_turn: turn, last_turn: turn, attempts: 1, status: 'open' });
  }
  let stalled = false;
  for (const sceneId of sceneIds) {
    const state = mem.scenes[sceneId];
    if (!state) continue;
    const prints = mem.issues
      .filter((issue) => issue.scene_id === sceneId && OPEN.has(issue.status))
      .map((issue) => issue.fingerprint);
    const prev = new Set(state.fingerprints);
    const removed = [...prev].filter((fp) => !prints.includes(fp)).length;
    if (prev.size === 0) state.stagnant = prints.length ? 1 : 0;
    else if (removed === 0) state.stagnant += 1;
    else state.stagnant = 0;
    state.fingerprints = prints;
    if (state.stagnant >= 3 && prints.length > 0) {
      state.status = 'stuck';
      stalled = true;
      for (const issue of mem.issues) {
        if (issue.scene_id === sceneId && issue.status === 'open') issue.status = 'stuck';
      }
    } else if (state.status !== 'locked') {
      const open = mem.issues.filter((issue) => issue.scene_id === sceneId && OPEN.has(issue.status));
      state.status = open.some((issue) => issue.severity === 'blocker' || issue.severity === 'major')
        ? 'failing'
        : state.gateOk
          ? 'passing'
          : state.status;
    }
  }
  const after = new Set(mem.issues.filter((issue) => OPEN.has(issue.status)).map((issue) => issue.id));
  return {
    issues: mem.issues.filter((issue) => touched.has(issue.scene_id) && OPEN.has(issue.status)),
    fixed: [...before].filter((id) => !after.has(id)),
    added: [...after].filter((id) => !before.has(id)),
    stalled,
  };
}

function freshIssueId(mem: Memory): string {
  let n = mem.issues.length + 1;
  while (mem.issues.some((issue) => issue.id === `M${n}`)) n += 1;
  return `M${n}`;
}

export async function openMemory(host: AgentHost, source: string, sb: Storyboard): Promise<Memory> {
  await host.writeFile('source.md', renderSourceMd(splitSource(source)));
  const mem = blankMemory();
  try {
    const raw = await host.readFile('memory.json');
    if (raw) {
      const saved = JSON.parse(raw) as MemoryFile;
      if (saved.scenes && typeof saved.scenes === 'object') mem.scenes = saved.scenes;
      if (Array.isArray(saved.issues)) mem.issues = saved.issues;
      if (typeof saved.plan === 'string') mem.plan = saved.plan;
      if (typeof saved.sharedHash === 'string') mem.sharedHash = saved.sharedHash;
    }
  } catch {
    // 坏掉的记忆文件不影响这次生成，从分镜重新记。
  }
  const shared = await host.readFile('shared.js');
  if (shared != null) mem.sharedHash = contentHash(shared);
  syncStoryboard(mem, sb);
  await saveMemory(host, mem);
  return mem;
}

export async function saveMemory(host: AgentHost, mem: Memory): Promise<void> {
  const file: MemoryFile = {
    scenes: mem.scenes,
    issues: mem.issues,
    plan: mem.plan,
    sharedHash: mem.sharedHash,
  };
  await host.writeFile('memory.json', JSON.stringify(file));
}

export async function appendLog(host: AgentHost, entry: unknown): Promise<void> {
  const prev = (await host.readFile('log.jsonl')) ?? '';
  await host.writeFile('log.jsonl', `${prev}${JSON.stringify(entry)}\n`);
}

/** 工具结果里的代码不进历史。代码以分镜为准，下一轮重读。 */
export function redactCode(text: string): string {
  return text
    .replace(
      /"(code|replacement|plan_md|shared_js|code_numbered)"\s*:\s*"((?:\\.|[^"\\])*)"/g,
      (match, key: string, value: string) => {
        // error.code 是短错误码，必须留在下一轮观察里。真正的代码带换行或更长。
        if (value.length < 80 && !value.includes('\\n')) return match;
        return `"${key}":"[${value.length} chars]"`;
      },
    )
    .replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, '[图片]');
}
