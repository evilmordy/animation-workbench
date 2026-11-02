<script setup lang="ts">
import { NConfigProvider, NGlobalStyle, darkTheme, zhCN, dateZhCN } from 'naive-ui';
</script>

<template>
  <NConfigProvider :theme="darkTheme" :locale="zhCN" :date-locale="dateZhCN">
    <NGlobalStyle />
    <main class="app">Animation Workbench</main>
  </NConfigProvider>
</template>

<style scoped>
.app {
  height: 100vh;
  display: grid;
  place-items: center;
}
</style>
