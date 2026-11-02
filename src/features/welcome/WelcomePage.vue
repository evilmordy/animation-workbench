<script setup lang="ts">
import { NButton, NEmpty, NList, NListItem, NThing } from 'naive-ui';
import { useProjectStore } from '../../stores/project';
import { useProjectActions } from '../shell/useProjectActions';
import SettingsDialog from '../settings/SettingsDialog.vue';
import { ref } from 'vue';

const project = useProjectStore();
const actions = useProjectActions();
const settingsOpen = ref(false);
</script>

<template>
  <main class="welcome">
    <header>
      <h1>Animation Workbench</h1>
      <p class="lead">把文字、教材和代码变成可精确编辑的 3Blue1Brown 风格动画。</p>
    </header>
    <div class="actions">
      <NButton type="primary" size="large" data-testid="open-sample" @click="actions.openSample">
        打开示例：勾股定理
      </NButton>
      <NButton size="large" data-testid="new-project" @click="actions.create">新建项目</NButton>
      <NButton size="large" data-testid="open-project" @click="actions.open()">打开项目文件夹</NButton>
      <NButton size="large" quaternary data-testid="open-settings" @click="settingsOpen = true"
        >配置 AI</NButton
      >
    </div>
    <section class="recent" aria-label="最近项目">
      <h2>最近项目</h2>
      <NEmpty v-if="!project.recent.length" description="还没有打开过项目。先看看示例吧，不需要 API Key。" />
      <NList v-else hoverable clickable bordered>
        <NListItem v-for="r in project.recent" :key="r.dir" @click="actions.open(r.dir)">
          <NThing :title="r.name" :description="r.dir" />
        </NListItem>
      </NList>
    </section>
    <SettingsDialog v-model:show="settingsOpen" />
  </main>
</template>

<style scoped>
.welcome {
  max-width: 760px;
  margin: 0 auto;
  padding: 64px 24px;
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
}
h1 {
  font-size: 32px;
  margin: 0 0 8px;
}
.lead {
  color: rgba(255, 255, 255, 0.75);
  margin: 0 0 32px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 40px;
}
h2 {
  font-size: 16px;
}
</style>
