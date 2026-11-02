<script setup lang="ts">
import { NModal } from 'naive-ui';

defineProps<{ show: boolean }>();
defineEmits<{ 'update:show': [boolean] }>();
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="AI 设置"
    style="width: 640px"
    @update:show="(v: boolean) => $emit('update:show', v)"
  >
    <slot />
  </NModal>
</template>
