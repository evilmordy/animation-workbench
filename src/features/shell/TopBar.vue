<script setup lang="ts">
import { NButton, NButtonGroup, NTooltip } from 'naive-ui';
import { useEditorStore } from '../../stores/editor';
import { useProjectStore } from '../../stores/project';
import ExportDialog from '../export/ExportDialog.vue';
import SettingsDialog from '../settings/SettingsDialog.vue';

const project = useProjectStore();
const editor = useEditorStore();
</script>

<template>
  <header class="topbar">
    <NButton quaternary size="small" aria-label="返回欢迎页" @click="project.close()">☰</NButton>
    <strong class="name" :title="project.dir ?? ''">{{ project.storyboard?.meta.title }}</strong>
    <NButtonGroup size="small">
      <NTooltip>
        <template #trigger>
          <NButton :disabled="!project.canUndo" aria-label="撤销" data-testid="undo" @click="project.undo()"
            >↶</NButton
          >
        </template>
        撤销（Ctrl+Z）
      </NTooltip>
      <NTooltip>
        <template #trigger>
          <NButton :disabled="!project.canRedo" aria-label="重做" data-testid="redo" @click="project.redo()"
            >↷</NButton
          >
        </template>
        重做（Ctrl+Shift+Z）
      </NTooltip>
    </NButtonGroup>
    <NButton size="small" @click="project.save(true)">保存快照</NButton>
    <span class="spacer" />
    <NButton
      size="small"
      :type="editor.expertOpen ? 'primary' : 'default'"
      data-testid="toggle-expert"
      @click="editor.expertOpen = !editor.expertOpen"
    >
      专家模式 JSON
    </NButton>
    <NButton size="small" data-testid="open-settings" @click="editor.settingsOpen = true">AI 设置</NButton>
    <NButton size="small" type="primary" data-testid="open-export" @click="editor.exportOpen = true"
      >导出</NButton
    >
    <SettingsDialog v-model:show="editor.settingsOpen" />
    <ExportDialog v-model:show="editor.exportOpen" />
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
}
.name {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
</style>
