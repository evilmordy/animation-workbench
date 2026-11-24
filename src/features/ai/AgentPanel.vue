<script setup lang="ts">
import { NButton, NInput, NInputNumber } from 'naive-ui';
import type { AgentLogLine } from '../../ai/agent/log';
import { useSettingsStore } from '../../stores/settings';

defineProps<{
  busy: boolean;
  checking: boolean;
  checkText: string;
  lines: AgentLogLine[];
  turns: number;
  tokens: number;
  preciseText: string;
  hitLabel: string;
  rangeLabel: string;
  queueLabel: string;
  blockedNote: string;
  shiftNote: string;
}>();
defineEmits<{
  cancel: [];
  check: [];
  precise: [];
  confirm: [];
  skip: [];
  'update:preciseText': [value: string];
}>();

const settings = useSettingsStore();
const tokenLabel = (max: number | null) => (max == null ? '不限' : String(max));
const completionLabel = (max: number | null) => (max == null ? '不传' : String(max));
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
          :max="128"
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
      <label>
        单次输出
        <NInputNumber
          size="tiny"
          :show-button="false"
          :disabled="busy"
          :value="settings.agentBudget.completionTokens"
          :min="0"
          placeholder="不传"
          :input-props="{ 'aria-label': '单次输出上限' }"
          data-testid="agent-completion-tokens"
          @update:value="
            (v: number | null) => settings.setAgentBudget({ completionTokens: v && v > 0 ? v : null })
          "
        />
      </label>
      <p class="muted">
        轮次 {{ turns }}/{{ settings.agentBudget.maxTurns }} · tokens {{ tokens }}/{{
          tokenLabel(settings.agentBudget.maxTokens)
        }}
        · 单次 {{ completionLabel(settings.agentBudget.completionTokens) }}
      </p>
    </div>
    <div class="precise" data-testid="precise-edit">
      <p class="muted">暂停后点选画面，或在时间线标尺上拖出区间，再写要改的地方。两点可以同时有。</p>
      <p v-if="hitLabel" class="muted" data-testid="precise-hit">{{ hitLabel }}</p>
      <p v-if="rangeLabel" class="muted" data-testid="precise-range">{{ rangeLabel }}</p>
      <NInput
        type="textarea"
        size="small"
        :autosize="{ minRows: 2, maxRows: 4 }"
        :value="preciseText"
        :disabled="busy"
        placeholder="例如：这个标签挪到左边"
        data-testid="precise-instruction"
        @update:value="(value: string) => $emit('update:preciseText', value)"
      />
      <div class="precise-actions">
        <NButton size="small" data-testid="precise-run" :disabled="busy" @click="$emit('precise')">
          精确修改
        </NButton>
        <NButton
          v-if="queueLabel"
          size="small"
          type="primary"
          data-testid="precise-confirm"
          :disabled="busy"
          @click="$emit('confirm')"
        >
          确认这一场
        </NButton>
        <NButton
          v-if="queueLabel"
          size="small"
          data-testid="precise-skip"
          :disabled="busy"
          @click="$emit('skip')"
        >
          跳过这一场
        </NButton>
      </div>
      <p v-if="queueLabel" class="muted" data-testid="precise-queue">{{ queueLabel }}</p>
      <p v-if="blockedNote" class="warn" data-testid="precise-blocked">{{ blockedNote }}</p>
      <p v-if="shiftNote" class="warn" data-testid="edit-shift">{{ shiftNote }}</p>
    </div>
    <div class="check">
      <NButton
        size="small"
        data-testid="agent-check"
        :loading="checking"
        :disabled="busy || checking"
        @click="$emit('check')"
      >
        体检
      </NButton>
      <pre v-if="checkText" class="result" data-testid="agent-check-result">{{ checkText }}</pre>
    </div>
    <ol class="log" data-testid="agent-log">
      <li v-for="line in lines" :key="line.id" data-testid="agent-log-entry" :data-kind="line.kind">
        <strong>{{ line.title }}</strong>
        <pre v-if="line.detail">{{ line.detail }}</pre>
        <div v-if="line.images?.length" class="compare" data-testid="edit-compare">
          <figure v-for="(image, index) in line.images" :key="`${line.id}-${index}`">
            <img :src="image.dataUrl" :alt="image.caption" />
            <figcaption>{{ image.caption }}</figcaption>
          </figure>
        </div>
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
.check {
  margin-top: 8px;
}
.result {
  white-space: pre-wrap;
  font-size: 12px;
  margin: 6px 0 0;
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
  max-height: 360px;
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
.precise {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}
.precise-actions {
  display: flex;
  gap: 6px;
}
.warn {
  color: #ffb020;
  font-size: 12px;
  margin: 2px 0;
}
.compare {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.compare figure {
  margin: 0;
  width: 160px;
}
.compare img {
  width: 100%;
  height: auto;
  background: #000;
  display: block;
}
.compare figcaption {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
}
</style>
