<script setup lang="ts">
import {
  NAlert,
  NButton,
  NDivider,
  NInput,
  NInputNumber,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NSwitch,
  NTag,
  useDialog,
  useMessage,
} from 'naive-ui';
import { computed, ref, watch } from 'vue';
import { dispatchGenerate, usesAgenticEngine } from '../../ai/agent/engine';
import { runProjectAgent } from '../../ai/agent/run';
import type { Outline } from '../../ai/prompts';
import { checkScene } from '../../ai/validators';
import { describeError, LLM_ERRORS } from '../../shared/errors';
import { updateScene } from '../../shared/ops';
import { COMPLEXITIES, CONTENT_TYPES } from '../../shared/project';
import type { Scene } from '../../shared/schema';
import { useAiStore } from '../../stores/ai';
import { useEditorStore } from '../../stores/editor';
import { useGenerationStore, type SceneJobState } from '../../stores/generation';
import { useProjectStore } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { platform } from '../../platform';
import ManualFixDialog from './ManualFixDialog.vue';

const gen = useGenerationStore();
const project = useProjectStore();
const editor = useEditorStore();
const ai = useAiStore();
const message = useMessage();
const dialog = useDialog();
const settings = useSettingsStore();

/** API 模式下还没有 Key 时给出引导（UX-10：没有 Key 也能用手动模式走通） */
const hasKey = ref(true);
async function refreshKey() {
  hasKey.value =
    settings.ai.mode === 'manual' ||
    (await platform.secretStatus(settings.ai.providerId).then(
      (s) => s.exists,
      () => false,
    ));
}
watch(
  () => [settings.ai.mode, settings.ai.providerId, editor.settingsOpen, settings.loaded],
  () => void refreshKey(),
  {
    immediate: true,
  },
);

const instruction = ref('');
const scope = ref<'scene' | 'all'>('scene');
const fixing = ref<{ sceneId: string; text: string } | null>(null);
const agentBusy = ref(false);
const agentNote = ref('');
let agentAbort: AbortController | null = null;

/** 只有 engine=agentic 且代码场景打开时才离开旧大纲管线。 */
const agentic = computed(() => usesAgenticEngine(settings.engine, settings.runtime.codeScenes));
const sourcePlaceholder = computed(() =>
  agentic.value
    ? '写下整片需求。这段原文会当作指令，Agent 先写 plan，再写每场代码。'
    : '粘贴要讲解的内容：教材段落、题目、代码、文案……（也可以在"素材"页导入文件）',
);

const gp = computed(() => project.project!.generation);
const setGen = (patch: Partial<typeof gp.value>) =>
  project.updateProject({ generation: { ...gp.value, ...patch } });
const COMPLEXITY = { simple: '简单', medium: '适中', complex: '复杂' } as const;
const TYPES = {
  math: '数学',
  physics: '物理',
  algorithm: '算法与代码',
  story: '故事文案',
  general: '通用',
} as const;

const outlineCards = computed<Outline['scenes']>(() => gen.outline?.scenes ?? gen.streamingOutline);
const errText = (code?: string) =>
  code ? (LLM_ERRORS[code]?.what ?? (code === 'validation' ? '输出格式多次不合格' : code)) : '';

async function runAgentEntry() {
  if (agentBusy.value) return;
  agentBusy.value = true;
  agentNote.value = '正在写 plan…';
  const ac = new AbortController();
  agentAbort = ac;
  try {
    const result = await runProjectAgent(gen.source, {
      signal: ac.signal,
      onPhase: (phase) => {
        agentNote.value = phase === 'plan' ? '正在写 plan…' : '正在写场景代码…';
      },
    });
    if (ac.signal.aborted || result.status === 'cancelled') {
      agentNote.value = '已取消';
      return;
    }
    if (result.status === 'done') {
      const skipped = result.skippedLocked.length ? `，跳过 ${result.skippedLocked.length} 个锁定场景` : '';
      agentNote.value = `已写入 ${result.sceneIds.length} 个代码场景${skipped}`;
      message.success(agentNote.value);
      return;
    }
    if (result.status === 'budget') {
      agentNote.value = '已达到轮数或用量上限';
      message.warning(agentNote.value);
      return;
    }
    agentNote.value = result.error ?? 'Agent 失败';
    message.error(agentNote.value);
  } finally {
    agentBusy.value = false;
    if (agentAbort === ac) agentAbort = null;
  }
}

function cancelAgent() {
  agentAbort?.abort();
}

async function makeOutline() {
  if (!gen.source.trim()) {
    return message.warning(agentic.value ? '先写下整片需求' : '先在上面粘贴素材，或在"素材"页导入文件');
  }
  await dispatchGenerate({
    engine: settings.engine,
    codeScenes: settings.runtime.codeScenes,
    legacy: async () => {
      try {
        await gen.generateOutline();
      } catch (e) {
        const d = describeError((e as { llm?: unknown }).llm ?? e);
        if ((e as { llm?: { code?: string } }).llm?.code !== 'cancelled')
          message.error(`${d.what}。${d.next}`, { duration: 8000 });
      }
    },
    agent: () => runAgentEntry(),
  });
}

function editOutline(i: number, patch: Partial<Outline['scenes'][number]>) {
  const ol = gen.outline!;
  gen.outline = { ...ol, scenes: ol.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) };
}
function moveOutline(i: number, d: number) {
  const s = [...gen.outline!.scenes];
  const [x] = s.splice(i, 1);
  s.splice(i + d, 0, x!);
  gen.outline = { ...gen.outline!, scenes: s };
}
const removeOutline = (i: number) =>
  (gen.outline = { ...gen.outline!, scenes: gen.outline!.scenes.filter((_, k) => k !== i) });
const addOutline = () =>
  (gen.outline = {
    ...gen.outline!,
    scenes: [...gen.outline!.scenes, { title: '新场景', description: '', duration: 8 }],
  });

function makeScenes() {
  const run = (mode: 'replace' | 'append') => void gen.generateScenes(mode);
  if (!project.storyboard?.scenes.length) return run('replace');
  dialog.info({
    title: '生成场景',
    content: '当前分镜已经有场景。要替换它们，还是追加到末尾？（替换前会自动保存快照）',
    positiveText: '替换',
    negativeText: '追加到末尾',
    onPositiveClick: () => run('replace'),
    onNegativeClick: () => run('append'),
  });
}

const STATE: Record<
  SceneJobState,
  { label: string; type: 'default' | 'info' | 'success' | 'error' | 'warning' }
> = {
  waiting: { label: '排队中', type: 'default' },
  running: { label: '生成中', type: 'info' },
  done: { label: '完成', type: 'success' },
  error: { label: '失败', type: 'error' },
  cancelled: { label: '已取消', type: 'warning' },
};
const titleOf = (id: string) => project.storyboard?.scenes.find((s) => s.id === id)?.title ?? id;

async function send() {
  if (!instruction.value.trim() || gen.editBusy) return;
  const s =
    scope.value === 'scene' && editor.sceneId
      ? { kind: 'scene' as const, sceneId: editor.sceneId }
      : { kind: 'all' as const };
  await gen.edit(instruction.value.trim(), s);
  if (!gen.editError) instruction.value = '';
}
watch(
  () => editor.sendSignal,
  () => void send(),
);

async function accept() {
  if (await gen.accept()) message.success('已应用，可以用 Ctrl+Z 撤销');
  else message.warning('等待期间分镜被修改过，这个结果已过期，请重新发送指令');
}

function applyFix(scene: Scene) {
  project.update(updateScene(project.storyboard!, fixing.value!.sceneId, () => scene));
  gen.jobs = gen.jobs.map((j) => (j.sceneId === fixing.value!.sceneId ? { ...j, state: 'done' } : j));
  fixing.value = null;
}
</script>

<template>
  <div class="ai" data-testid="ai-panel">
    <NAlert v-if="!hasKey" type="warning" :show-icon="false" class="first" data-testid="no-key">
      还没有配置 API Key。
      <NSpace class="gap">
        <NButton size="tiny" type="primary" @click="editor.settingsOpen = true">打开 AI 设置</NButton>
        <NButton size="tiny" @click="settings.ai.mode = 'manual'">改用手动模式（无需 Key）</NButton>
      </NSpace>
    </NAlert>
    <h3>从素材生成</h3>
    <div v-if="settings.runtime.codeScenes" class="engine" data-testid="agent-engine">
      <NSwitch
        :value="settings.engine === 'agentic'"
        size="small"
        aria-label="Agent 生成"
        data-testid="agent-engine-switch"
        @update:value="(v: boolean) => (settings.engine = v ? 'agentic' : 'legacy')"
      />
      <span>Agent 写代码场景</span>
    </div>
    <NInput
      v-model:value="gen.source"
      type="textarea"
      :autosize="{ minRows: 3, maxRows: 8 }"
      :placeholder="sourcePlaceholder"
      :input-props="{ 'aria-label': '素材' }"
      data-testid="source-text"
    />
    <div class="params">
      <label>
        时长
        <NInputNumber
          size="tiny"
          :value="gp.targetDuration"
          :min="10"
          :max="600"
          :step="10"
          :show-button="false"
          :input-props="{ 'aria-label': '目标时长（秒）' }"
          @update:value="(v: number | null) => setGen({ targetDuration: v ?? 60 })"
        >
          <template #suffix>秒</template>
        </NInputNumber>
      </label>
      <NSelect
        size="tiny"
        :value="gp.complexity"
        :options="COMPLEXITIES.map((c) => ({ label: COMPLEXITY[c], value: c }))"
        aria-label="复杂度"
        @update:value="(v: 'medium') => setGen({ complexity: v })"
      />
      <NSelect
        size="tiny"
        :value="gp.contentType"
        :options="CONTENT_TYPES.map((c) => ({ label: TYPES[c], value: c }))"
        aria-label="内容类型"
        @update:value="(v: 'general') => setGen({ contentType: v })"
      />
    </div>
    <NSpace>
      <NButton
        type="primary"
        size="small"
        :loading="gen.outlineBusy || agentBusy"
        :disabled="gen.outlineBusy || gen.running || agentBusy"
        data-testid="gen-outline"
        @click="makeOutline"
      >
        {{ agentic ? '生成整片' : '1. 生成大纲' }}
      </NButton>
      <NButton v-if="agentBusy" size="small" data-testid="cancel-agent" @click="cancelAgent">取消</NButton>
      <NButton v-if="gen.outlineBusy" size="small" @click="gen.cancelOutline()">取消</NButton>
    </NSpace>
    <p v-if="agentNote" class="muted" data-testid="agent-note">{{ agentNote }}</p>

    <ol v-if="outlineCards.length" class="outline" data-testid="outline">
      <li v-for="(s, i) in outlineCards" :key="i">
        <template v-if="gen.outline && !gen.outlineBusy">
          <div class="row">
            <NInput
              size="tiny"
              :value="s.title"
              :input-props="{ 'aria-label': `场景 ${i + 1} 标题` }"
              @update:value="(v: string) => editOutline(i, { title: v })"
            />
            <NInputNumber
              size="tiny"
              class="sec"
              :show-button="false"
              :value="s.duration"
              :min="1"
              :max="120"
              :input-props="{ 'aria-label': `场景 ${i + 1} 时长` }"
              @update:value="(v: number | null) => editOutline(i, { duration: v ?? 5 })"
            >
              <template #suffix>s</template>
            </NInputNumber>
          </div>
          <NInput
            size="tiny"
            type="textarea"
            :autosize="{ minRows: 1, maxRows: 4 }"
            :value="s.description"
            :input-props="{ 'aria-label': `场景 ${i + 1} 描述` }"
            @update:value="(v: string) => editOutline(i, { description: v })"
          />
          <div class="ops">
            <NButton size="tiny" quaternary :disabled="i === 0" aria-label="上移" @click="moveOutline(i, -1)"
              >↑</NButton
            >
            <NButton
              size="tiny"
              quaternary
              :disabled="i === outlineCards.length - 1"
              aria-label="下移"
              @click="moveOutline(i, 1)"
              >↓</NButton
            >
            <NButton size="tiny" quaternary aria-label="删除" @click="removeOutline(i)">✕</NButton>
          </div>
        </template>
        <template v-else>
          <strong>{{ s.title }}</strong> <span class="muted">{{ s.duration }}s</span>
          <p class="muted">{{ s.description }}</p>
        </template>
      </li>
    </ol>
    <NSpace v-if="gen.outline && !gen.outlineBusy" class="gap">
      <NButton size="tiny" dashed @click="addOutline">＋ 场景</NButton>
      <NButton
        type="primary"
        size="small"
        :disabled="gen.running"
        data-testid="gen-scenes"
        @click="makeScenes"
      >
        2. 逐个生成场景
      </NButton>
    </NSpace>

    <div v-if="gen.jobs.length" class="jobs" data-testid="jobs">
      <div class="jobs-head">
        <span>场景生成</span>
        <NButton v-if="gen.running" size="tiny" @click="gen.cancelAll()">全部取消</NButton>
      </div>
      <div v-for="j in gen.jobs" :key="j.sceneId" class="job">
        <NTag size="small" :type="STATE[j.state].type"
          >{{ STATE[j.state].label
          }}{{ j.state === 'running' && j.attempt > 1 ? `（修复 ${j.attempt - 1}）` : '' }}</NTag
        >
        <span class="jt">{{ titleOf(j.sceneId) }}</span>
        <NButton
          v-if="j.state === 'running' || j.state === 'waiting'"
          size="tiny"
          quaternary
          @click="gen.cancelScene(j.sceneId)"
          >取消</NButton
        >
        <NButton
          v-if="j.state === 'error' || j.state === 'cancelled'"
          size="tiny"
          quaternary
          @click="gen.retryScene(j.sceneId)"
          >重试</NButton
        >
        <NButton
          v-if="j.lastText"
          size="tiny"
          quaternary
          @click="fixing = { sceneId: j.sceneId, text: j.lastText }"
          >手动修改</NButton
        >
        <div v-if="j.error" class="err">{{ errText(j.error) }}</div>
      </div>
    </div>

    <NDivider />
    <h3>用一句话修改</h3>
    <NRadioGroup v-model:value="scope" size="small">
      <NRadioButton value="scene" :disabled="!editor.sceneId">选中的场景</NRadioButton>
      <NRadioButton value="all">全片</NRadioButton>
    </NRadioGroup>
    <NInput
      v-model:value="instruction"
      type="textarea"
      class="gap"
      :autosize="{ minRows: 2, maxRows: 6 }"
      placeholder="例如：把圆改成蓝色，时长延长 2 秒（Ctrl+Enter 发送）"
      :input-props="{ 'aria-label': '修改指令' }"
      data-testid="edit-instruction"
    />
    <NSpace>
      <NButton
        type="primary"
        size="small"
        :loading="gen.editBusy"
        :disabled="gen.editBusy || !instruction.trim() || !!gen.pending"
        data-testid="send-edit"
        @click="send"
      >
        发送
      </NButton>
      <NButton v-if="gen.editBusy" size="small" @click="gen.cancelEdit()">取消</NButton>
      <span class="muted">{{ ai.modelLabel }}</span>
    </NSpace>
    <NAlert v-if="gen.editError" type="error" :show-icon="false" class="gap">
      {{ errText(gen.editError.message) }}
    </NAlert>

    <NAlert v-if="gen.pending" type="info" :show-icon="false" class="gap pending" data-testid="pending">
      <strong>{{ gen.pending.title }}：待确认</strong>
      <p>
        改动了 {{ gen.pending.result.changed.length }} 个场景：{{
          gen.pending.result.changed.map(titleOf).join('、') || '无'
        }}
      </p>
      <p v-for="(s, k) in gen.pending.result.skipped" :key="k" class="muted">· {{ s }}</p>
      <NRadioGroup v-model:value="gen.previewProposed" size="small" class="gap">
        <NRadioButton :value="true">预览修改后</NRadioButton>
        <NRadioButton :value="false">预览修改前</NRadioButton>
      </NRadioGroup>
      <NSpace class="gap">
        <NButton type="primary" size="small" data-testid="accept-edit" @click="accept">接受</NButton>
        <NButton size="small" data-testid="reject-edit" @click="gen.reject()">拒绝</NButton>
      </NSpace>
    </NAlert>

    <ManualFixDialog
      :text="fixing?.text ?? null"
      title="手动修正 AI 生成的场景"
      :check="(d: unknown) => checkScene(d, fixing!.sceneId, project.storyboard!.meta)"
      @apply="applyFix"
      @close="fixing = null"
    />
  </div>
</template>

<style scoped>
h3 {
  font-size: 13px;
  margin: 0 0 8px;
}
.engine {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  font-size: 12px;
}
.params {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 4px;
  margin: 6px 0 8px;
  font-size: 12px;
}
.params label {
  display: flex;
  flex-direction: column;
}
.outline {
  padding-left: 18px;
  margin: 8px 0;
  font-size: 12px;
}
.outline li {
  margin-bottom: 8px;
}
.row {
  display: flex;
  gap: 4px;
  margin-bottom: 2px;
}
.sec {
  width: 70px;
}
.ops {
  display: flex;
  justify-content: flex-end;
}
.muted {
  color: rgba(255, 255, 255, 0.65);
  font-size: 12px;
  margin: 2px 0;
}
.gap {
  margin-top: 8px;
}
.first {
  margin-bottom: 12px;
}
.jobs {
  margin-top: 10px;
  font-size: 12px;
}
.jobs-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}
.job {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}
.jt {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.err {
  width: 100%;
  color: #ff8a80;
}
.pending p {
  margin: 4px 0;
  font-size: 12px;
}
</style>
