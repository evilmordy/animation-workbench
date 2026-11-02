<script setup lang="ts">
import { NDrawer, NDrawerContent } from 'naive-ui';
import { useEditorStore } from '../../stores/editor';
import JsonEditor from '../expert/JsonEditor.vue';
import InspectorPanel from '../inspector/InspectorPanel.vue';
import PreviewPane from '../preview/PreviewPane.vue';
import TimelinePanel from '../timeline/TimelinePanel.vue';
import LeftPanel from './LeftPanel.vue';
import StatusBar from './StatusBar.vue';
import TopBar from './TopBar.vue';
import { useShortcuts } from './useShortcuts';

const editor = useEditorStore();
useShortcuts();
</script>

<template>
  <div class="workbench">
    <TopBar class="top" />
    <LeftPanel class="left" />
    <main class="center">
      <PreviewPane />
    </main>
    <InspectorPanel class="right" />
    <TimelinePanel class="timeline" />
    <StatusBar class="status" />
    <NDrawer v-model:show="editor.expertOpen" :width="620" placement="right" resizable>
      <NDrawerContent
        title="专家模式：分镜 JSON"
        closable
        :native-scrollbar="false"
        body-content-style="padding:0;height:100%"
      >
        <JsonEditor />
      </NDrawerContent>
    </NDrawer>
  </div>
</template>

<style scoped>
.workbench {
  display: grid;
  height: 100vh;
  grid-template-columns: 280px minmax(0, 1fr) 340px;
  grid-template-rows: 44px minmax(0, 1fr) 190px 26px;
  grid-template-areas:
    'top top top'
    'left center right'
    'left timeline right'
    'status status status';
}
.top {
  grid-area: top;
}
.left {
  grid-area: left;
  border-right: 1px solid rgba(255, 255, 255, 0.09);
  min-height: 0;
}
.center {
  grid-area: center;
  min-height: 0;
  min-width: 0;
}
.right {
  grid-area: right;
  border-left: 1px solid rgba(255, 255, 255, 0.09);
  min-height: 0;
}
.timeline {
  grid-area: timeline;
  border-top: 1px solid rgba(255, 255, 255, 0.09);
  min-width: 0;
}
.status {
  grid-area: status;
}
</style>
