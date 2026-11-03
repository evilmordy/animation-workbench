<script setup lang="ts">
import { NButton, NSelect, NTooltip } from 'naive-ui';
import RangeInput from '../shell/RangeInput.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { platform } from '../../platform';
import { PreviewMessage } from '../../shared/protocol';
import { useProjectStore } from '../../stores/project';
import { usePreviewStore } from '../../stores/preview';
import { useGenerationStore } from '../../stores/generation';
import { useSettingsStore } from '../../stores/settings';
import { formatTime } from '../../shared/format';

/** 两次重建之间至少间隔 300ms：单次编辑立即重建，连续编辑合并，最后一次一定会加载 */
const LOAD_INTERVAL_MS = 300;
const STALL_MS = 3000;

const project = useProjectStore();
const preview = usePreviewStore();
const gen = useGenerationStore();
const settings = useSettingsStore();
/** flag 关时地址与原来完全一样，预览页不会执行 scene.code。 */
const previewSrc = computed(() => {
  const base = platform.previewSrc();
  if (!settings.runtime.codeScenes) return base;
  return `${base}${base.includes('?') ? '&' : '?'}codeScenes=1`;
});
/** 有待确认的 AI 修改时，可以切换预览修改后的版本 */
const shown = computed(() =>
  gen.pending && gen.previewProposed ? gen.pending.result.storyboard : project.storyboard,
);
const frame = ref<HTMLIFrameElement | null>(null);
const frameKey = ref(0);
let lastBeat = 0;
let loadTimer: ReturnType<typeof setTimeout> | null = null;
let lastLoad = 0;
let watchdog: ReturnType<typeof setInterval> | null = null;

const post = (m: unknown) => frame.value?.contentWindow?.postMessage(m, '*');

function sendLoad() {
  if (!shown.value || !preview.ready) return;
  // 构建中的错误会在 loaded 之前到达，所以在发送前清空
  preview.errors = [];
  lastLoad = performance.now();
  post({ type: 'load', storyboard: JSON.parse(JSON.stringify(shown.value)), startAt: preview.time });
}

function onMessage(e: MessageEvent) {
  if (!frame.value || e.source !== frame.value.contentWindow) return;
  const r = PreviewMessage.safeParse(e.data);
  if (!r.success) return;
  const m = r.data;
  lastBeat = Date.now();
  preview.stalled = false;
  switch (m.type) {
    case 'ready':
      preview.ready = true;
      preview.runtimeVersion = m.runtimeVersion;
      sendLoad();
      break;
    case 'loaded':
      preview.duration = m.duration;
      preview.spans = m.scenes;
      preview.buildMs = m.buildMs;
      if (preview.rate !== 1) preview.setRate(preview.rate);
      break;
    case 'time':
      preview.time = m.t;
      preview.playing = m.playing;
      break;
    case 'error':
      preview.errors = [
        ...preview.errors,
        { sceneId: m.sceneId, elementId: m.elementId, message: m.message },
      ];
      break;
    case 'log':
      console.warn('[preview]', m.message);
      break;
  }
}

function reload() {
  preview.ready = false;
  preview.stalled = false;
  frameKey.value++;
}

onMounted(() => {
  window.addEventListener('message', onMessage);
  preview.setSender((m) => post(m));
  watchdog = setInterval(() => {
    if (preview.ready && Date.now() - lastBeat > STALL_MS) preview.stalled = true;
  }, 1000);
});
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage);
  preview.setSender(null);
  preview.ready = false;
  if (watchdog) clearInterval(watchdog);
  if (loadTimer) clearTimeout(loadTimer);
});

watch(shown, () => {
  if (loadTimer) return;
  const wait = LOAD_INTERVAL_MS - (performance.now() - lastLoad);
  if (wait <= 0) return sendLoad();
  loadTimer = setTimeout(() => {
    loadTimer = null;
    sendLoad();
  }, wait);
});

const rates = [0.5, 1, 1.5, 2].map((r) => ({ label: `${r}×`, value: r }));
const timeText = computed(() => `${formatTime(preview.time)} / ${formatTime(preview.duration)}`);
</script>

<template>
  <section class="preview" aria-label="预览">
    <div class="stage">
      <iframe
        :key="frameKey"
        ref="frame"
        title="动画预览"
        sandbox="allow-scripts"
        :src="previewSrc"
        data-testid="preview-frame"
      />
      <div v-if="preview.stalled" class="overlay" role="alert">
        <p>预览无响应：动画运行时可能卡住了。</p>
        <NButton type="primary" @click="reload">重新加载预览</NButton>
      </div>
      <div v-else-if="!project.storyboard?.scenes.length" class="overlay muted">
        还没有场景。可以在左侧用 AI 生成，或在时间线上插入空场景。
      </div>
    </div>
    <div class="controls">
      <NTooltip>
        <template #trigger>
          <NButton
            circle
            size="small"
            :aria-label="preview.playing ? '暂停' : '播放'"
            data-testid="play-toggle"
            @click="preview.toggle"
          >
            {{ preview.playing ? '❚❚' : '▶' }}
          </NButton>
        </template>
        播放/暂停（空格）
      </NTooltip>
      <RangeInput
        class="scrub"
        :value="preview.time"
        :min="0"
        :max="Math.max(preview.duration, 0.01)"
        :step="0.01"
        label="播放进度"
        @update:value="(v: number) => preview.seek(v)"
      />
      <span class="time" data-testid="preview-time">{{ timeText }}</span>
      <NSelect
        class="rate"
        size="small"
        :value="preview.rate"
        :options="rates"
        aria-label="播放速度"
        @update:value="(v: number) => preview.setRate(v)"
      />
    </div>
  </section>
</template>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #000;
}
iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 12px;
  text-align: center;
  background: rgba(0, 0, 0, 0.7);
}
.overlay.muted {
  background: transparent;
  color: #aaa;
  pointer-events: none;
}
.controls {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
}
.scrub {
  flex: 1;
}
.time {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: #ccc;
  min-width: 96px;
  text-align: right;
}
.rate {
  width: 80px;
}
</style>
