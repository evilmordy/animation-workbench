<script setup lang="ts">
import { computed } from 'vue';
import { useProjectStore } from '../../stores/project';
import { usePreviewStore } from '../../stores/preview';
import { useAiStore } from '../../stores/ai';
import IssuesPopover from './IssuesPopover.vue';

const project = useProjectStore();
const preview = usePreviewStore();
const ai = useAiStore();

const saveText = computed(
  () =>
    ({
      saved: '已保存',
      dirty: '有未保存的修改',
      saving: '保存中…',
      error: `保存失败：${project.saveError}`,
    })[project.saveState],
);
</script>

<template>
  <footer class="statusbar" aria-label="状态栏">
    <span :class="{ err: project.saveState === 'error' }" data-testid="save-state">{{ saveText }}</span>
    <span>模型：{{ ai.modelLabel }}</span>
    <span>本次用量：{{ ai.usage.prompt + ai.usage.completion }} tokens</span>
    <span v-if="preview.buildMs">预览构建 {{ preview.buildMs }} ms</span>
    <span class="spacer" />
    <IssuesPopover />
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
  border-top: 1px solid rgba(255, 255, 255, 0.09);
}
.spacer {
  flex: 1;
}
.err {
  color: #ff8a80;
}
</style>
