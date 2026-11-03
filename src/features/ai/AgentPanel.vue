<script setup lang="ts">
import { NButton, NInputNumber } from 'naive-ui';
import type { AgentLogLine } from '../../ai/agent/log';
import { useSettingsStore } from '../../stores/settings';

defineProps<{
  busy: boolean;
  lines: AgentLogLine[];
  turns: number;
  tokens: number;
}>();
defineEmits<{ cancel: [] }>();

const settings = useSettingsStore();
const tokenLabel = (max: number | null) => (max == null ? '不限' : String(max));
</script>

<template>
  <section class="agent" data-testid="agent-panel" aria-label="Agent">
    <NButton v-if="busy" size="small" data-testid="cancel-agent" @click="$emit('cancel')">取消</NButton>
    <div class="budget" data-testid="agent-budget">
      <label>
        轮次上限
        <NInputNumber
          size="tiny"
          :show-button="false"
          :disabled="busy"
          :value="settings.agentBudget.maxTurns"
          :min="1"
          :max="32"
          :input-props="{ 'aria-label': '轮次上限' }"
          data-testid="agent-max-turns"
          @update:value="(v: number | null) => settings.setAgentBudget({ maxTurns: v ?? 1 })"
        />
      </label>
      <label>
        Token 上限
        <NInputNumber
          size="tiny"
          :show-button="false"
          :disabled="busy"
          :value="settings.agentBudget.maxTokens"
          :min="0"
          placeholder="不限"
          :input-props="{ 'aria-label': 'Token 上限' }"
          data-testid="agent-max-tokens"
          @update:value="(v: number | null) => settings.setAgentBudget({ maxTokens: v && v > 0 ? v : null })"
        />
      </label>
      <p class="muted">
        轮次 {{ turns }}/{{ settings.agentBudget.maxTurns }} · tokens {{ tokens }}/{{
          tokenLabel(settings.agentBudget.maxTokens)
        }}
      </p>
    </div>
    <ol class="log" data-testid="agent-log">
      <li v-for="line in lines" :key="line.id" data-testid="agent-log-entry" :data-kind="line.kind">
        <strong>{{ line.title }}</strong>
        <pre v-if="line.detail">{{ line.detail }}</pre>
      </li>
    </ol>
    <p v-if="!lines.length" class="muted">还没有运行记录。工具调用和截帧检查会写在这里。</p>
  </section>
</template>

<style scoped>
.agent {
  margin: 8px 0;
}
.budget {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 8px;
  font-size: 12px;
}
.budget label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.budget p {
  grid-column: 1 / -1;
}
.muted {
  color: rgba(255, 255, 255, 0.65);
  font-size: 12px;
  margin: 2px 0;
}
.log {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  max-height: 220px;
  overflow: auto;
  font-size: 12px;
}
.log li {
  padding: 4px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.log pre {
  white-space: pre-wrap;
  margin: 2px 0 0;
  font-family: inherit;
  color: rgba(255, 255, 255, 0.75);
}
</style>
