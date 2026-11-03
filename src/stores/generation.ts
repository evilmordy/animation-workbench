import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { AiError, runTask } from '../ai/client';
import { completeItems } from '../ai/extract';
import { editMessages, outlineMessages, sceneMessages, type EditScope, type Outline } from '../ai/prompts';
import { aiSession } from '../ai/session';
import { checkEdit, checkOutline, checkScene } from '../ai/validators';
import { newId } from '../shared/id';
import { emptyScene, updateScene, type ApplyResult } from '../shared/ops';
import type { Storyboard } from '../shared/schema';
import { useAiStore } from './ai';
import { useProjectStore } from './project';

export type SceneJobState = 'waiting' | 'running' | 'done' | 'error' | 'cancelled';

export interface SceneJob {
  sceneId: string;
  state: SceneJobState;
  attempt: number;
  error?: string;
  /** 校验失败时最后一次的输出，可在专家编辑器里手动修 */
  lastText?: string;
  requestId?: string;
}

/** AI 修改的待确认结果（PLAN T3.6） */
export interface PendingEdit {
  title: string;
  base: Storyboard;
  result: ApplyResult;
}

export const useGenerationStore = defineStore('generation', () => {
  const project = useProjectStore();
  const ai = useAiStore();

  const source = ref('');
  /** 用户需求原文。只交给 agent，不进大纲，也不截断。 */
  const intent = ref('');
  const outline = ref<Outline | null>(null);
  const outlineText = ref('');
  const outlineBusy = ref(false);
  const outlineError = ref<string | null>(null);
  let outlineReq: string | null = null;

  const jobs = ref<SceneJob[]>([]);
  const editBusy = ref(false);
  const editError = ref<{ message: string; lastText?: string } | null>(null);
  let editReq: string | null = null;
  const pending = shallowRef<PendingEdit | null>(null);
  /** 预览里显示修改后的版本还是当前版本 */
  const previewProposed = ref(true);

  const streamingOutline = computed(() => completeItems(outlineText.value, 'scenes') as Outline['scenes']);
  const running = computed(() => jobs.value.some((j) => j.state === 'running' || j.state === 'waiting'));

  const params = () => project.project!.generation;
  const describe = (e: unknown) =>
    e instanceof AiError
      ? e.kind === 'llm'
        ? e.llm!.code
        : 'validation'
      : e instanceof Error
        ? e.message
        : String(e);

  // ---------- 大纲 ----------

  async function generateOutline() {
    const s = aiSession();
    outlineBusy.value = true;
    outlineError.value = null;
    outlineText.value = '';
    outlineReq = newId('req');
    try {
      const r = await runTask(
        s.transport,
        {
          task: 'outline',
          title: '生成大纲',
          messages: outlineMessages(source.value, params()),
          check: checkOutline,
          onDelta: (t) => (outlineText.value = t),
          requestId: outlineReq,
        },
        s.log,
      );
      outline.value = r.value;
    } catch (e) {
      outlineError.value = describe(e);
      throw e;
    } finally {
      outlineBusy.value = false;
      outlineReq = null;
    }
  }

  function cancelOutline() {
    if (outlineReq) aiSession().cancel(outlineReq);
  }

  // ---------- 逐场景细化 ----------

  const setJob = (sceneId: string, patch: Partial<SceneJob>) =>
    (jobs.value = jobs.value.map((j) => (j.sceneId === sceneId ? { ...j, ...patch } : j)));

  /** 用大纲替换（或追加到）当前分镜：先放占位场景，再并发细化 */
  async function generateScenes(mode: 'replace' | 'append') {
    const ol = outline.value;
    if (!ol || !project.storyboard) return;
    await project.snapshot('before-ai-generate');
    let sb: Storyboard = mode === 'replace' ? { ...project.storyboard, scenes: [] } : project.storyboard;
    if (mode === 'replace') sb = { ...sb, meta: { ...sb.meta, title: ol.title } };
    const ids: string[] = [];
    for (const o of ol.scenes) {
      const s = { ...emptyScene(sb, o.title), description: o.description, hold: Math.min(30, o.duration) };
      sb = { ...sb, scenes: [...sb.scenes, s] };
      ids.push(s.id);
    }
    project.update(sb);
    jobs.value = ids.map((sceneId) => ({ sceneId, state: 'waiting', attempt: 0 }));
    await runPool(ids.map((id, i) => () => generateOne(id, ol, i)));
  }

  async function runPool(tasks: (() => Promise<void>)[]) {
    const limit = Math.max(1, aiSession().concurrency);
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) await tasks[next++]!();
    };
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  }

  async function generateOne(sceneId: string, ol: Outline, index: number, extra?: string) {
    const job = jobs.value.find((j) => j.sceneId === sceneId);
    if (!job || job.state === 'cancelled') return;
    const s = aiSession();
    const requestId = newId('req');
    setJob(sceneId, { state: 'running', error: undefined, lastText: undefined, requestId, attempt: 1 });
    ai.setBusy(sceneId, true);
    try {
      const r = await runTask(
        s.transport,
        {
          task: 'scene',
          title: `生成场景 ${index + 1}：${ol.scenes[index]?.title ?? ''}`,
          messages: sceneMessages({
            outline: ol,
            index,
            sceneId,
            source: source.value,
            params: params(),
            extra,
          }),
          check: (d) => checkScene(d, sceneId, project.storyboard!.meta),
          onAttempt: (attempt) => setJob(sceneId, { attempt }),
          requestId,
        },
        s.log,
      );
      if (project.storyboard?.scenes.some((x) => x.id === sceneId))
        project.update(
          updateScene(project.storyboard, sceneId, (old) => ({ ...r.value, locked: old.locked })),
        );
      setJob(sceneId, { state: 'done' });
    } catch (e) {
      const cancelled = e instanceof AiError && e.llm?.code === 'cancelled';
      setJob(sceneId, {
        state: cancelled ? 'cancelled' : 'error',
        error: describe(e),
        lastText: e instanceof AiError ? e.lastText : undefined,
      });
    } finally {
      ai.setBusy(sceneId, false);
    }
  }

  function retryScene(sceneId: string, extra?: string) {
    const ol = outline.value ?? outlineFromStoryboard();
    const index = project.storyboard!.scenes.findIndex((s) => s.id === sceneId);
    if (!jobs.value.some((j) => j.sceneId === sceneId))
      jobs.value = [...jobs.value, { sceneId, state: 'waiting', attempt: 0 }];
    else setJob(sceneId, { state: 'waiting' });
    return generateOne(sceneId, ol, index, extra);
  }

  function cancelScene(sceneId: string) {
    const j = jobs.value.find((x) => x.sceneId === sceneId);
    if (!j) return;
    if (j.state === 'waiting') setJob(sceneId, { state: 'cancelled' });
    if (j.state === 'running' && j.requestId) aiSession().cancel(j.requestId);
  }

  function cancelAll() {
    for (const j of jobs.value) cancelScene(j.sceneId);
  }

  const outlineFromStoryboard = (): Outline => ({
    title: project.storyboard!.meta.title,
    scenes: project.storyboard!.scenes.map((s, i) => ({
      title: s.title || `场景 ${i + 1}`,
      description: s.description,
      duration: Math.max(1, s.steps.reduce((a, st) => a + st.duration, 0) + s.hold),
    })),
  });

  // ---------- 自然语言修改（待确认） ----------

  async function edit(instruction: string, scope: EditScope, title = 'AI 修改') {
    if (!project.storyboard) return;
    const s = aiSession();
    const base = project.storyboard;
    editBusy.value = true;
    editError.value = null;
    editReq = newId('req');
    if (scope.kind === 'scene') ai.setBusy(scope.sceneId, true);
    try {
      const r = await runTask(
        s.transport,
        {
          task: 'edit',
          title,
          messages: editMessages(base, instruction, scope),
          check: (d) => checkEdit(d, base, scope),
          requestId: editReq,
        },
        s.log,
      );
      pending.value = { title, base, result: r.value };
      previewProposed.value = true;
    } catch (e) {
      editError.value = { message: describe(e), lastText: e instanceof AiError ? e.lastText : undefined };
    } finally {
      editBusy.value = false;
      editReq = null;
      if (scope.kind === 'scene') ai.setBusy(scope.sceneId, false);
    }
  }

  /** 单场景按额外要求重新生成，结果同样进入待确认 */
  async function regenerateScene(sceneId: string, extra: string) {
    const sb = project.storyboard!;
    const index = sb.scenes.findIndex((x) => x.id === sceneId);
    const ol = outlineFromStoryboard();
    const s = aiSession();
    editBusy.value = true;
    editError.value = null;
    ai.setBusy(sceneId, true);
    try {
      const r = await runTask(
        s.transport,
        {
          task: 'scene',
          title: `重新生成场景 ${index + 1}`,
          messages: sceneMessages({
            outline: ol,
            index,
            sceneId,
            source: source.value,
            params: params(),
            extra,
          }),
          check: (d) => checkScene(d, sceneId, sb.meta),
        },
        s.log,
      );
      pending.value = {
        title: `重新生成场景 ${index + 1}`,
        base: sb,
        result: { storyboard: updateScene(sb, sceneId, () => r.value), changed: [sceneId], skipped: [] },
      };
      previewProposed.value = true;
    } catch (e) {
      editError.value = { message: describe(e), lastText: e instanceof AiError ? e.lastText : undefined };
    } finally {
      editBusy.value = false;
      ai.setBusy(sceneId, false);
    }
  }

  function cancelEdit() {
    if (editReq) aiSession().cancel(editReq);
  }

  /** 接受：先写快照，再作为一次普通修改应用（仍可撤销）。期间用户又改了分镜时拒绝覆盖 */
  async function accept(): Promise<boolean> {
    const p = pending.value;
    if (!p || !project.storyboard) return false;
    if (project.storyboard !== p.base) return false;
    await project.snapshot('ai-edit');
    project.update(p.result.storyboard);
    pending.value = null;
    return true;
  }

  function reject() {
    pending.value = null;
  }

  return {
    source,
    intent,
    outline,
    outlineText,
    outlineBusy,
    outlineError,
    streamingOutline,
    jobs,
    running,
    editBusy,
    editError,
    pending,
    previewProposed,
    generateOutline,
    cancelOutline,
    generateScenes,
    retryScene,
    cancelScene,
    cancelAll,
    edit,
    regenerateScene,
    cancelEdit,
    accept,
    reject,
  };
});
