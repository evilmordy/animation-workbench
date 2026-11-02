<script setup lang="ts">
import { NButton, NDropdown, NTag, NTooltip } from 'naive-ui';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { formatTime } from '../../shared/format';
import type { Scene } from '../../shared/schema';
import { sceneDuration } from '../../shared/timing';
import { useAiStore } from '../../stores/ai';
import { useEditorStore } from '../../stores/editor';
import { useGenerationStore } from '../../stores/generation';
import { usePreviewStore } from '../../stores/preview';
import { useProjectStore } from '../../stores/project';
import { useSceneActions } from './useSceneActions';

const PAD = 12;
const project = useProjectStore();
const preview = usePreviewStore();
const editor = useEditorStore();
const ai = useAiStore();
const gen = useGenerationStore();
const actions = useSceneActions();

const scroller = ref<HTMLElement | null>(null);
const width = ref(800);
let ro: ResizeObserver | null = null;
onMounted(() => {
  // 推迟到下一帧，避免改宽度引起的布局变化在同一帧内再次触发 ResizeObserver
  ro = new ResizeObserver(([e]) => requestAnimationFrame(() => (width.value = e!.contentRect.width)));
  if (scroller.value) ro.observe(scroller.value);
});
onBeforeUnmount(() => ro?.disconnect());

const scenes = computed(() => project.storyboard?.scenes ?? []);

/** 优先用运行时回报的真实时长；预览还没跟上时用 schema 计算值 */
const durations = computed(() => {
  const spans = preview.spans;
  const fresh = spans.length === scenes.value.length && spans.every((s, i) => s.id === scenes.value[i]!.id);
  return scenes.value.map((s, i) => (fresh ? spans[i]!.end - spans[i]!.start : sceneDuration(s, i)));
});
const starts = computed(() => {
  let acc = 0;
  return durations.value.map((d) => (acc += d) - d);
});
const total = computed(() => durations.value.reduce((a, b) => a + b, 0));
const pxPerSec = computed(() => Math.max(28, (width.value - PAD * 2) / Math.max(total.value, 1)));

// 拖拽排序用本地列表，结束时一次性写回（一步撤销）
const list = ref<Scene[]>([]);
watch(scenes, (s) => (list.value = [...s]), { immediate: true });
function onReorder() {
  const order = list.value.map((s) => s.id);
  if (order.join() === scenes.value.map((s) => s.id).join()) return;
  project.update({
    ...project.storyboard!,
    scenes: order.map((id) => scenes.value.find((s) => s.id === id)!),
  });
}

// 拖右边缘调时长
const resizing = ref<{ id: string; startX: number; base: number; draft: number } | null>(null);
function startResize(e: PointerEvent, id: string, i: number) {
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  resizing.value = { id, startX: e.clientX, base: durations.value[i]!, draft: durations.value[i]! };
}
function onResizeMove(e: PointerEvent) {
  if (!resizing.value) return;
  const d = resizing.value.base + (e.clientX - resizing.value.startX) / pxPerSec.value;
  resizing.value = { ...resizing.value, draft: Math.max(0.1, Math.round(d * 20) / 20) };
}
function endResize() {
  const r = resizing.value;
  resizing.value = null;
  if (r && Math.abs(r.draft - r.base) >= 0.05) actions.resizeTo(r.id, r.draft);
}
const widthOf = (s: Scene, i: number) =>
  (resizing.value?.id === s.id ? resizing.value.draft : durations.value[i]!) * pxPerSec.value;

function select(s: Scene, i: number) {
  editor.selectScene(s.id);
  preview.seek(starts.value[i]! + 0.001);
}

function seekAt(e: MouseEvent) {
  const rect = scroller.value!.getBoundingClientRect();
  preview.seek((e.clientX - rect.left + scroller.value!.scrollLeft - PAD) / pxPerSec.value);
}

function badges(s: Scene, i: number) {
  const prefix = `scenes[${i}]`;
  const mine = project.issues.filter((x) => x.path === prefix || x.path.startsWith(prefix + '.'));
  const runtime = preview.errors.filter((x) => x.sceneId === s.id).length;
  return {
    busy: ai.busyScenes.has(s.id),
    errors: mine.filter((x) => x.level === 'error').length + runtime,
    warnings: mine.filter((x) => x.level === 'warning').length,
  };
}

// 右键菜单
const menu = ref<{ x: number; y: number; id: string } | null>(null);
const menuOptions = computed(() => {
  const s = scenes.value.find((x) => x.id === menu.value?.id);
  return [
    { label: '复制场景', key: 'dup' },
    { label: '在后面插入空场景', key: 'insert' },
    { label: s?.locked ? '解锁（允许 AI 修改）' : '锁定（AI 批量修改时跳过）', key: 'lock' },
    { type: 'divider', key: 'd' },
    { label: '删除场景', key: 'del' },
  ];
});
function openMenu(e: MouseEvent, id: string) {
  e.preventDefault();
  editor.selectScene(id);
  menu.value = null;
  void nextTick(() => (menu.value = { x: e.clientX, y: e.clientY, id }));
}
function onMenu(key: string) {
  const id = menu.value!.id;
  menu.value = null;
  if (key === 'dup') actions.duplicate(id);
  if (key === 'insert') actions.insertAfter(id);
  if (key === 'lock') actions.toggleLock(id);
  if (key === 'del') actions.remove(id);
}

function onCardKey(e: KeyboardEvent, s: Scene, i: number) {
  if (e.key === 'Enter') select(s, i);
  else if (e.altKey && e.key === 'ArrowLeft') actions.move(s.id, -1);
  else if (e.altKey && e.key === 'ArrowRight') actions.move(s.id, 1);
  else if (e.key === '[') actions.resizeBy(s.id, -0.5);
  else if (e.key === ']') actions.resizeBy(s.id, 0.5);
  else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(new MouseEvent('contextmenu', { clientX: r.left + 20, clientY: r.top + 20 }), s.id);
  } else return;
  e.preventDefault();
  e.stopPropagation();
}

const ticks = computed(() => {
  const step = pxPerSec.value >= 60 ? 1 : pxPerSec.value >= 25 ? 2 : 5;
  return Array.from({ length: Math.floor(total.value / step) + 1 }, (_, k) => k * step);
});
</script>

<template>
  <section class="timeline" aria-label="时间线">
    <header>
      <strong>时间线</strong>
      <span class="hint">拖动排序 · 拖右边缘调时长 · 右键更多操作 · 选中后 Alt+←/→ 移动、[ ] 调时长</span>
      <span class="spacer" />
      <span class="total">共 {{ scenes.length }} 个场景，{{ formatTime(total) }}</span>
      <NButton size="tiny" data-testid="insert-scene" @click="actions.insertAfter(editor.sceneId)"
        >＋ 插入空场景</NButton
      >
    </header>
    <div
      ref="scroller"
      class="scroller"
      @pointermove="onResizeMove"
      @pointerup="endResize"
      @pointercancel="endResize"
    >
      <div class="inner" :style="{ width: `${total * pxPerSec + PAD * 2}px` }">
        <div class="ruler" @click="seekAt">
          <span v-for="t in ticks" :key="t" class="tick" :style="{ left: `${PAD + t * pxPerSec}px` }"
            >{{ t }}s</span
          >
        </div>
        <VueDraggable
          v-model="list"
          class="track"
          :animation="150"
          :style="{ paddingLeft: `${PAD}px` }"
          filter=".resize"
          :prevent-on-filter="false"
          @end="onReorder"
        >
          <div
            v-for="(s, i) in list"
            :key="s.id"
            class="card"
            :class="{
              selected: s.id === editor.sceneId,
              locked: s.locked,
              changed: gen.pending?.result.changed.includes(s.id),
            }"
            :style="{ width: `${widthOf(s, i)}px` }"
            tabindex="0"
            role="button"
            :aria-pressed="s.id === editor.sceneId"
            :aria-label="`场景 ${i + 1}：${s.title}，${durations[i]?.toFixed(1)} 秒`"
            data-testid="scene-card"
            @click="select(s, i)"
            @contextmenu="openMenu($event, s.id)"
            @keydown="onCardKey($event, s, i)"
          >
            <div class="title">{{ i + 1 }}. {{ s.title || '未命名' }}</div>
            <div class="meta">
              {{ (resizing?.id === s.id ? resizing.draft : durations[i])?.toFixed(1) }}s
              <span v-if="s.enter === 'keep'" title="继承上一场景的元素">⇢</span>
            </div>
            <div class="badges">
              <NTag v-if="badges(s, i).busy" size="tiny" type="info">生成中</NTag>
              <NTag v-if="gen.pending?.result.changed.includes(s.id)" size="tiny" type="info">待确认</NTag>
              <NTag v-if="badges(s, i).errors" size="tiny" type="error">{{ badges(s, i).errors }} 错误</NTag>
              <NTag v-if="badges(s, i).warnings" size="tiny" type="warning"
                >{{ badges(s, i).warnings }} 警告</NTag
              >
              <NTooltip v-if="s.locked">
                <template #trigger><span aria-label="已锁定">🔒</span></template>
                已锁定：AI 批量修改时会跳过
              </NTooltip>
            </div>
            <div
              class="resize"
              role="separator"
              aria-label="拖动调整时长"
              @pointerdown.stop="startResize($event, s.id, i)"
              @click.stop
            />
          </div>
        </VueDraggable>
        <div class="playhead" :style="{ left: `${PAD + preview.time * pxPerSec}px` }" aria-hidden="true" />
      </div>
    </div>
    <NDropdown
      trigger="manual"
      placement="bottom-start"
      :show="!!menu"
      :x="menu?.x ?? 0"
      :y="menu?.y ?? 0"
      :options="menuOptions"
      @select="onMenu"
      @clickoutside="menu = null"
    />
  </section>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  font-size: 12px;
}
.hint {
  color: rgba(255, 255, 255, 0.6);
}
.spacer {
  flex: 1;
}
.total {
  color: rgba(255, 255, 255, 0.75);
}
.scroller {
  position: relative;
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
}
.inner {
  position: relative;
  height: 100%;
  min-width: 100%;
}
.ruler {
  position: relative;
  height: 20px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.tick {
  position: absolute;
  top: 3px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.55);
  transform: translateX(-50%);
}
.track {
  display: flex;
  gap: 0;
  height: calc(100% - 34px);
  margin-top: 8px;
}
.card {
  position: relative;
  box-sizing: border-box;
  flex: none;
  min-width: 8px;
  height: 100%;
  padding: 6px 10px 6px 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  background: #23262f;
  overflow: hidden;
  cursor: grab;
  user-select: none;
}
.card + .card {
  margin-left: 2px;
}
.card.selected {
  border-color: #63e2b7;
  background: #263a33;
}
.card.changed {
  box-shadow: inset 0 0 0 2px #70c0e8;
}
.card.locked {
  background-image: repeating-linear-gradient(45deg, transparent 0 8px, rgba(255, 255, 255, 0.03) 8px 16px);
}
.card:focus-visible {
  outline: 2px solid #70c0e8;
}
.title {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  margin: 2px 0 4px;
}
.badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.resize {
  position: absolute;
  top: 0;
  right: 0;
  width: 8px;
  height: 100%;
  cursor: ew-resize;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.15));
}
.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #ff6b6b;
  pointer-events: none;
}
</style>
