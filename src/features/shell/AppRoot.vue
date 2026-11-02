<script setup lang="ts">
import { onMounted } from 'vue';
import { useProjectStore } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import WelcomePage from '../welcome/WelcomePage.vue';
import WorkbenchLayout from './WorkbenchLayout.vue';

const project = useProjectStore();
const settings = useSettingsStore();
onMounted(() => {
  void project.loadRecent();
  void settings.load();
});
</script>

<template>
  <WorkbenchLayout v-if="project.isOpen" />
  <WelcomePage v-else />
</template>
