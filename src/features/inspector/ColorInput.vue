<script setup lang="ts">
import { NColorPicker, NSelect } from 'naive-ui';
import { computed } from 'vue';
import { PALETTE_TOKENS } from '../../shared/registry';

const props = defineProps<{ value?: string; clearable?: boolean }>();
const emit = defineEmits<{ 'update:value': [string | undefined] }>();

const TOKEN_LABEL: Record<string, string> = {
  primary: '主色',
  secondary: '辅色',
  accent: '强调色',
  text: '文字色',
  muted: '弱化色',
};
const options = [
  ...PALETTE_TOKENS.map((t) => ({ label: `${TOKEN_LABEL[t]}（$${t}）`, value: `$${t}` })),
  { label: '自定义颜色…', value: 'custom' },
];
const isCustom = computed(() => !!props.value && !props.value.startsWith('$'));
const select = computed(() => (isCustom.value ? 'custom' : (props.value ?? null)));

function onSelect(v: string | null) {
  if (v === 'custom') emit('update:value', isCustom.value ? props.value : '#FFFFFF');
  else emit('update:value', v ?? undefined);
}
</script>

<template>
  <div class="color">
    <NSelect
      size="small"
      :value="select"
      :options="options"
      :clearable="clearable"
      placeholder="默认"
      @update:value="onSelect"
    />
    <NColorPicker
      v-if="isCustom"
      size="small"
      :value="value"
      :modes="['hex']"
      :show-alpha="false"
      @update:value="(v: string) => emit('update:value', v.slice(0, 7).toUpperCase())"
    />
  </div>
</template>

<style scoped>
.color {
  display: flex;
  gap: 6px;
  width: 100%;
}
</style>
