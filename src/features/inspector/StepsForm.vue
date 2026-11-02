<script setup lang="ts">
import { NButton, NEmpty, NInputNumber, NSelect, NTooltip } from 'naive-ui';
import { computed, ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { describeObject } from '../../shared/fields';
import { newId } from '../../shared/id';
import { ANIMS, ANIM_TYPES, type AnimType } from '../../shared/registry';
import { RATES, type Anim, type Step } from '../../shared/schema';
import { useEditorStore } from '../../stores/editor';
import FieldInput from './FieldInput.vue';
import { useSceneEdit } from './useSceneEdit';

const editor = useEditorStore();
const { patch, refIds, issuesAt } = useSceneEdit();
const scene = computed(() => editor.scene!);
const base = computed(() => `scenes[${editor.sceneIndex}].steps`);

const LC_LABEL = { enter: '出场', exit: '离场', transform: '变换', other: '强调/移动' } as const;
const animOptions = (['enter', 'exit', 'transform', 'other'] as const).map((lc) => ({
  type: 'group',
  label: LC_LABEL[lc],
  key: lc,
  children: ANIM_TYPES.filter((t) => ANIMS[t].lifecycle === lc).map((t) => ({
    label: `${ANIMS[t].label} ${t}`,
    value: t,
  })),
}));
type Rate = (typeof RATES)[number];
const rateOptions = RATES.map((r) => ({ label: r, value: r }));
const idOptions = computed(() => refIds.value.map((id) => ({ label: id, value: id })));

// 拖拽排序用本地副本，结束时写回
const list = ref<Step[]>([]);
watch(
  () => scene.value.steps,
  (s) => (list.value = [...s]),
  { immediate: true },
);
const onReorder = () => patch('reorder', (s) => ({ ...s, steps: [...list.value] }));

function editStep(id: string, field: string, fn: (st: Step) => Step) {
  patch(`step:${id}:${field}`, (s) => ({ ...s, steps: s.steps.map((st) => (st.id === id ? fn(st) : st)) }));
}
function editAnim(stepId: string, k: number, field: string, fn: (a: Anim) => Anim) {
  editStep(stepId, `a${k}.${field}`, (st) =>
    st.kind === 'play' ? { ...st, anims: st.anims.map((a, i) => (i === k ? fn(a) : a)) } : st,
  );
}

function setType(stepId: string, k: number, type: AnimType) {
  editAnim(stepId, k, 'type', (a) => {
    const next: Anim = { type, target: a.target };
    if (ANIMS[type].lifecycle === 'transform')
      next.to = a.to ?? refIds.value.find((x) => x !== a.target) ?? a.target;
    const params = describeObject(ANIMS[type].params);
    if (params.length) next.params = Object.fromEntries(params.map((f) => [f.key, defaultFor(f.kind)]));
    return next;
  });
}
const defaultFor = (kind: string) =>
  kind === 'vec2' ? [1, 0] : kind === 'color' ? '$accent' : kind === 'number' ? 1 : '';

const taken = () => new Set(scene.value.steps.map((s) => s.id));
function addStep(kind: 'play' | 'wait') {
  const id = newId('st', taken());
  const step: Step =
    kind === 'wait'
      ? { id, kind: 'wait', duration: 1 }
      : {
          id,
          kind: 'play',
          anims: [{ type: 'FadeIn', target: scene.value.elements[0]?.id ?? refIds.value[0] ?? 'x' }],
          duration: 1,
        };
  patch(`addstep:${id}`, (s) => ({ ...s, steps: [...s.steps, step] }));
  editor.stepId = id;
}
const removeStep = (id: string) =>
  patch(`delstep:${id}`, (s) => ({ ...s, steps: s.steps.filter((x) => x.id !== id) }));
const addAnim = (st: Step) =>
  editStep(st.id, 'addanim', (x) =>
    x.kind === 'play'
      ? { ...x, anims: [...x.anims, { type: 'Indicate', target: refIds.value[0] ?? 'x' }] }
      : x,
  );
const removeAnim = (st: Step, k: number) =>
  editStep(st.id, `delanim${k}`, (x) =>
    x.kind === 'play' ? { ...x, anims: x.anims.filter((_, i) => i !== k) } : x,
  );

const stepIndex = (id: string) => scene.value.steps.findIndex((s) => s.id === id);
const rowIssues = (id: string, k?: number) =>
  issuesAt(`${base.value}[${stepIndex(id)}]${k === undefined ? '' : `.anims[${k}]`}`).filter(
    (x) => k !== undefined || !x.path.includes('.anims['),
  );
</script>

<template>
  <div class="steps" data-testid="steps-form">
    <div class="add">
      <NButton size="small" type="primary" data-testid="add-play" @click="addStep('play')"
        >＋ 动画步骤</NButton
      >
      <NButton size="small" @click="addStep('wait')">＋ 等待</NButton>
    </div>
    <NEmpty v-if="!scene.steps.length" description="还没有步骤。元素需要出场动画（如淡入、书写）才会显示。" />
    <VueDraggable v-model="list" handle=".handle" :animation="150" @end="onReorder">
      <div
        v-for="(st, j) in list"
        :key="st.id"
        class="step"
        :class="{ selected: st.id === editor.stepId }"
        @click="editor.stepId = st.id"
      >
        <div class="head">
          <span class="handle" title="拖动排序" aria-hidden="true">⠿</span>
          <strong>{{ j + 1 }}. {{ st.kind === 'play' ? '动画' : '等待' }}</strong>
          <NInputNumber
            size="tiny"
            class="dur"
            :show-button="false"
            :value="st.duration"
            :min="st.kind === 'play' ? 0.1 : 0"
            :max="30"
            :step="0.1"
            :input-props="{ 'aria-label': '时长（秒）' }"
            @update:value="
              (v: number | null) => editStep(st.id, 'duration', (x) => ({ ...x, duration: v ?? 1 }))
            "
          >
            <template #suffix>s</template>
          </NInputNumber>
          <template v-if="st.kind === 'play'">
            <NSelect
              size="tiny"
              class="rate"
              clearable
              placeholder="smooth"
              :value="st.rate ?? null"
              :options="rateOptions"
              aria-label="速度曲线"
              @update:value="
                (v: Rate | null) =>
                  editStep(st.id, 'rate', (x) => (x.kind === 'play' ? { ...x, rate: v ?? undefined } : x))
              "
            />
            <NTooltip v-if="st.anims.length > 1">
              <template #trigger>
                <NInputNumber
                  size="tiny"
                  class="lag"
                  :show-button="false"
                  clearable
                  :value="st.lag"
                  :min="0"
                  :max="1"
                  :step="0.1"
                  placeholder="错开"
                  :input-props="{ 'aria-label': '错开比例' }"
                  @update:value="
                    (v: number | null) =>
                      editStep(st.id, 'lag', (x) => (x.kind === 'play' ? { ...x, lag: v ?? undefined } : x))
                  "
                />
              </template>
              错开比例 0–1：0 为同时开始，1 为依次播放
            </NTooltip>
          </template>
          <NButton size="tiny" quaternary aria-label="删除步骤" @click.stop="removeStep(st.id)">✕</NButton>
        </div>
        <p v-for="(x, k) in rowIssues(st.id)" :key="`s${k}`" class="issue">{{ x.message }}</p>
        <template v-if="st.kind === 'play'">
          <div v-for="(a, k) in st.anims" :key="k" class="anim">
            <div class="row">
              <NSelect
                size="tiny"
                :value="a.type"
                :options="animOptions"
                filterable
                aria-label="动画类型"
                :input-props="{ 'aria-label': '动画类型' }"
                @update:value="(v: AnimType) => setType(st.id, k, v)"
              />
              <NSelect
                size="tiny"
                :value="a.target"
                :options="idOptions"
                filterable
                aria-label="目标元素"
                :input-props="{ 'aria-label': '目标元素' }"
                @update:value="(v: string) => editAnim(st.id, k, 'target', (x) => ({ ...x, target: v }))"
              />
              <template v-if="ANIMS[a.type].lifecycle === 'transform'">
                <span>→</span>
                <NSelect
                  size="tiny"
                  :value="a.to"
                  :options="idOptions"
                  filterable
                  aria-label="变为"
                  :input-props="{ 'aria-label': '变为' }"
                  @update:value="(v: string) => editAnim(st.id, k, 'to', (x) => ({ ...x, to: v }))"
                />
              </template>
              <NButton size="tiny" quaternary aria-label="删除动画" @click.stop="removeAnim(st, k)"
                >✕</NButton
              >
            </div>
            <div v-for="f in describeObject(ANIMS[a.type].params)" :key="f.key" class="row param">
              <span class="pkey">{{ f.key }}</span>
              <FieldInput
                :field="f"
                :value="a.params?.[f.key]"
                @update:value="
                  (v) => editAnim(st.id, k, f.key, (x) => ({ ...x, params: { ...x.params, [f.key]: v } }))
                "
              />
            </div>
            <p v-for="(x, m) in rowIssues(st.id, k)" :key="m" class="issue">{{ x.message }}</p>
          </div>
          <NButton size="tiny" dashed @click.stop="addAnim(st)">＋ 同时播放另一个动画</NButton>
        </template>
      </div>
    </VueDraggable>
  </div>
</template>

<style scoped>
.add {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.step {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 6px;
  margin-bottom: 6px;
}
.step.selected {
  border-color: #63e2b7;
}
.head,
.row {
  display: flex;
  gap: 4px;
  align-items: center;
}
.head strong {
  font-size: 12px;
  white-space: nowrap;
}
.handle {
  cursor: grab;
  opacity: 0.6;
}
.dur {
  width: 84px;
}
.rate {
  width: 110px;
}
.lag {
  width: 76px;
}
.anim {
  margin: 4px 0 4px 14px;
}
.param {
  margin: 2px 0 0 8px;
}
.pkey {
  font-size: 12px;
  min-width: 48px;
  opacity: 0.75;
}
.issue {
  color: #ff8a80;
  font-size: 12px;
  margin: 2px 0;
}
</style>
