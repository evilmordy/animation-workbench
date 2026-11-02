<script setup lang="ts">
import { NButton, NEmpty, NPopover, NTag } from 'naive-ui';
import { computed, ref } from 'vue';
import { useEditorStore } from '../../stores/editor';
import { useProjectStore } from '../../stores/project';
import { usePreviewStore } from '../../stores/preview';

const project = useProjectStore();
const preview = usePreviewStore();
const editor = useEditorStore();
const show = ref(false);

const items = computed(() => [
  ...project.issues.map((i) => ({ level: i.level, label: `${i.code} ${i.message}`, path: i.path })),
  ...preview.errors.map((e) => ({
    level: 'error' as const,
    label: `运行时：${e.message}`,
    path: e.sceneId ? `scenes[${project.storyboard?.scenes.findIndex((s) => s.id === e.sceneId) ?? 0}]` : '',
  })),
]);
const errors = computed(() => items.value.filter((i) => i.level === 'error').length);
const warnings = computed(() => items.value.length - errors.value);

function go(path: string) {
  editor.reveal(path);
  show.value = false;
}
</script>

<template>
  <NPopover v-model:show="show" trigger="click" placement="top-end" style="max-height: 360px; overflow: auto">
    <template #trigger>
      <NButton
        text
        size="tiny"
        data-testid="issues-button"
        :aria-label="`问题：${errors} 个错误，${warnings} 个警告`"
      >
        <span :class="{ err: errors }">● {{ errors }} 错误</span>
        &nbsp;
        <span :class="{ warn: warnings }">▲ {{ warnings }} 警告</span>
      </NButton>
    </template>
    <NEmpty v-if="!items.length" description="没有问题" />
    <ul v-else class="issues">
      <li v-for="(i, k) in items" :key="k">
        <button type="button" @click="go(i.path)">
          <NTag size="small" :type="i.level === 'error' ? 'error' : 'warning'">{{
            i.level === 'error' ? '错误' : '警告'
          }}</NTag>
          <span>{{ i.label }}</span>
          <code>{{ i.path }}</code>
        </button>
      </li>
    </ul>
  </NPopover>
</template>

<style scoped>
.err {
  color: #ff8a80;
}
.warn {
  color: #ffd180;
}
.issues {
  list-style: none;
  margin: 0;
  padding: 0;
  max-width: 520px;
}
.issues button {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  text-align: left;
  background: none;
  border: 0;
  color: inherit;
  padding: 4px 2px;
  cursor: pointer;
}
.issues button:hover,
.issues button:focus-visible {
  background: rgba(255, 255, 255, 0.06);
}
code {
  margin-left: auto;
  opacity: 0.6;
  font-size: 11px;
}
</style>
