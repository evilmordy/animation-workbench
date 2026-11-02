<script setup lang="ts">
import { useEditorStore, type LeftTab } from '../../stores/editor';
import AiPanel from '../ai/AiPanel.vue';
import InputsPanel from '../input/InputsPanel.vue';
import ProjectPanel from './ProjectPanel.vue';
import TabBar from './TabBar.vue';

const editor = useEditorStore();
const tabs: { key: LeftTab; label: string }[] = [
  { key: 'project', label: '项目' },
  { key: 'inputs', label: '素材' },
  { key: 'ai', label: 'AI' },
];
</script>

<template>
  <aside class="left" aria-label="项目、素材与 AI">
    <TabBar v-model="editor.leftTab" :items="tabs" label="左侧面板" />
    <div class="body" role="tabpanel">
      <ProjectPanel v-show="editor.leftTab === 'project'" />
      <InputsPanel v-show="editor.leftTab === 'inputs'" />
      <AiPanel v-show="editor.leftTab === 'ai'" />
    </div>
  </aside>
</template>

<style scoped>
.left {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 12px 24px;
}
</style>
