<script setup lang="ts">
import { NButton, NDescriptions, NDescriptionsItem, NEmpty, NList, NListItem } from 'naive-ui';
import { computed, ref, watch } from 'vue';
import { platform } from '../../platform';
import { formatTime } from '../../shared/format';
import { parseStoryboard } from '../../shared/schema';
import { totalDuration } from '../../shared/timing';
import { useProjectStore } from '../../stores/project';

const project = useProjectStore();
const snapshots = ref<string[]>([]);

async function refresh() {
  snapshots.value = project.dir ? (await project.listSnapshots()).reverse().slice(0, 20) : [];
}
watch(() => [project.dir, project.saveState], refresh, { immediate: true });

const total = computed(() => (project.storyboard ? totalDuration(project.storyboard) : 0));
const label = (name: string) =>
  name.replace(/^storyboard-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(.*)\.json$/, '$2-$3 $4:$5:$6 · $7');

async function restore(name: string) {
  const text = await platform.readText(await platform.join(project.dir!, 'versions', name));
  const r = parseStoryboard(JSON.parse(text));
  if (r.ok) {
    await project.snapshot('before-restore');
    project.update(r.value);
  }
}
</script>

<template>
  <div>
    <NDescriptions :column="1" size="small" label-placement="left">
      <NDescriptionsItem label="项目">{{ project.project?.name }}</NDescriptionsItem>
      <NDescriptionsItem label="位置"
        ><span class="path">{{ project.dir }}</span></NDescriptionsItem
      >
      <NDescriptionsItem label="场景"
        >{{ project.storyboard?.scenes.length }} 个，共 {{ formatTime(total) }}</NDescriptionsItem
      >
    </NDescriptions>
    <NButton size="small" block class="reveal" @click="platform.revealInDir(project.dir!)"
      >在文件夹中显示</NButton
    >
    <h3>自动快照</h3>
    <p class="hint">AI 修改前和手动保存时会写快照，最多保留 50 份。恢复前会先给当前状态再存一份。</p>
    <NEmpty v-if="!snapshots.length" description="还没有快照" />
    <NList v-else size="small">
      <NListItem v-for="s in snapshots" :key="s">
        <div class="snap">
          <span>{{ label(s) }}</span>
          <NButton size="tiny" @click="restore(s)">恢复</NButton>
        </div>
      </NListItem>
    </NList>
  </div>
</template>

<style scoped>
.path {
  word-break: break-all;
  font-size: 12px;
}
.reveal {
  margin: 8px 0;
}
h3 {
  font-size: 13px;
  margin: 12px 0 4px;
}
.hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.62);
  margin: 0 0 6px;
}
.snap {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}
</style>
