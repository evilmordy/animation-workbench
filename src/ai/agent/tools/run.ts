import type { Issue } from '../check';
import { checkScenes } from '../check';
import { runScene, sceneTrace, type GateError } from '../check/gate';
import { pngDataUrl, type Raster } from '../check/pixels';
import type { EditRequest } from '../precise';
import { durationNote, indexCalls, outsideNote } from '../precise';
import { acceptStoryboard, clampHold } from '../apply';
import { contentHash } from '../hash';
import { applyInspection, saveMemory, type AgentHost, type IssueDelta, type Memory } from '../memory';
import { previewParagraph, splitSource } from '../source';
import type { Scene, Storyboard } from '../../../shared/schema';
import { applyRange, formatNumbered, joinShared, replaceShared, splitShared } from './code';
import { isToolName, PHASE_TOOLS, type Phase } from './defs';

export const SCENE_WRITE_LIMIT = 8;

const ID_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const UNWAIVABLE = new Set(['COMPILE', 'RUNTIME', 'DURATION', 'SEEK_BACKWARD', 'SEEK_SAME_MS']);

export interface ObservedFrame {
  tMs: number;
  caption: string;
  png?: Uint8Array;
  raster?: Raster;
  boxes: number;
}

export interface InspectRequest {
  sceneIds?: string[];
  film?: boolean;
  frames?: { sceneId: string; timesMs: number[]; isolated: boolean }[];
}

export interface InspectReport {
  issues: Issue[];
  frames: ObservedFrame[];
  note?: string;
}

export type Inspect = (sb: Storyboard, req: InspectRequest) => Promise<InspectReport>;

export interface ToolEnv {
  phase: Phase;
  turn: number;
  host: AgentHost;
  mem: Memory;
  source: string;
  editSceneId?: string;
  editRequest?: EditRequest;
  /** 写入前拍的帧，顺序是区间帧然后区间外帧。 */
  beforeFrames?: ObservedFrame[];
  editTimes?: number[];
  outsideTimes?: number[];
  /** 写入前量到的本场时长。记忆里还没有时用它比较。 */
  editDurationMs?: number;
  inspect: Inspect;
}

export interface ToolOutcome {
  content: string;
  images?: { dataUrl: string; caption: string }[];
  wrote?: boolean;
  terminal?: 'done' | 'done_with_issues';
}

export async function localInspect(sb: Storyboard, req: InspectRequest): Promise<InspectReport> {
  const ids = req.sceneIds?.length ? req.sceneIds : sb.scenes.map((scene) => scene.id);
  return {
    issues: checkScenes(ids.map((id) => ({ id, width: 960, height: 540 }))),
    frames: [],
    note: '没有像素帧',
  };
}

export function toolFail(
  code: string,
  message: string,
  hint: string,
  extra?: Record<string, unknown>,
): string {
  return JSON.stringify({ ok: false, error: { code, message, hint, ...extra } });
}

export function toolOk(data: Record<string, unknown>): string {
  return JSON.stringify({ ok: true, ...data });
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseArgs(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false } {
  try {
    const value = JSON.parse(raw || '{}') as unknown;
    const obj = asObject(value);
    if (!obj) return { ok: false };
    return { ok: true, value: obj };
  } catch {
    return { ok: false };
  }
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length > max) return null;
  return value;
}

function fail(content: string): ToolOutcome {
  return { content };
}

function gateFail(error: GateError): string {
  return toolFail(error.code, error.message, error.hint, {
    ...(error.line != null ? { line: error.line } : {}),
    ...(error.snippet ? { snippet: error.snippet } : {}),
    ...(error.matches ? { matches: error.matches } : {}),
  });
}

function imagesOf(frames: ObservedFrame[]): { dataUrl: string; caption: string }[] {
  const images: { dataUrl: string; caption: string }[] = [];
  for (const frame of frames) {
    if (!frame.png?.byteLength) continue;
    images.push({ dataUrl: pngDataUrl(frame.png), caption: frame.caption });
    if (images.length >= 8) break;
  }
  return images;
}

function defaultTimes(durationMs: number): number[] {
  const dur = Math.max(1, Math.round(durationMs));
  return [Math.round(dur * 0.25), Math.round(dur * 0.6), Math.max(0, dur - 1)];
}

function outOfScope(env: ToolEnv, sceneId: string): boolean {
  return Boolean(env.editSceneId && sceneId !== env.editSceneId);
}

function findScene(sb: Storyboard, sceneId: string): Scene | undefined {
  return sb.scenes.find((scene) => scene.id === sceneId);
}

export async function executeTool(name: string, raw: string, env: ToolEnv): Promise<ToolOutcome> {
  if (!isToolName(name)) return fail(toolFail('INVALID_ARGS', `没有工具 ${name}`, '用本阶段列出的工具'));
  if (!PHASE_TOOLS[env.phase].includes(name)) {
    return fail(toolFail('PHASE', `阶段 ${env.phase} 不能调用 ${name}`, '按观察里的阶段说明'));
  }
  const parsed = parseArgs(raw);
  if (!parsed.ok) return fail(toolFail('INVALID_ARGS', '参数不是 JSON 对象', '按 schema 重发'));
  const args = parsed.value;
  switch (name) {
    case 'read_storyboard':
      return readStoryboard(env);
    case 'read_source':
      return readSource(env, args);
    case 'write_plan':
      return writePlan(env, args);
    case 'read_scene':
      return readScene(env, args);
    case 'write_scene':
      return writeScene(env, args);
    case 'edit_range':
      return editRange(env, args);
    case 'write_shared':
      return writeShared(env, args);
    case 'capture_frames':
      return captureFrames(env, args);
    case 'check':
      return check(env, args);
    case 'update_issues':
      return updateIssues(env, args);
    case 'finish':
      return finishTool(env, args);
    default:
      return fail(toolFail('INVALID_ARGS', `没有工具 ${name}`, '用本阶段列出的工具'));
  }
}

function readStoryboard(env: ToolEnv): ToolOutcome {
  const sb = env.host.getStoryboard();
  if (!sb) return fail(toolFail('NOT_FOUND', '没有打开的分镜', '先打开项目'));
  return {
    content: toolOk({
      title: sb.meta.title,
      shared_hash: env.mem.sharedHash,
      scenes: sb.scenes.map((scene) => {
        const state = env.mem.scenes[scene.id];
        return {
          id: scene.id,
          title: scene.title,
          description: scene.description,
          hold: scene.hold,
          enter: scene.enter,
          locked: Boolean(scene.locked),
          status: state?.status ?? 'planned',
          duration_ms: state?.durationMs ?? 0,
          hash: state?.hash ?? contentHash(scene.code ?? ''),
          summary: state?.summary ?? '',
        };
      }),
    }),
  };
}

function readSource(env: ToolEnv, args: Record<string, unknown>): ToolOutcome {
  const paragraphs = splitSource(env.source);
  const asked = args.paragraphs;
  if (asked === undefined) {
    return {
      content: toolOk({
        total: paragraphs.length,
        paragraphs: paragraphs.map((paragraph) => ({
          n: paragraph.n,
          text: previewParagraph(paragraph.text),
        })),
      }),
    };
  }
  if (
    !Array.isArray(asked) ||
    asked.length > 20 ||
    asked.some((item) => !Number.isInteger(item) || Number(item) < 1)
  ) {
    return fail(toolFail('INVALID_ARGS', 'paragraphs 必须是最多 20 个从 1 开始的整数', '按 schema 重发'));
  }
  const picked = [];
  for (const n of asked) {
    const paragraph = paragraphs.find((item) => item.n === n);
    if (!paragraph) return fail(toolFail('NOT_FOUND', `没有第 ${n} 段`, 'read_source 不带参数先看目录'));
    picked.push({ n: paragraph.n, text: paragraph.text });
  }
  return { content: toolOk({ total: paragraphs.length, paragraphs: picked }) };
}

async function writePlan(env: ToolEnv, args: Record<string, unknown>): Promise<ToolOutcome> {
  const sb = env.host.getStoryboard();
  if (!sb) return fail(toolFail('NOT_FOUND', '没有打开的分镜', '先打开项目'));
  const title = text(args.title, 80);
  const planMd = text(args.plan_md, 8000);
  if (!title?.trim() || !planMd?.trim() || !Array.isArray(args.scenes)) {
    return fail(toolFail('INVALID_ARGS', 'write_plan 需要 title、plan_md 和 scenes', '按 schema 重发'));
  }
  if (args.scenes.length < 1 || args.scenes.length > 20) {
    return fail(toolFail('INVALID_ARGS', 'scenes 需要 1 到 20 场', '按 schema 重发'));
  }
  const planned: {
    id: string;
    title: string;
    description: string;
    hold: number;
    enter: 'fresh' | 'keep';
    sourceParagraphs: number[];
  }[] = [];
  const seen = new Set<string>();
  for (const item of args.scenes) {
    const rec = asObject(item);
    if (!rec) return fail(toolFail('INVALID_ARGS', 'scenes 里有不是对象的项', '按 schema 重发'));
    const id = typeof rec.id === 'string' ? rec.id : '';
    const sceneTitle = text(rec.title, 80);
    const description = text(rec.description, 400);
    const hold = typeof rec.hold === 'number' ? rec.hold : Number.NaN;
    if (
      !ID_RE.test(id) ||
      seen.has(id) ||
      !sceneTitle?.trim() ||
      description === null ||
      !Number.isFinite(hold)
    ) {
      return fail(toolFail('INVALID_ARGS', `场 ${id || '？'} 的参数不合法`, '按 schema 重发'));
    }
    const enter = rec.enter === 'keep' ? 'keep' : rec.enter === 'fresh' ? 'fresh' : null;
    if (!enter) {
      return fail(toolFail('INVALID_ARGS', `场 ${id} 的 enter 只能是 fresh 或 keep`, '按 schema 重发'));
    }
    seen.add(id);
    const sourceParagraphs = Array.isArray(rec.source_paragraphs)
      ? rec.source_paragraphs.filter((n): n is number => Number.isInteger(n) && n >= 1)
      : [];
    planned.push({
      id,
      title: sceneTitle.trim(),
      description,
      hold: clampHold(hold),
      enter,
      sourceParagraphs,
    });
  }

  let shared: string | undefined;
  if ('shared_js' in args) {
    const code = text(args.shared_js, 4000);
    if (code === null)
      return fail(toolFail('INVALID_ARGS', 'shared_js 不是字符串或超过 4000 字', '缩短共享常量'));
    const probe = code.trim() ? `${code.trim()}\nwait(200);\n` : 'wait(200);\n';
    const gated = await runScene(probe);
    if (!gated.ok) return fail(gateFail(gated.error));
    shared = code.trim();
  }

  const prevById = new Map(sb.scenes.map((scene) => [scene.id, scene]));
  const nextScenes: Scene[] = [];
  const created: string[] = [];
  const kept: string[] = [];
  for (const plan of planned) {
    const existing = prevById.get(plan.id);
    if (existing?.locked) {
      nextScenes.push({ ...existing });
      kept.push(existing.id);
      continue;
    }
    if (existing) {
      nextScenes.push({ ...existing, title: plan.title, description: plan.description });
    } else {
      created.push(plan.id);
      nextScenes.push({
        id: plan.id,
        title: plan.title,
        description: plan.description,
        kind: 'code',
        enter: plan.enter,
        hold: plan.hold,
        elements: [],
        steps: [],
        code: '',
      });
    }
  }
  for (const scene of sb.scenes) {
    if (scene.locked && !seen.has(scene.id)) {
      nextScenes.push({ ...scene });
      if (!kept.includes(scene.id)) kept.push(scene.id);
    }
  }
  const removed = sb.scenes.filter((scene) => !scene.locked && !seen.has(scene.id)).map((scene) => scene.id);

  const spliced = new Map<string, number>();
  if (shared !== undefined) {
    const broken: { scene_id: string; error: string }[] = [];
    for (const scene of nextScenes) {
      if (scene.locked || !scene.code?.trim()) continue;
      const code = replaceShared(scene.code, shared);
      const gated = await runScene(code, {
        hold: scene.hold,
        sceneId: scene.id,
        title: scene.title,
        enter: scene.enter,
      });
      if (!gated.ok) broken.push({ scene_id: scene.id, error: gated.error.message });
      else {
        scene.code = code;
        spliced.set(scene.id, gated.durationMs);
      }
    }
    if (broken.length) {
      return fail(
        JSON.stringify({
          ok: false,
          error: { code: 'COMPILE_ERROR', message: '共享常量让有的场过不了运行门', hint: '修正 shared_js' },
          broken,
          kept_locked: kept,
        }),
      );
    }
  }

  const titleChanged = sb.scenes.length === 0 && title.trim() ? title.trim() : sb.meta.title;
  const accepted = acceptStoryboard({ ...sb, meta: { ...sb.meta, title: titleChanged }, scenes: nextScenes });
  if (!accepted) return fail(toolFail('INVALID_ARGS', '计划写回的分镜过不了 schema', '检查场 id 和 hold'));
  env.host.updateStoryboard(accepted);
  await env.host.writeFile('plan.md', planMd);
  await env.host.writeFile(
    'rubric.json',
    JSON.stringify({
      title: title.trim(),
      scenes: accepted.scenes.map((scene) => ({
        id: scene.id,
        title: scene.title,
        description: scene.description,
        hold: scene.hold,
        enter: scene.enter,
      })),
    }),
  );
  if (shared !== undefined) {
    await env.host.writeFile('shared.js', shared);
    env.mem.sharedHash = contentHash(shared);
  }
  env.mem.plan = planMd;
  for (const scene of accepted.scenes) {
    const plan = planned.find((item) => item.id === scene.id);
    const prev = env.mem.scenes[scene.id];
    const hash = contentHash(scene.code ?? '');
    const duration = spliced.get(scene.id);
    env.mem.scenes[scene.id] = {
      status: scene.locked ? 'locked' : scene.code?.trim() ? (prev?.status ?? 'written') : 'planned',
      hash,
      durationMs: duration ?? prev?.durationMs ?? 0,
      attempts: prev?.attempts ?? 0,
      writes: prev?.writes ?? 0,
      stagnant: duration == null ? (prev?.stagnant ?? 0) : 0,
      extraUsed: prev?.extraUsed ?? false,
      gateOk: duration == null ? (prev?.gateOk ?? false) : true,
      fingerprints: duration == null ? (prev?.fingerprints ?? []) : [],
      summary: prev?.summary ?? '',
      endState: prev?.endState ?? '',
      lastReport: prev?.lastReport ?? '',
      sourceParagraphs: plan?.sourceParagraphs ?? prev?.sourceParagraphs ?? [],
    };
    if (scene.locked) env.mem.scenes[scene.id]!.status = 'locked';
  }
  for (const id of removed) delete env.mem.scenes[id];
  env.mem.currentSceneId = accepted.scenes.find((scene) => !scene.locked)?.id ?? null;
  await saveMemory(env.host, env.mem);
  return {
    content: toolOk({ created, kept_locked: kept, removed, shared_ok: true }),
    wrote: true,
  };
}

async function sceneIndex(scene: Scene): Promise<
  {
    line: number;
    start_ms: number | null;
    end_ms: number | null;
    targets: string[];
    props: string[];
    n?: number;
  }[]
> {
  const code = scene.code ?? '';
  if (scene.kind !== 'code' || !code.trim()) return [];
  const traced = await sceneTrace(code, {
    hold: scene.hold,
    sceneId: scene.id,
    title: scene.title,
    enter: scene.enter,
  });
  return indexCalls(code, traced.trace).map((call) => ({
    line: call.line,
    start_ms: call.start,
    end_ms: call.end,
    targets: [],
    props: [],
    ...(call.n != null ? { n: call.n } : {}),
  }));
}

async function readScene(env: ToolEnv, args: Record<string, unknown>): Promise<ToolOutcome> {
  const sceneId = typeof args.scene_id === 'string' ? args.scene_id : '';
  if (outOfScope(env, sceneId))
    return fail(toolFail('OUT_OF_SCOPE', `只能读 ${env.editSceneId}`, '只改目标场'));
  const sb = env.host.getStoryboard();
  const scene = sb && findScene(sb, sceneId);
  if (!scene) return fail(toolFail('NOT_FOUND', `没有场 ${sceneId || '？'}`, '先 read_storyboard'));
  const state = env.mem.scenes[scene.id];
  const index = args.with_index === false ? [] : await sceneIndex(scene);
  return {
    content: toolOk({
      scene_id: scene.id,
      hash: contentHash(scene.code ?? ''),
      locked: Boolean(scene.locked),
      code_numbered: formatNumbered(scene.code ?? ''),
      duration_ms: state?.durationMs ?? 0,
      index,
      last_report: state?.lastReport ?? '',
    }),
  };
}

async function writeScene(env: ToolEnv, args: Record<string, unknown>): Promise<ToolOutcome> {
  const sceneId = typeof args.scene_id === 'string' ? args.scene_id : '';
  const code = text(args.code, 40_000);
  if (!sceneId || code === null)
    return fail(toolFail('INVALID_ARGS', 'write_scene 需要 scene_id 和 code', '按 schema 重发'));
  const summary = args.summary === undefined ? undefined : text(args.summary, 200);
  if (args.summary !== undefined && summary === null) {
    return fail(toolFail('INVALID_ARGS', 'summary 超过 200 字', '缩短 summary'));
  }
  return commitCode(
    env,
    sceneId,
    code,
    typeof args.base_hash === 'string' ? args.base_hash : undefined,
    summary ?? undefined,
  );
}

async function editRange(env: ToolEnv, args: Record<string, unknown>): Promise<ToolOutcome> {
  const sceneId = typeof args.scene_id === 'string' ? args.scene_id : '';
  const replacement = text(args.replacement, 20_000);
  const start = args.start_line;
  const end = args.end_line;
  if (
    !sceneId ||
    replacement === null ||
    typeof args.base_hash !== 'string' ||
    typeof start !== 'number' ||
    typeof end !== 'number'
  ) {
    return fail(toolFail('INVALID_ARGS', 'edit_range 的参数不完整', '按 schema 重发'));
  }
  if (outOfScope(env, sceneId))
    return fail(toolFail('OUT_OF_SCOPE', `只能改 ${env.editSceneId}`, '只改目标场'));
  const sb = env.host.getStoryboard();
  const scene = sb && findScene(sb, sceneId);
  if (!scene) return fail(toolFail('NOT_FOUND', `没有场 ${sceneId}`, '先 read_storyboard'));
  if (scene.locked) return fail(toolFail('LOCKED', `场 ${sceneId} 已锁定`, '跳过这一场'));
  if (contentHash(scene.code ?? '') !== args.base_hash) {
    return fail(toolFail('STALE', 'base_hash 和当前代码不一致', 'read_scene 后重做'));
  }
  const applied = applyRange(scene.code ?? '', start, end, replacement);
  if (!applied.ok) return fail(toolFail('INVALID_ARGS', applied.message, '按 code_numbered 重选行号'));
  return commitCode(env, sceneId, applied.code, args.base_hash, undefined, true);
}

async function commitCode(
  env: ToolEnv,
  sceneId: string,
  code: string,
  baseHash: string | undefined,
  summary: string | undefined,
  alreadyHashed = false,
): Promise<ToolOutcome> {
  if (outOfScope(env, sceneId))
    return fail(toolFail('OUT_OF_SCOPE', `只能改 ${env.editSceneId}`, '只改目标场'));
  const sb = env.host.getStoryboard();
  if (!sb) return fail(toolFail('NOT_FOUND', '没有打开的分镜', '先打开项目'));
  const scene = findScene(sb, sceneId);
  if (!scene) return fail(toolFail('NOT_FOUND', `没有场 ${sceneId}`, '先 read_storyboard'));
  if (scene.locked) return fail(toolFail('LOCKED', `场 ${sceneId} 已锁定`, '跳过这一场'));
  const existing = scene.code ?? '';
  if (!alreadyHashed && existing.trim() && contentHash(existing) !== baseHash) {
    return fail(toolFail('STALE', 'base_hash 和当前代码不一致', 'read_scene 后重做'));
  }
  const state = env.mem.scenes[sceneId];
  if ((state?.writes ?? 0) >= SCENE_WRITE_LIMIT) {
    if (state) state.status = 'stuck';
    await saveMemory(env.host, env.mem);
    return fail(toolFail('INVALID_ARGS', `这一场已经写入 ${SCENE_WRITE_LIMIT} 次`, '换一场，或 finish'));
  }
  const sharedFile = (await env.host.readFile('shared.js')) ?? '';
  const nextCode = code.includes('/* @awb-shared */')
    ? code
    : joinShared(sharedFile, splitShared(code).body || code);
  const other = otherDuration(sb, sceneId, env.mem);
  const gated = await runScene(nextCode, {
    hold: scene.hold,
    otherDurationMs: other,
    sceneId: scene.id,
    title: scene.title,
    enter: scene.enter,
  });
  if (!gated.ok) return fail(gateFail(gated.error));
  const scenes = sb.scenes.map((item) =>
    item.id === scene.id
      ? { ...item, kind: 'code' as const, code: nextCode, hold: item.hold, enter: item.enter }
      : item,
  );
  const accepted = acceptStoryboard({ ...sb, scenes });
  if (!accepted) return fail(toolFail('INVALID_ARGS', '写回的分镜过不了 schema', '检查这场代码'));
  env.host.updateStoryboard(accepted);
  const hash = contentHash(nextCode);
  const prev = env.mem.scenes[scene.id] ?? {
    status: 'written' as const,
    hash: '',
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
  const previousMs = prev.durationMs > 0 ? prev.durationMs : (env.editDurationMs ?? 0);
  prev.attempts += 1;
  prev.writes += 1;
  prev.hash = hash;
  prev.durationMs = gated.durationMs;
  prev.gateOk = true;
  if (summary?.trim()) prev.summary = summary.trim();
  env.mem.scenes[scene.id] = prev;
  env.mem.currentSceneId = scene.id;
  env.mem.truncations[scene.id] = 0;
  const compared = env.editRequest
    ? await compareEdit(env, accepted, scene.id, previousMs, gated.durationMs)
    : null;
  const report = compared
    ? compared.report
    : await observe(env, accepted, [scene.id], defaultTimes(gated.durationMs));
  prev.lastReport = `gate pass，新问题 ${report.delta.added.length}，关掉 ${report.delta.fixed.length}`;
  if (report.delta.stalled) prev.status = 'stuck';
  await saveMemory(env.host, env.mem);
  const note = [report.note, compared?.note].filter((item) => item && item.trim()).join('\n');
  return {
    content: toolOk({
      hash,
      duration_ms: gated.durationMs,
      ...(previousMs > 0 ? { duration_was_ms: previousMs } : {}),
      gate: 'pass',
      report: {
        issues: report.delta.issues.map(briefIssue),
        fixed: report.delta.fixed,
        new: report.delta.added,
        ...(report.delta.stalled ? { stalled: true } : {}),
      },
      ...(note ? { note } : {}),
    }),
    images: compared?.images ?? imagesOf(report.frames),
    wrote: true,
  };
}

async function compareEdit(
  env: ToolEnv,
  sb: Storyboard,
  sceneId: string,
  previousMs: number,
  nextMs: number,
): Promise<{
  report: { delta: IssueDelta; frames: ObservedFrame[]; note?: string };
  images: { dataUrl: string; caption: string }[];
  note: string;
}> {
  const shown = env.editTimes ?? [];
  const outside = env.outsideTimes ?? [];
  const times = [...shown, ...outside];
  const report = await observe(env, sb, [sceneId], times.length ? times : defaultTimes(nextMs));
  const before = env.beforeFrames ?? [];
  const images: { dataUrl: string; caption: string }[] = [];
  for (let i = 0; i < shown.length && images.length < 8; i++) {
    const tMs = shown[i] ?? 0;
    const old = before[i];
    const now = report.frames[i];
    if (old?.png?.byteLength) images.push({ dataUrl: pngDataUrl(old.png), caption: `改前 ${tMs}ms` });
    if (images.length >= 8) break;
    if (now?.png?.byteLength) images.push({ dataUrl: pngDataUrl(now.png), caption: `改后 ${tMs}ms` });
  }
  const samples = outside.map((tMs, index) => ({
    tMs,
    before: before[shown.length + index]?.raster,
    after: report.frames[shown.length + index]?.raster,
  }));
  const note = [durationNote(previousMs, nextMs), samples.length ? outsideNote(samples) : '']
    .filter((item) => item.trim())
    .join('\n');
  return { report, images, note };
}

function otherDuration(sb: Storyboard, sceneId: string, mem: Memory): number {
  let ms = 0;
  for (const scene of sb.scenes) {
    if (scene.id === sceneId) break;
    ms += mem.scenes[scene.id]?.durationMs ?? 0;
  }
  return ms;
}

async function writeShared(env: ToolEnv, args: Record<string, unknown>): Promise<ToolOutcome> {
  const code = text(args.code, 4000);
  if (code === null || typeof args.base_hash !== 'string') {
    return fail(toolFail('INVALID_ARGS', 'write_shared 需要 code 和 base_hash', '按 schema 重发'));
  }
  const current = (await env.host.readFile('shared.js')) ?? '';
  if (contentHash(current) !== args.base_hash) {
    return fail(toolFail('STALE', '共享常量的 base_hash 过期', 'read_storyboard 看 shared_hash'));
  }
  const probe = code.trim() ? `${code.trim()}\nwait(200);\n` : 'wait(200);\n';
  const probed = await runScene(probe);
  if (!probed.ok) return fail(gateFail(probed.error));
  const sb = env.host.getStoryboard();
  if (!sb) return fail(toolFail('NOT_FOUND', '没有打开的分镜', '先打开项目'));
  const kept = sb.scenes.filter((scene) => scene.locked).map((scene) => scene.id);
  const broken: { scene_id: string; error: string }[] = [];
  const updated: string[] = [];
  const durations = new Map<string, number>();
  const nextScenes = sb.scenes.map((scene) => {
    if (scene.locked || !scene.code?.trim()) return scene;
    const nextCode = replaceShared(scene.code, code.trim());
    return { ...scene, code: nextCode };
  });
  for (const scene of nextScenes) {
    if (scene.locked || !scene.code?.trim()) continue;
    if (sb.scenes.find((item) => item.id === scene.id)?.code === scene.code) continue;
    const gated = await runScene(scene.code, {
      hold: scene.hold,
      otherDurationMs: otherDuration(sb, scene.id, env.mem),
      sceneId: scene.id,
      title: scene.title,
      enter: scene.enter,
    });
    if (!gated.ok) broken.push({ scene_id: scene.id, error: `${gated.error.code} ${gated.error.message}` });
    else {
      updated.push(scene.id);
      durations.set(scene.id, gated.durationMs);
    }
  }
  if (broken.length) {
    return fail(
      JSON.stringify({
        ok: false,
        error: { code: 'COMPILE_ERROR', message: '共享常量让有的场过不了运行门，已回滚', hint: '修正后再写' },
        broken,
        kept_locked: kept,
      }),
    );
  }
  const accepted = acceptStoryboard({ ...sb, scenes: nextScenes });
  if (!accepted) return fail(toolFail('INVALID_ARGS', '写回的分镜过不了 schema', '检查共享常量'));
  env.host.updateStoryboard(accepted);
  await env.host.writeFile('shared.js', code.trim());
  env.mem.sharedHash = contentHash(code.trim());
  for (const id of updated) {
    const scene = accepted.scenes.find((item) => item.id === id);
    const state = env.mem.scenes[id];
    if (!scene || !state) continue;
    state.hash = contentHash(scene.code ?? '');
    state.gateOk = true;
    state.durationMs = durations.get(id) ?? state.durationMs;
  }
  const report = updated.length ? await observe(env, accepted, updated, []) : undefined;
  await saveMemory(env.host, env.mem);
  return {
    content: toolOk({
      hash: env.mem.sharedHash,
      updated,
      kept_locked: kept,
      broken: [],
      ...(report ? { report: { fixed: report.delta.fixed, new: report.delta.added } } : {}),
    }),
    images: report ? imagesOf(report.frames) : undefined,
    wrote: true,
  };
}

async function captureFrames(env: ToolEnv, args: Record<string, unknown>): Promise<ToolOutcome> {
  const sceneId = typeof args.scene_id === 'string' ? args.scene_id : '';
  if (outOfScope(env, sceneId))
    return fail(toolFail('OUT_OF_SCOPE', `只能看 ${env.editSceneId}`, '只改目标场'));
  const sb = env.host.getStoryboard();
  const scene = sb && findScene(sb, sceneId);
  if (!sb || !scene) return fail(toolFail('NOT_FOUND', `没有场 ${sceneId || '？'}`, '先 read_storyboard'));
  let times: number[] = [];
  if (Array.isArray(args.times_ms)) {
    if (args.times_ms.length > 8 || args.times_ms.some((item) => typeof item !== 'number' || item < 0)) {
      return fail(toolFail('INVALID_ARGS', 'times_ms 最多 8 个非负毫秒', '按 schema 重发'));
    }
    times = args.times_ms.map((item) => Math.round(item));
  } else if (args.range !== undefined) {
    const range = asObject(args.range);
    if (!range || typeof range.from_ms !== 'number' || typeof range.to_ms !== 'number') {
      return fail(toolFail('INVALID_ARGS', 'range 需要 from_ms 和 to_ms', '按 schema 重发'));
    }
    const count = range.count === undefined ? 4 : range.count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 2 || count > 8) {
      return fail(toolFail('INVALID_ARGS', 'range.count 要在 2 到 8', '按 schema 重发'));
    }
    const from = range.from_ms;
    const to = range.to_ms;
    times = Array.from({ length: count }, (_item, index) =>
      Math.round(from + ((to - from) * index) / Math.max(1, count - 1)),
    );
  } else {
    times = defaultTimes(env.mem.scenes[scene.id]?.durationMs || 1000);
  }
  const isolated = args.isolated === true;
  const report = await env.inspect(sb, {
    sceneIds: [scene.id],
    frames: [{ sceneId: scene.id, timesMs: times, isolated }],
  });
  const delta = applyInspection(env.mem, [scene.id], report.issues, env.turn);
  await saveMemory(env.host, env.mem);
  return {
    content: toolOk({
      frames: (report.frames.length
        ? report.frames
        : times.map((tMs) => ({ tMs, caption: `${scene.id} ${tMs}ms`, boxes: 0 }))
      ).map((frame) => ({ t_ms: frame.tMs, caption: frame.caption, boxes_count: frame.boxes })),
      issues: delta.issues.map(briefIssue),
      ...(report.note ? { note: report.note } : {}),
    }),
    images: imagesOf(report.frames),
  };
}

async function check(env: ToolEnv, args: Record<string, unknown>): Promise<ToolOutcome> {
  const sb = env.host.getStoryboard();
  if (!sb) return fail(toolFail('NOT_FOUND', '没有打开的分镜', '先打开项目'));
  const film = args.film === true;
  let sceneIds = sb.scenes.map((scene) => scene.id);
  if (Array.isArray(args.scene_ids)) {
    const ids: string[] = [];
    for (const item of args.scene_ids) {
      if (typeof item !== 'string' || !sb.scenes.some((scene) => scene.id === item)) {
        return fail(toolFail('NOT_FOUND', `没有场 ${String(item)}`, '先 read_storyboard'));
      }
      if (outOfScope(env, item))
        return fail(toolFail('OUT_OF_SCOPE', `只能查 ${env.editSceneId}`, '只改目标场'));
      ids.push(item);
    }
    sceneIds = ids;
  } else if (env.editSceneId) {
    sceneIds = [env.editSceneId];
  }
  const report = await env.inspect(sb, { sceneIds, film });
  const delta = applyInspection(env.mem, sceneIds, report.issues, env.turn);
  await saveMemory(env.host, env.mem);
  const summary = { blocker: 0, major: 0, minor: 0 };
  for (const issue of delta.issues) summary[issue.severity] += 1;
  return {
    content: toolOk({
      issues: delta.issues.map(briefIssue),
      summary,
      ...(report.note ? { note: report.note } : {}),
    }),
    images: imagesOf(report.frames),
  };
}

async function updateIssues(env: ToolEnv, args: Record<string, unknown>): Promise<ToolOutcome> {
  const sb = env.host.getStoryboard();
  if (!sb) return fail(toolFail('NOT_FOUND', '没有打开的分镜', '先打开项目'));
  const rejected: { id?: string; message: string }[] = [];
  const applied: string[] = [];
  if (Array.isArray(args.add)) {
    for (const item of args.add) {
      const rec = asObject(item);
      if (!rec || typeof rec.scene_id !== 'string' || typeof rec.text !== 'string' || rec.text.length > 300) {
        rejected.push({ message: 'add 需要 scene_id 和不超过 300 字的 text' });
        continue;
      }
      if (!sb.scenes.some((scene) => scene.id === rec.scene_id)) {
        rejected.push({ message: `没有场 ${rec.scene_id}` });
        continue;
      }
      if (outOfScope(env, rec.scene_id)) {
        rejected.push({ message: `只能改 ${env.editSceneId}` });
        continue;
      }
      const severity = rec.severity === 'major' || rec.severity === 'minor' ? rec.severity : 'minor';
      const tMs = typeof rec.t_ms === 'number' ? rec.t_ms : undefined;
      const fingerprint = [
        'CONTENT',
        rec.scene_id,
        rec.text,
        tMs == null ? '' : String(Math.floor(tMs / 500) * 500),
      ].join('|');
      const id = freshContentId(env.mem);
      env.mem.issues.push({
        id,
        scene_id: rec.scene_id,
        kind: 'CONTENT',
        severity,
        evidence: { text: rec.text, ...(tMs != null ? { t_ms: tMs } : {}) },
        fingerprint,
        first_turn: env.turn,
        last_turn: env.turn,
        attempts: 1,
        status: 'open',
      });
      applied.push(id);
    }
  }
  if (Array.isArray(args.waive)) {
    for (const item of args.waive) {
      const rec = asObject(item);
      if (!rec || typeof rec.id !== 'string' || typeof rec.reason !== 'string' || rec.reason.length > 200) {
        rejected.push({ message: 'waive 需要 id 和不超过 200 字的 reason' });
        continue;
      }
      const issue = env.mem.issues.find((entry) => entry.id === rec.id);
      if (!issue) {
        rejected.push({ id: rec.id, message: '没有这个问题' });
        continue;
      }
      if (UNWAIVABLE.has(issue.kind) || (issue.kind === 'BLANK' && issue.severity === 'blocker')) {
        rejected.push({ id: rec.id, message: `${issue.kind} 不能豁免` });
        continue;
      }
      issue.status = 'waived';
      issue.evidence = { ...issue.evidence, text: rec.reason };
      issue.last_turn = env.turn;
      applied.push(issue.id);
    }
  }
  if (Array.isArray(args.close)) {
    for (const item of args.close) {
      if (typeof item !== 'string') {
        rejected.push({ message: 'close 的项必须是问题 id' });
        continue;
      }
      const issue = env.mem.issues.find((entry) => entry.id === item);
      if (!issue) {
        rejected.push({ id: item, message: '没有这个问题' });
        continue;
      }
      if (issue.kind !== 'CONTENT') {
        rejected.push({ id: item, message: '机器问题只能由下一次检查关掉，或用 waive' });
        continue;
      }
      issue.status = 'fixed';
      issue.last_turn = env.turn;
      applied.push(issue.id);
    }
  }
  await saveMemory(env.host, env.mem);
  if (rejected.length && !applied.length) {
    return fail(
      toolFail(
        'INVALID_ARGS',
        rejected.map((item) => item.message).join('；'),
        '只关内容类问题，机器问题用 waive',
      ),
    );
  }
  return { content: toolOk({ applied, rejected }) };
}

function freshContentId(mem: Memory): string {
  let n = 1;
  while (mem.issues.some((issue) => issue.id === `M${n}`)) n += 1;
  return `M${n}`;
}

async function finishTool(env: ToolEnv, args: Record<string, unknown>): Promise<ToolOutcome> {
  const summary = text(args.summary, 1000);
  if (!summary?.trim()) return fail(toolFail('INVALID_ARGS', 'finish 需要 summary', '按 schema 重发'));
  const sb = env.host.getStoryboard();
  if (!sb) return fail(toolFail('NOT_FOUND', '没有打开的分镜', '先打开项目'));
  const reasons: string[] = [];
  const scenes = env.editSceneId ? sb.scenes.filter((scene) => scene.id === env.editSceneId) : sb.scenes;
  let other = 0;
  for (const scene of scenes) {
    if (scene.locked) continue;
    if (scene.kind !== 'code' || !scene.code?.trim()) {
      reasons.push(`${scene.id} 没有代码`);
      continue;
    }
    const gated = await runScene(scene.code, {
      hold: scene.hold,
      otherDurationMs: other,
      sceneId: scene.id,
      title: scene.title,
      enter: scene.enter,
    });
    if (!gated.ok) reasons.push(`${scene.id} ${gated.error.code} ${gated.error.message}`);
    else other += gated.durationMs;
  }
  for (const issue of env.mem.issues) {
    if (issue.status !== 'open' && issue.status !== 'stuck') continue;
    if (env.editSceneId && issue.scene_id !== env.editSceneId) continue;
    if (issue.severity === 'blocker') reasons.push(`${issue.id} ${issue.kind} ${issue.scene_id}`);
  }
  if (reasons.length) {
    return fail(toolFail('FINISH_REJECTED', '还有硬门槛没过', '继续修，或等预算用完由系统停', { reasons }));
  }
  const open = env.mem.issues.filter((issue) => {
    if (issue.status !== 'open' && issue.status !== 'stuck') return false;
    if (env.editSceneId && issue.scene_id !== env.editSceneId) return false;
    return true;
  });
  const waived = env.mem.issues.some((issue) => issue.status === 'waived');
  const terminal = open.length || waived ? 'done_with_issues' : 'done';
  return { content: toolOk({ summary: summary.trim(), status: terminal }), terminal };
}

async function observe(
  env: ToolEnv,
  sb: Storyboard,
  sceneIds: string[],
  timesMs: number[],
): Promise<{ delta: IssueDelta; frames: ObservedFrame[]; note?: string }> {
  const frames = timesMs.length ? [{ sceneId: sceneIds[0] ?? '', timesMs, isolated: false }] : [];
  try {
    const report = await env.inspect(sb, { sceneIds, frames: frames.filter((item) => item.sceneId) });
    const delta = applyInspection(env.mem, sceneIds, report.issues, env.turn);
    const end = report.frames.at(-1);
    const state = sceneIds[0] ? env.mem.scenes[sceneIds[0]] : undefined;
    if (state && end) state.endState = end.caption;
    return { delta, frames: report.frames, note: report.note };
  } catch (error) {
    const delta = applyInspection(env.mem, sceneIds, [], env.turn);
    return { delta, frames: [], note: error instanceof Error ? error.message : String(error) };
  }
}

function briefIssue(issue: Issue): {
  id: string;
  kind: string;
  severity: string;
  scene_id: string;
  text?: string;
} {
  return {
    id: issue.id,
    kind: issue.kind,
    severity: issue.severity,
    scene_id: issue.scene_id,
    ...(issue.evidence.text ? { text: issue.evidence.text } : {}),
  };
}
