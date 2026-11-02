<script setup lang="ts">
import { NButton, NInput, NModal, NSpace, useMessage } from 'naive-ui';
import { ref, watch } from 'vue';
import { useManualStore } from '../../stores/manual';

const manual = useManualStore();
const message = useMessage();
const answer = ref('');
watch(
  () => manual.pending,
  () => (answer.value = ''),
);

async function copy() {
  try {
    await navigator.clipboard.writeText(manual.pending!.prompt);
    message.success('已复制，粘贴到网页版 AI 的对话框里');
  } catch {
    message.warning('无法访问剪贴板，请手动全选复制');
  }
}
</script>

<template>
  <NModal
    :show="!!manual.pending"
    preset="card"
    :title="`手动模式：${manual.pending?.title ?? ''}`"
    style="width: 760px"
    :mask-closable="false"
    @close="manual.cancel()"
  >
    <ol class="how">
      <li>点"复制提示词"，粘贴到 ChatGPT、Claude、DeepSeek 等网页版对话框发送。</li>
      <li>把 AI 的完整回答粘贴到下面，点"提交"。格式不对时会自动生成修复提示词，再走一遍即可。</li>
    </ol>
    <NInput
      type="textarea"
      readonly
      :value="manual.pending?.prompt"
      :autosize="{ minRows: 6, maxRows: 10 }"
      :input-props="{ 'aria-label': '提示词' }"
      class="mono"
    />
    <NSpace class="gap">
      <NButton type="primary" data-testid="copy-prompt" @click="copy">复制提示词</NButton>
      <span class="hint">共 {{ manual.pending?.prompt.length ?? 0 }} 字</span>
    </NSpace>
    <NInput
      v-model:value="answer"
      type="textarea"
      placeholder="把 AI 的回答粘贴到这里"
      :autosize="{ minRows: 6, maxRows: 12 }"
      :input-props="{ 'aria-label': 'AI 的回答' }"
      class="mono"
      data-testid="manual-answer"
    />
    <template #action>
      <NSpace justify="end">
        <NButton @click="manual.cancel()">取消</NButton>
        <NButton
          type="primary"
          :disabled="!answer.trim()"
          data-testid="manual-submit"
          @click="manual.submit(answer)"
        >
          提交
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.how {
  margin: 0 0 8px;
  padding-left: 20px;
  font-size: 13px;
}
.gap {
  margin: 8px 0 12px;
}
.hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}
.mono :deep(textarea) {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
</style>
