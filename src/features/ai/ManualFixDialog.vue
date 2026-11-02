<script setup lang="ts" generic="T">
import { NAlert, NButton, NInput, NModal, NSpace } from 'naive-ui';
import { computed, ref, watch } from 'vue';
import { extractJson } from '../../ai/extract';
import type { Checked } from '../../ai/validators';

/** AI 输出经过自动修复仍不合格时，让用户手动修改 JSON（实时校验，合格后才能应用） */
const props = defineProps<{ text: string | null; title: string; check: (data: unknown) => Checked<T> }>();
const emit = defineEmits<{ apply: [T]; close: [] }>();

const draft = ref('');
watch(
  () => props.text,
  (t) => {
    if (t === null) return;
    const r = extractJson(t);
    draft.value = r.ok ? JSON.stringify(r.value, null, 2) : t;
  },
  { immediate: true },
);

const result = computed(() => {
  const r = extractJson(draft.value);
  return r.ok ? props.check(r.value) : { issues: [r.error] };
});
</script>

<template>
  <NModal :show="text !== null" preset="card" :title="title" style="width: 760px" @close="emit('close')">
    <NInput
      v-model:value="draft"
      type="textarea"
      :autosize="{ minRows: 12, maxRows: 22 }"
      class="mono"
      :input-props="{ 'aria-label': '待修正的 JSON' }"
    />
    <NAlert v-if="result.issues.length" type="error" :show-icon="false" class="gap">
      <div v-for="(i, k) in result.issues.slice(0, 12)" :key="k">{{ i }}</div>
    </NAlert>
    <NAlert v-else type="success" :show-icon="false" class="gap">校验通过</NAlert>
    <template #action>
      <NSpace justify="end">
        <NButton @click="emit('close')">取消</NButton>
        <NButton type="primary" :disabled="!!result.issues.length" @click="emit('apply', result.value as T)"
          >应用</NButton
        >
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.mono :deep(textarea) {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.gap {
  margin-top: 8px;
}
</style>
