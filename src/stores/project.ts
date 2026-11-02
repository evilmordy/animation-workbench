import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { platform } from '../platform';
import sampleStoryboard from '../../samples/pythagoras/storyboard.json';
import { emptyStoryboard, newProjectFile, PROJECT_DIRS, ProjectFile, snapshotName } from '../shared/project';
import { parseStoryboard, SCHEMA_VERSION, type Storyboard } from '../shared/schema';
import { validate } from '../shared/validate';

export const AUTOSAVE_MS = 1000;
export const MAX_SNAPSHOTS = 50;
export const MAX_UNDO = 100;
export const MAX_RECENT = 10;

export interface RecentProject {
  dir: string;
  name: string;
  openedAt: string;
}

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export class ProjectError extends Error {
  constructor(
    message: string,
    /** 有可用快照时，界面可以提示从快照恢复 */
    readonly recoverable = false,
  ) {
    super(message);
  }
}

const SB = 'storyboard.json';
const PJ = 'project.json';

export const useProjectStore = defineStore('project', () => {
  const dir = ref<string | null>(null);
  const project = ref<ProjectFile | null>(null);
  const storyboard = shallowRef<Storyboard | null>(null);
  const saveState = ref<SaveState>('saved');
  const saveError = ref<string | null>(null);
  const undoStack = shallowRef<string[]>([]);
  const redoStack = shallowRef<string[]>([]);
  const recent = ref<RecentProject[]>([]);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const issues = computed(() => (storyboard.value ? validate(storyboard.value) : []));
  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);
  const isOpen = computed(() => dir.value !== null && storyboard.value !== null);

  const path = (name: string) => platform.join(dir.value!, name);

  async function loadRecent() {
    recent.value = (await platform.storeGet<RecentProject[]>('recentProjects')) ?? [];
  }

  async function remember(d: string, name: string) {
    const list = [
      { dir: d, name, openedAt: new Date().toISOString() },
      ...recent.value.filter((r) => r.dir !== d),
    ];
    recent.value = list.slice(0, MAX_RECENT);
    await platform.storeSet('recentProjects', recent.value);
  }

  function reset(d: string, pj: ProjectFile, sb: Storyboard) {
    if (timer) clearTimeout(timer);
    dir.value = d;
    project.value = pj;
    storyboard.value = sb;
    undoStack.value = [];
    redoStack.value = [];
    saveState.value = 'saved';
    saveError.value = null;
  }

  async function writeAll() {
    await platform.writeTextAtomic(await path(SB), JSON.stringify(storyboard.value, null, 2));
    await platform.writeTextAtomic(await path(PJ), JSON.stringify(project.value, null, 2));
  }

  /** 新建项目：目录里已有 project.json 时直接打开，避免覆盖 */
  async function create(name: string, sb?: Storyboard, target?: string): Promise<boolean> {
    const d = target ?? (await platform.pickDirectory('选择一个空文件夹来保存新项目'));
    if (!d) return false;
    if (await platform.exists(await platform.join(d, PJ))) return open(d);
    for (const sub of PROJECT_DIRS) await platform.mkdir(await platform.join(d, sub));
    reset(d, newProjectFile(name), sb ?? emptyStoryboard(name));
    await writeAll();
    await remember(d, name);
    return true;
  }

  async function readStoryboard(file: string): Promise<Storyboard> {
    let data: unknown;
    try {
      data = JSON.parse(await platform.readText(file));
    } catch {
      throw new ProjectError('storyboard.json 已损坏，无法解析', true);
    }
    const version = (data as { schemaVersion?: unknown })?.schemaVersion;
    if (typeof version === 'number' && version > SCHEMA_VERSION)
      throw new ProjectError(
        `这个项目由更新版本的应用创建（分镜格式 v${version}），请升级 Animation Workbench 后再打开`,
      );
    const r = parseStoryboard(data);
    if (!r.ok)
      throw new ProjectError(`storyboard.json 格式错误：${r.issues[0]!.path} ${r.issues[0]!.message}`, true);
    return r.value;
  }

  async function open(target?: string): Promise<boolean> {
    const d = target ?? (await platform.pickDirectory('打开项目文件夹'));
    if (!d) return false;
    const pjPath = await platform.join(d, PJ);
    if (!(await platform.exists(pjPath)))
      throw new ProjectError('这个文件夹里没有 project.json，不是 Animation Workbench 项目');
    const pjRaw = JSON.parse(await platform.readText(pjPath));
    if (typeof pjRaw?.schemaVersion === 'number' && pjRaw.schemaVersion > SCHEMA_VERSION)
      throw new ProjectError('这个项目由更新版本的应用创建，请升级 Animation Workbench 后再打开');
    const pj = ProjectFile.parse(pjRaw);
    const sb = await readStoryboard(await platform.join(d, SB));
    // 上次写入中途被强杀会留下临时文件，正式文件不受影响，直接清掉
    for (const name of [SB, PJ]) {
      const tmp = await platform.join(d, `${name}.tmp`);
      if (await platform.exists(tmp)) await platform.remove(tmp).catch(() => {});
    }
    reset(d, pj, sb);
    await remember(d, pj.name);
    return true;
  }

  async function listSnapshots(d = dir.value!): Promise<string[]> {
    const vdir = await platform.join(d, 'versions');
    if (!(await platform.exists(vdir))) return [];
    return (await platform.readDir(vdir))
      .filter((n) => n.startsWith('storyboard-') && n.endsWith('.json'))
      .sort();
  }

  /** storyboard.json 损坏时，用最新的可用快照覆盖它并打开 */
  async function recover(d: string): Promise<boolean> {
    for (const name of (await listSnapshots(d)).reverse()) {
      try {
        const sb = await readStoryboard(await platform.join(d, 'versions', name));
        await platform.writeTextAtomic(await platform.join(d, SB), JSON.stringify(sb, null, 2));
        return open(d);
      } catch {
        continue;
      }
    }
    throw new ProjectError('没有找到可用的快照，无法恢复');
  }

  async function openSample(): Promise<boolean> {
    const d = await platform.join(await platform.appDataDir(), 'samples', 'pythagoras');
    if (await platform.exists(await platform.join(d, PJ))) return open(d);
    await platform.mkdir(d);
    return create('勾股定理示例', sampleStoryboard as Storyboard, d);
  }

  async function snapshot(reason: string) {
    if (!dir.value || !storyboard.value) return;
    const vdir = await path('versions');
    await platform.mkdir(vdir);
    await platform.writeTextAtomic(
      await platform.join(vdir, snapshotName(reason)),
      JSON.stringify(storyboard.value),
    );
    const all = await listSnapshots();
    for (const old of all.slice(0, Math.max(0, all.length - MAX_SNAPSHOTS)))
      await platform.remove(await platform.join(vdir, old));
  }

  async function save(manual = false) {
    if (!dir.value || !storyboard.value) return;
    if (timer) clearTimeout(timer);
    timer = null;
    saveState.value = 'saving';
    try {
      await writeAll();
      if (manual) await snapshot('manual');
      saveState.value = 'saved';
      saveError.value = null;
    } catch (e) {
      saveState.value = 'error';
      saveError.value = e instanceof Error ? e.message : String(e);
    }
  }

  function scheduleSave() {
    saveState.value = 'dirty';
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save(), AUTOSAVE_MS);
  }

  let lastCoalesce: { key: string; at: number } | null = null;

  /**
   * 修改分镜的唯一入口：记录撤销、触发自动保存。
   * coalesce 相同且间隔 < 1.5s 的连续修改（如逐键输入）合并为一步撤销。
   */
  function update(next: Storyboard, opts: { coalesce?: string } = {}) {
    if (!storyboard.value) return;
    const now = Date.now();
    const merge = opts.coalesce && lastCoalesce?.key === opts.coalesce && now - lastCoalesce.at < 1500;
    lastCoalesce = opts.coalesce ? { key: opts.coalesce, at: now } : null;
    if (!merge) undoStack.value = [...undoStack.value, JSON.stringify(storyboard.value)].slice(-MAX_UNDO);
    redoStack.value = [];
    storyboard.value = next;
    scheduleSave();
  }

  function updateProject(patch: Partial<ProjectFile>) {
    if (!project.value) return;
    project.value = { ...project.value, ...patch };
    scheduleSave();
  }

  function undo() {
    const prev = undoStack.value.at(-1);
    if (!prev || !storyboard.value) return;
    redoStack.value = [...redoStack.value, JSON.stringify(storyboard.value)];
    undoStack.value = undoStack.value.slice(0, -1);
    storyboard.value = JSON.parse(prev);
    scheduleSave();
  }

  function redo() {
    const next = redoStack.value.at(-1);
    if (!next || !storyboard.value) return;
    undoStack.value = [...undoStack.value, JSON.stringify(storyboard.value)];
    redoStack.value = redoStack.value.slice(0, -1);
    storyboard.value = JSON.parse(next);
    scheduleSave();
  }

  async function close() {
    if (saveState.value === 'dirty') await save();
    dir.value = null;
    project.value = null;
    storyboard.value = null;
  }

  return {
    dir,
    project,
    storyboard,
    saveState,
    saveError,
    recent,
    issues,
    canUndo,
    canRedo,
    isOpen,
    loadRecent,
    create,
    open,
    openSample,
    recover,
    listSnapshots,
    snapshot,
    save,
    update,
    updateProject,
    undo,
    redo,
    close,
  };
});
