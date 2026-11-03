<script setup lang="ts">
import { NEmpty, NScrollbar } from 'naive-ui';
import { computed, watch } from 'vue';
import { useEditorStore, type InspectorTab } from '../../stores/editor';
import { useSettingsStore } from '../../stores/settings';
import TabBar from '../shell/TabBar.vue';
import ElementsForm from './ElementsForm.vue';
import GlobalForm from './GlobalForm.vue';
import SceneForm from './SceneForm.vue';
import StepsForm from './StepsForm.vue';

const editor = useEditorStore();
const settings = useSettingsStore();
const allTabs: { key: InspectorTab; label: string }[] = [
  { key: 'scene', label: '场景' },
  { key: 'elements', label: '元素' },
  { key: 'steps', label: '步骤' },
  { key: 'global', label: '全局' },
];
/** flag 关时 codeScene 恒为 false，标签栏与原来相同。 */
const codeScene = computed(() => settings.runtime.codeScenes && editor.scene?.kind === 'code');
const tabs = computed(() =>
  codeScene.value ? allTabs.filter((t) => t.key !== 'elements' && t.key !== 'steps') : allTabs,
);
watch(codeScene, (on) => {
  if (on && (editor.inspectorTab === 'elements' || editor.inspectorTab === 'steps'))
    editor.inspectorTab = 'scene';
});
</script>

<template>
  <aside class="inspector" aria-label="检查器">
    <TabBar v-model="editor.inspectorTab" :items="tabs" label="检查器" />
    <NScrollbar class="body" role="tabpanel">
      <div class="pad">
        <GlobalForm v-if="editor.inspectorTab === 'global'" />
        <NEmpty v-else-if="!editor.scene" description="在下方时间线上选择一个场景" />
        <SceneForm v-else-if="editor.inspectorTab === 'scene'" />
        <ElementsForm v-else-if="editor.inspectorTab === 'elements' && !codeScene" />
        <StepsForm v-else-if="!codeScene" />
        <SceneForm v-else />
      </div>
    </NScrollbar>
  </aside>
</template>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.body {
  flex: 1;
  min-height: 0;
}
.pad {
  padding: 8px 12px 24px;
}
</style>
