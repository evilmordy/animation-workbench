<script setup lang="ts">
import {
  NConfigProvider,
  NDialogProvider,
  NGlobalStyle,
  NMessageProvider,
  darkTheme,
  dateZhCN,
  zhCN,
  type GlobalThemeOverrides,
} from 'naive-ui';
import AppRoot from './features/shell/AppRoot.vue';

// 提高次要文字对比度（UX-08：≥ 4.5:1）
const overrides: GlobalThemeOverrides = {
  common: { textColor3: 'rgba(255, 255, 255, 0.62)', placeholderColor: 'rgba(255, 255, 255, 0.5)' },
  Empty: { textColor: 'rgba(255, 255, 255, 0.62)', iconColor: 'rgba(255, 255, 255, 0.45)' },
};
</script>

<template>
  <NConfigProvider :theme="darkTheme" :theme-overrides="overrides" :locale="zhCN" :date-locale="dateZhCN">
    <NGlobalStyle />
    <NMessageProvider>
      <NDialogProvider>
        <AppRoot />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style>
html,
body,
#app {
  margin: 0;
  height: 100%;
  overflow: hidden;
}
</style>
