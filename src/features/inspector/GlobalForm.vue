<script setup lang="ts">
import {
  NColorPicker,
  NDivider,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NRadioButton,
  NRadioGroup,
  NSelect,
} from 'naive-ui';
import { computed } from 'vue';
import { PRESETS, resolvePalette, type PaletteToken } from '../../shared/palette';
import { COMPLEXITIES, CONTENT_TYPES, type GenerationParams } from '../../shared/project';
import { PALETTE_TOKENS } from '../../shared/registry';
import type { Storyboard } from '../../shared/schema';
import { useProjectStore } from '../../stores/project';

const project = useProjectStore();
const meta = computed(() => project.storyboard!.meta);
const gen = computed(() => project.project!.generation);
const palette = computed(() => resolvePalette(meta.value));

const setMeta = (field: string, patch: Partial<Storyboard['meta']>) =>
  project.update(
    { ...project.storyboard!, meta: { ...meta.value, ...patch } },
    { coalesce: `meta:${field}` },
  );
const setGen = (patch: Partial<GenerationParams>) =>
  project.updateProject({ generation: { ...gen.value, ...patch } });

/** 切换预设：背景跟着换，自定义调色板清空，元素颜色通过 $令牌 整体换色 */
function setPreset(p: Storyboard['meta']['stylePreset']) {
  if (p === 'custom') return setMeta('preset', { stylePreset: p, palette: { ...palette.value } });
  const { palette: _drop, ...rest } = meta.value;
  void _drop;
  project.update({
    ...project.storyboard!,
    meta: { ...rest, stylePreset: p, background: PRESETS[p].background },
  });
}

const setToken = (t: PaletteToken, v: string) =>
  setMeta(`pal:${t}`, {
    stylePreset: 'custom',
    palette: { ...palette.value, [t]: v.slice(0, 7).toUpperCase() },
  });

const LABELS = { simple: '简单', medium: '适中', complex: '复杂' } as const;
const TYPES = {
  math: '数学',
  physics: '物理',
  algorithm: '算法与代码',
  story: '故事文案',
  general: '通用',
} as const;
const TOKEN_LABEL = {
  primary: '主色',
  secondary: '辅色',
  accent: '强调色',
  text: '文字色',
  muted: '弱化色',
} as const;
</script>

<template>
  <NForm label-placement="top" size="small" data-testid="global-form">
    <NFormItem label="动画标题">
      <NInput :value="meta.title" @update:value="(v: string) => setMeta('title', { title: v })" />
    </NFormItem>
    <NFormItem label="画面比例">
      <NRadioGroup :value="meta.aspect" @update:value="(v: '16:9') => setMeta('aspect', { aspect: v })">
        <NRadioButton value="16:9">16:9 横屏</NRadioButton>
        <NRadioButton value="9:16">9:16 竖屏</NRadioButton>
        <NRadioButton value="1:1">1:1</NRadioButton>
      </NRadioGroup>
    </NFormItem>
    <NFormItem label="风格预设">
      <NRadioGroup :value="meta.stylePreset" data-testid="style-preset" @update:value="setPreset">
        <NRadioButton value="3b1b">3Blue1Brown（深色）</NRadioButton>
        <NRadioButton value="clean">简洁（浅色）</NRadioButton>
        <NRadioButton value="custom">自定义</NRadioButton>
      </NRadioGroup>
    </NFormItem>
    <NFormItem label="背景色">
      <NColorPicker
        :value="meta.background"
        :modes="['hex']"
        :show-alpha="false"
        @update:value="(v: string) => setMeta('bg', { background: v.slice(0, 7).toUpperCase() })"
      />
    </NFormItem>
    <NFormItem label="调色板（元素用 $primary 等令牌引用）">
      <div class="palette">
        <label v-for="t in PALETTE_TOKENS" :key="t">
          <span>{{ TOKEN_LABEL[t] }}</span>
          <NColorPicker
            size="small"
            :value="palette[t]"
            :modes="['hex']"
            :show-alpha="false"
            @update:value="(v: string) => setToken(t, v)"
          />
        </label>
      </div>
    </NFormItem>

    <NDivider title-placement="left">AI 生成参数</NDivider>
    <NFormItem label="目标时长（秒）">
      <NInputNumber
        :value="gen.targetDuration"
        :min="10"
        :max="600"
        :step="10"
        @update:value="(v: number | null) => setGen({ targetDuration: v ?? 60 })"
      />
    </NFormItem>
    <NFormItem label="复杂度">
      <NRadioGroup :value="gen.complexity" @update:value="(v: 'medium') => setGen({ complexity: v })">
        <NRadioButton v-for="c in COMPLEXITIES" :key="c" :value="c">{{ LABELS[c] }}</NRadioButton>
      </NRadioGroup>
    </NFormItem>
    <NFormItem label="内容类型">
      <NSelect
        :value="gen.contentType"
        :options="CONTENT_TYPES.map((c) => ({ label: TYPES[c], value: c }))"
        @update:value="(v: 'general') => setGen({ contentType: v })"
      />
    </NFormItem>
  </NForm>
</template>

<style scoped>
.palette {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 6px;
  width: 100%;
}
.palette label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.palette span {
  min-width: 48px;
}
</style>
