<script setup lang="ts">
import {
  NAlert,
  NButton,
  NDivider,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSpace,
  NSwitch,
  useMessage,
} from 'naive-ui';
import { computed, ref, watch } from 'vue';
import { platform } from '../../platform';
import { describeError } from '../../shared/errors';
import { useEditorStore } from '../../stores/editor';
import { useProjectStore } from '../../stores/project';
import { safeFileName } from '../../shared/project';
import { buildAnimeExportHtml } from './exportAnimeHtml';

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ 'update:show': [boolean] }>();

const project = useProjectStore();
const editor = useEditorStore();
const message = useMessage();
const slides = ref(false);
const loop = ref(false);
const name = ref('');
const busy = ref(false);
const exported = ref<string | null>(null);

watch(
  () => props.show,
  (v) => {
    if (!v) return;
    exported.value = null;
    name.value = safeFileName(project.storyboard?.meta.title ?? '', 'animation');
  },
);

const errors = computed(() => project.issues.filter((i) => i.level === 'error'));
const exportOpts = computed(() => ({
  slides: slides.value,
  loop: loop.value,
}));

async function doExport() {
  busy.value = true;
  try {
    const sb = project.storyboard!;
    const html = await buildAnimeExportHtml(sb, exportOpts.value);
    const dir = await platform.join(project.dir!, 'exports');
    await platform.mkdir(dir);
    const path = await platform.join(dir, `${safeFileName(name.value, 'animation')}.html`);
    await platform.writeTextAtomic(path, html);
    exported.value = path;
    message.success(`已导出（${(html.length / 1e6).toFixed(1)} MB）`);
  } catch (e) {
    message.error(`导出失败：${describeError(e).what}`);
  } finally {
    busy.value = false;
  }
}

function showIssues() {
  emit('update:show', false);
  editor.reveal(errors.value[0]!.path);
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="导出"
    style="width: 600px"
    data-testid="export-dialog"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <h3>单文件 HTML</h3>
    <p class="hint">一个文件包含动画，离线可用，用浏览器打开即可播放。</p>
    <NAlert v-if="errors.length" type="error" :show-icon="false" class="gap">
      还有 {{ errors.length }} 个错误，修复后才能导出。
      <NButton text type="primary" @click="showIssues">查看第一个</NButton>
    </NAlert>
    <NForm label-placement="left" label-width="110" size="small">
      <NFormItem label="文件名">
        <NInput v-model:value="name" :input-props="{ 'aria-label': '文件名' }">
          <template #suffix>.html</template>
        </NInput>
      </NFormItem>
      <NFormItem label="幻灯片模式">
        <NSwitch v-model:value="slides" aria-label="幻灯片模式" />
        <span class="hint inline">写入导出文件的 data-slides。播放器目前整片连续播放</span>
      </NFormItem>
      <NFormItem label="循环播放">
        <NSwitch v-model:value="loop" aria-label="循环播放" />
      </NFormItem>
    </NForm>
    <NSpace>
      <NButton
        type="primary"
        :loading="busy"
        :disabled="!!errors.length"
        data-testid="do-export"
        @click="doExport"
      >
        导出 HTML 到项目的 exports 文件夹
      </NButton>
    </NSpace>
    <NAlert v-if="exported" type="success" :show-icon="false" class="gap" data-testid="export-done">
      <div class="path">{{ exported }}</div>
      <NSpace class="gap">
        <NButton size="small" data-testid="open-browser" @click="platform.openExternal(exported)"
          >在浏览器中打开</NButton
        >
        <NButton size="small" @click="platform.revealInDir(exported)">在文件夹中显示</NButton>
      </NSpace>
    </NAlert>

    <NDivider />
    <h3>导出视频（MP4 / WebM）</h3>
    <p class="hint">应用内直接导出视频会在后续版本提供（各平台 WebView 的编码能力不一致）。</p>
  </NModal>
</template>

<style scoped>
h3 {
  font-size: 14px;
  margin: 0 0 6px;
}
.hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  margin: 0 0 8px;
}
.inline {
  margin: 0 0 0 8px;
}
.gap {
  margin: 8px 0;
}
.path {
  word-break: break-all;
  font-size: 12px;
}
</style>
