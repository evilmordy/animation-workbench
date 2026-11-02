<script setup lang="ts" generic="K extends string">
/** 可访问的标签栏：role=tablist/tab、方向键切换（Naive UI 的 NTabs 不暴露这些语义） */
const props = defineProps<{ items: { key: K; label: string }[]; modelValue: K; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [K] }>();

function onKey(e: KeyboardEvent, i: number) {
  const n = props.items.length;
  const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : -1;
  if (next < 0) return;
  e.preventDefault();
  e.stopPropagation();
  emit('update:modelValue', props.items[next]!.key);
  ((e.currentTarget as HTMLElement).parentElement!.children[next] as HTMLElement).focus();
}
</script>

<template>
  <div class="tabbar" role="tablist" :aria-label="label">
    <button
      v-for="(it, i) in items"
      :key="it.key"
      type="button"
      role="tab"
      :aria-selected="it.key === modelValue"
      :tabindex="it.key === modelValue ? 0 : -1"
      :class="{ active: it.key === modelValue }"
      @click="emit('update:modelValue', it.key)"
      @keydown="onKey($event, i)"
    >
      {{ it.label }}
    </button>
  </div>
</template>

<style scoped>
.tabbar {
  display: flex;
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
}
button {
  flex: 1;
  padding: 8px 4px;
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  color: rgba(255, 255, 255, 0.75);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
button.active {
  color: #63e2b7;
  border-bottom-color: #63e2b7;
}
button:focus-visible {
  outline: 2px solid #70c0e8;
  outline-offset: -2px;
}
</style>
