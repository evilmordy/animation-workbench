<script setup lang="ts">
import {
  NButton,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NRadioButton,
  NRadioGroup,
  NSwitch,
} from 'naive-ui';
import { computed, ref } from 'vue';
import { formatTime } from '../../shared/format';
import { sceneDuration } from '../../shared/timing';
import { useEditorStore } from '../../stores/editor';
import { useGenerationStore } from '../../stores/generation';
import { usePreviewStore } from '../../stores/preview';
import { useSettingsStore } from '../../stores/settings';
import { useSceneEdit } from './useSceneEdit';

const editor = useEditorStore();
const settings = useSettingsStore();
const { patch, issuesAt } = useSceneEdit();
const gen = useGenerationStore();
const preview = usePreviewStore();
const extra = ref('');
const scene = computed(() => editor.scene!);
const duration = computed(() => sceneDuration(scene.value, editor.sceneIndex));
const codeScenes = computed(() => settings.runtime.codeScenes);

/** 校验错误 + 运行时错误；"AI 修复"把它们作为修改指令发给模型 */
const problems = computed(() => [
  ...issuesAt(`scenes[${editor.sceneIndex}]`)
    .filter((i) => i.level === 'error')
    .map((i) => `${i.path.replace(/^scenes\[\d+\]\.?/, '')}：${i.message}`),
  ...preview.errors
    .filter((e) => e.sceneId === scene.value.id)
    .map((e) => `运行时（元素 ${e.elementId ?? '?'}）：${e.message}`),
]);
const fix = () =>
  gen.edit(
    `修复这个场景的以下问题，尽量保持原有内容和意图：\n${problems.value.join('\n')}`,
    { kind: 'scene', sceneId: scene.value.id },
    'AI 修复',
  );
</script>

<template>
  <NForm label-placement="top" size="small" data-testid="scene-form">
    <NFormItem label="标题">
      <NInput
        :value="scene.title"
        @update:value="(v: string) => patch('title', (s) => ({ ...s, title: v }))"
      />
    </NFormItem>
    <NFormItem label="描述（画面里发生什么）">
      <NInput
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 6 }"
        :value="scene.description"
        :input-props="{ 'aria-label': '描述' }"
        @update:value="(v: string) => patch('description', (s) => ({ ...s, description: v }))"
      />
    </NFormItem>
    <NFormItem label="讲稿 / 旁白">
      <NInput
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 6 }"
        :value="scene.notes ?? ''"
        :input-props="{ 'aria-label': '讲稿' }"
        placeholder="可选，不会显示在动画里"
        @update:value="(v: string) => patch('notes', (s) => ({ ...s, notes: v || undefined }))"
      />
    </NFormItem>
    <NFormItem label="进入方式">
      <NRadioGroup
        :value="scene.enter"
        @update:value="(v: 'fresh' | 'keep') => patch('enter', (s) => ({ ...s, enter: v }))"
      >
        <NRadioButton value="fresh">清空画面（淡出 0.5s）</NRadioButton>
        <NRadioButton value="keep">保留上一场景元素</NRadioButton>
      </NRadioGroup>
    </NFormItem>
    <NFormItem :label="`末尾停留（秒）· 场景总时长 ${formatTime(duration)}`">
      <NInputNumber
        :show-button="false"
        :value="scene.hold"
        :min="0"
        :step="0.5"
        :input-props="{ 'aria-label': '末尾停留（秒）' }"
        @update:value="(v: number | null) => patch('hold', (s) => ({ ...s, hold: v ?? 0 }))"
      />
    </NFormItem>
    <NFormItem v-if="codeScenes" label="场景类型">
      <div data-testid="scene-kind">
        <NRadioGroup
          :value="scene.kind"
          @update:value="(v: 'dsl' | 'code') => patch('kind', (s) => ({ ...s, kind: v }))"
        >
          <NRadioButton value="dsl">分镜（元素和步骤）</NRadioButton>
          <NRadioButton value="code">代码</NRadioButton>
        </NRadioGroup>
      </div>
    </NFormItem>
    <NFormItem v-if="codeScenes && scene.kind === 'code'" label="场景代码">
      <NInput
        data-testid="scene-code"
        type="textarea"
        :autosize="{ minRows: 8, maxRows: 18 }"
        :value="scene.code ?? ''"
        :input-props="{ 'aria-label': '场景代码' }"
        placeholder="函数体。anime.js 场是 (root, anime, tl, ctx)，用 tl.add，时间是毫秒。manim-web 场是 (scene, M, ctx)。"
        @update:value="(v: string) => patch('code', (s) => ({ ...s, code: v }))"
      />
    </NFormItem>
    <NFormItem label="锁定（AI 批量修改时跳过）">
      <NSwitch
        aria-label="锁定场景"
        :value="!!scene.locked"
        @update:value="(v: boolean) => patch('locked', (s) => ({ ...s, locked: v || undefined }))"
      />
    </NFormItem>
    <NFormItem label="AI 重新生成本场景">
      <div class="regen">
        <NInput
          v-model:value="extra"
          size="small"
          :input-props="{ 'aria-label': '重新生成的附加要求' }"
          placeholder="附加要求（可选），如：用三个箭头表示受力"
        />
        <NButton
          size="small"
          :loading="gen.editBusy"
          :disabled="gen.editBusy || !!gen.pending"
          data-testid="regen-scene"
          @click="gen.regenerateScene(scene.id, extra)"
        >
          重新生成
        </NButton>
      </div>
    </NFormItem>
    <NFormItem v-if="problems.length" label="这个场景有问题">
      <div class="regen">
        <span class="err">{{ problems.length }} 个错误</span>
        <NButton
          size="small"
          type="warning"
          :disabled="gen.editBusy || !!gen.pending"
          data-testid="ai-fix"
          @click="fix"
          >AI 修复</NButton
        >
      </div>
    </NFormItem>
  </NForm>
</template>

<style scoped>
.regen {
  display: flex;
  gap: 6px;
  width: 100%;
  align-items: center;
}
.err {
  color: #ff8a80;
  font-size: 12px;
}
</style>
