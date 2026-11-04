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
import { useSettingsStore } from '../../stores/settings';
import { safeFileName } from '../../shared/project';
import { playbackRenderer, readRendererFile } from '../../ai/agent/renderer';
import { buildExportHtml, exportRunsCode } from './exportHtml';
import { buildGsapExportHtml } from './exportGsapHtml';

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ 'update:show': [boolean] }>();

const project = useProjectStore();
const editor = useEditorStore();
const settings = useSettingsStore();
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
  codeScenes: settings.runtime.codeScenes,
}));
const runsCode = computed(() => !!project.storyboard && exportRunsCode(project.storyboard, exportOpts.value));
const skipsCode = computed(
  () => !!project.storyboard && project.storyboard.scenes.some((s) => s.kind === 'code') && !runsCode.value,
);

async function doExport() {
  busy.value = true;
  try {
    const sb = project.storyboard!;
    const sidecar = project.dir ? await readRendererFile(project.dir) : null;
    const gsap = settings.runtime.codeScenes && playbackRenderer(sidecar, sb.scenes) === 'gsap';
    const html = gsap
      ? await buildGsapExportHtml(sb, exportOpts.value)
      : await buildExportHtml(sb, exportOpts.value);
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
    <p class="hint">一个文件包含动画和播放器，离线可用，用任何浏览器打开即可播放、拖进度、全屏。</p>
    <p v-if="runsCode" class="hint">
      这份导出含代码场景，页面会执行场景代码。脚本白名单仍只有运行时的哈希；unsafe-eval
      是导出自带的（播放器本身需要），没有新增其他来源。
    </p>
    <p v-if="skipsCode" class="hint">
      代码场景开关是关的，这些场景会按原来的方式跳过，不会在导出的页面里执行。
    </p>
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
        <span class="hint inline">在每个场景结束时暂停，用 → 键翻到下一个场景</span>
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
    <ol class="steps">
      <li>
        先导出 HTML，然后用
        <strong>Chrome 或 Edge</strong> 打开它（点上面的"在浏览器中打开"，或把文件拖进浏览器）。
      </li>
      <li>点播放器右下角的下载按钮，选择 MP4 或 WebM，等待逐帧渲染完成后浏览器会自动下载。</li>
      <li>Safari 和 Firefox 对视频编码的支持不完整，建议用 Chrome / Edge。GIF 导出暂不支持。</li>
    </ol>
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
.steps {
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.7;
  margin: 0 0 6px;
}
</style>
