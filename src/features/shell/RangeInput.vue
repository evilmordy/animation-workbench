<script setup lang="ts">
/** 原生 range 滑块：自带键盘操作和可访问名称（Naive UI 的 NSlider 手柄无法设置名称） */
defineProps<{ value: number; min: number; max: number; step: number; label: string }>();
const emit = defineEmits<{ 'update:value': [number] }>();
</script>

<template>
  <input
    type="range"
    class="range"
    :value="value"
    :min="min"
    :max="max"
    :step="step"
    :aria-label="label"
    @input="emit('update:value', Number(($event.target as HTMLInputElement).value))"
  />
</template>

<style scoped>
.range {
  width: 100%;
  accent-color: #63e2b7;
  cursor: pointer;
}
.range:focus-visible {
  outline: 2px solid #70c0e8;
}
</style>
