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
    <section class="guide" aria-label="三步上手">
      <h2>三步上手</h2>
      <ol>
        <li><strong>放入素材</strong>：新建项目后，在左侧"素材"页粘贴文字或导入 txt / md / 代码 / PDF。</li>
        <li>
          <strong>AI 生成并精修</strong
          >：在"AI"页生成大纲、逐个生成场景；再用时间线和右侧检查器精确调整，或用一句话让 AI 修改。没有 API
          Key 也可以用手动模式。
        </li>
        <li><strong>导出</strong>：Ctrl+E 导出单文件 HTML，在浏览器里播放，或用 Chrome 导出 MP4。</li>
      </ol>
    </section>
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
.guide ol {
  padding-left: 20px;
  line-height: 1.8;
  color: rgba(255, 255, 255, 0.85);
  margin: 0 0 32px;
}
</style>
