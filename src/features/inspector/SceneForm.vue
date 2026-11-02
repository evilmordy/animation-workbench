<script setup lang="ts">
import { NForm, NFormItem, NInput, NInputNumber, NRadioButton, NRadioGroup, NSwitch } from 'naive-ui';
import { computed } from 'vue';
import { formatTime } from '../../shared/format';
import { sceneDuration } from '../../shared/timing';
import { useEditorStore } from '../../stores/editor';
import { useSceneEdit } from './useSceneEdit';

const editor = useEditorStore();
const { patch } = useSceneEdit();
const scene = computed(() => editor.scene!);
const duration = computed(() => sceneDuration(scene.value, editor.sceneIndex));
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
        @update:value="(v: string) => patch('description', (s) => ({ ...s, description: v }))"
      />
    </NFormItem>
    <NFormItem label="讲稿 / 旁白">
      <NInput
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 6 }"
        :value="scene.notes ?? ''"
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
        :value="scene.hold"
        :min="0"
        :max="30"
        :step="0.5"
        @update:value="(v: number | null) => patch('hold', (s) => ({ ...s, hold: v ?? 0 }))"
      />
    </NFormItem>
    <NFormItem label="锁定（AI 批量修改时跳过）">
      <NSwitch
        :value="!!scene.locked"
        @update:value="(v: boolean) => patch('locked', (s) => ({ ...s, locked: v || undefined }))"
      />
    </NFormItem>
  </NForm>
</template>
