<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any -- 字段值类型由 field.kind 决定 */
import { NButton, NInput, NInputNumber, NSelect } from 'naive-ui';
import { computed } from 'vue';
import type { Field } from '../../shared/fields';
import ColorInput from './ColorInput.vue';

const props = defineProps<{ field: Field; value: any; refOptions?: string[] }>();
const emit = defineEmits<{ 'update:value': [any] }>();

const set = (v: unknown) => emit('update:value', v);
const shown = computed(() => props.value ?? props.field.defaultValue);
const multiline = computed(() => ['text', 'latex', 'expr'].includes(props.field.key));
const refOpts = computed(() => (props.refOptions ?? []).map((id) => ({ label: id, value: id })));
const tupleAt = (i: number, v: number | null, len: number) => {
  const cur = [...((shown.value as number[] | undefined) ?? Array(len).fill(0))];
  cur[i] = v ?? 0;
  set(cur);
};
const points = computed<number[][]>(() => (shown.value as number[][] | undefined) ?? []);
const setPoint = (i: number, j: number, v: number | null) =>
  set(points.value.map((p, k) => (k === i ? p.map((x, m) => (m === j ? (v ?? 0) : x)) : p)));
</script>

<template>
  <NInputNumber
    v-if="field.kind === 'number'"
    size="small"
    :value="shown"
    :min="field.positive ? 0.01 : field.min"
    :step="0.1"
    :clearable="field.optional"
    :placeholder="field.defaultValue !== undefined ? `默认 ${field.defaultValue}` : ''"
    @update:value="set"
  />
  <NInput
    v-else-if="field.kind === 'text'"
    size="small"
    :type="multiline ? 'textarea' : 'text'"
    :autosize="multiline ? { minRows: 1, maxRows: 4 } : undefined"
    :value="shown ?? ''"
    @update:value="set"
  />
  <ColorInput
    v-else-if="field.kind === 'color'"
    :value="shown"
    :clearable="field.optional"
    @update:value="set"
  />
  <NSelect
    v-else-if="field.kind === 'enum'"
    size="small"
    :value="shown"
    :options="(field.options ?? []).map((o) => ({ label: o, value: o }))"
    @update:value="set"
  />
  <NSelect
    v-else-if="field.kind === 'ref' || field.kind === 'refs'"
    size="small"
    :value="shown"
    :options="refOpts"
    :multiple="field.kind === 'refs'"
    :clearable="field.optional"
    filterable
    @update:value="set"
  />
  <div v-else-if="field.kind === 'vec2' || field.kind === 'range3'" class="tuple">
    <NInputNumber
      v-for="i in field.kind === 'vec2' ? 2 : 3"
      :key="i"
      size="small"
      :step="0.1"
      :show-button="false"
      :value="shown?.[i - 1]"
      :placeholder="field.kind === 'vec2' ? ['x', 'y'][i - 1] : ['最小', '最大', '间隔'][i - 1]"
      @update:value="(v: number | null) => tupleAt(i - 1, v, field.kind === 'vec2' ? 2 : 3)"
    />
    <NButton v-if="field.optional && shown" size="tiny" quaternary aria-label="清除" @click="set(undefined)"
      >✕</NButton
    >
  </div>
  <div v-else-if="field.kind === 'points'" class="points">
    <div v-for="(p, i) in points" :key="i" class="tuple">
      <NInputNumber
        v-for="j in 2"
        :key="j"
        size="small"
        :show-button="false"
        :step="0.1"
        :value="p[j - 1]"
        @update:value="(v: number | null) => setPoint(i, j - 1, v)"
      />
      <NButton
        size="tiny"
        quaternary
        :aria-label="`删除第 ${i + 1} 个点`"
        @click="set(points.filter((_, k) => k !== i))"
      >
        ✕
      </NButton>
    </div>
    <NButton size="tiny" dashed @click="set([...points, [0, 0]])">＋ 添加顶点</NButton>
  </div>
</template>

<style scoped>
.tuple {
  display: flex;
  gap: 4px;
  align-items: center;
  width: 100%;
}
.points {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}
</style>
