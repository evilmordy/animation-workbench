<script setup lang="ts">
import { NModal } from 'naive-ui';

defineProps<{ show: boolean }>();
defineEmits<{ 'update:show': [boolean] }>();
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="导出"
    style="width: 560px"
    @update:show="(v: boolean) => $emit('update:show', v)"
  />
</template>
