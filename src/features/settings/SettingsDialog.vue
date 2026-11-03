<script setup lang="ts">
import {
  NAlert,
  NButton,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NSwitch,
  useMessage,
} from 'naive-ui';
import { computed, ref, watch } from 'vue';
import { PROVIDERS, providerById } from '../../ai/providers';
import RangeInput from '../shell/RangeInput.vue';
import { platform, type SecretStatus } from '../../platform';
import { describeError } from '../../shared/errors';
import { newId } from '../../shared/id';
import { useSettingsStore } from '../../stores/settings';

const props = defineProps<{ show: boolean }>();
defineEmits<{ 'update:show': [boolean] }>();

const settings = useSettingsStore();
const message = useMessage();
const status = ref<SecretStatus | null>(null);
const keyInput = ref('');
const urlInput = ref('');
const busy = ref(false);
const testResult = ref<{ ok: boolean; text: string } | null>(null);

const provider = computed(() => providerById(settings.ai.providerId));
const providerOptions = PROVIDERS.map((p) => ({
  label: p.note ? `${p.name}（${p.note}）` : p.name,
  value: p.id,
}));

async function refresh() {
  testResult.value = null;
  keyInput.value = '';
  status.value = await platform.secretStatus(settings.ai.providerId).catch(() => null);
  urlInput.value = status.value?.base_url ?? provider.value.baseUrl;
}
watch(
  () => [props.show, settings.ai.providerId],
  () => props.show && void refresh(),
  { immediate: true },
);

async function saveKey() {
  busy.value = true;
  try {
    const backend = await platform.secretSet(
      settings.ai.providerId,
      urlInput.value.trim(),
      keyInput.value.trim(),
    );
    message.success(
      backend === 'keychain' ? 'Key 已保存到系统钥匙串' : 'Key 只在本次运行有效（系统钥匙串不可用）',
    );
    await refresh();
  } catch (e) {
    const d = describeError(e);
    message.error(`${d.what}。${d.next}`);
  } finally {
    busy.value = false;
  }
}

async function removeKey() {
  await platform.secretRemove(settings.ai.providerId);
  await refresh();
}

async function testConnection() {
  busy.value = true;
  testResult.value = null;
  const t0 = performance.now();
  try {
    const r = await platform.llmChat(
      {
        request_id: newId('req'),
        provider_id: settings.ai.providerId,
        model: settings.model(),
        messages: [{ role: 'user', content: '只回复两个字母：OK' }],
        max_tokens: 8,
        json_mode: false,
      },
      () => {},
    );
    testResult.value = {
      ok: true,
      text: `连接成功（${Math.round(performance.now() - t0)} ms）：${r.text.slice(0, 40)}`,
    };
  } catch (e) {
    const d = describeError(e);
    testResult.value = { ok: false, text: `${d.what}。${d.next}` };
  } finally {
    busy.value = false;
  }
}

const logFull = computed({
  get: () => settings.ai.logFullContent,
  set: (v: boolean) => (settings.ai.logFullContent = v),
});
const codeScenesFlag = computed({
  get: () => settings.runtime.codeScenes,
  set: (v: boolean) => (settings.runtime.codeScenes = v),
});
const engine = computed({
  get: () => settings.engine,
  set: (v: 'legacy' | 'agentic') => {
    settings.engine = v;
  },
});

const urlChanged = computed(() => status.value?.exists && urlInput.value.trim() !== status.value.base_url);
const host = computed(() => {
  try {
    return new URL(status.value?.base_url ?? '').host;
  } catch {
    return '';
  }
});
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="AI 设置"
    style="width: 680px"
    :segmented="{ content: true }"
    @update:show="(v: boolean) => $emit('update:show', v)"
  >
    <NForm label-placement="left" label-width="110" size="small" data-testid="settings-form">
      <NFormItem label="调用方式">
        <NRadioGroup v-model:value="settings.ai.mode" data-testid="ai-mode">
          <NRadioButton value="api">API（自带 Key）</NRadioButton>
          <NRadioButton value="manual">手动模式（复制到网页版 AI）</NRadioButton>
        </NRadioGroup>
      </NFormItem>
      <NAlert v-if="settings.ai.mode === 'manual'" type="info" :show-icon="false" class="gap">
        不需要 API Key：每一步都会显示提示词，复制到 ChatGPT / Claude / DeepSeek
        等网页版，再把回答粘贴回来。完全不联网。
      </NAlert>
      <template v-else>
        <NFormItem label="服务商">
          <NSelect v-model:value="settings.ai.providerId" :options="providerOptions" />
        </NFormItem>
        <NFormItem label="Base URL">
          <NInput
            v-model:value="urlInput"
            placeholder="https://..."
            :input-props="{ 'aria-label': 'Base URL' }"
          />
        </NFormItem>
        <NFormItem label="API Key">
          <NSpace vertical style="width: 100%">
            <div v-if="status?.exists" class="key">
              已保存：••••{{ status.last4 }}（{{
                status.backend === 'keychain' ? '系统钥匙串' : '仅本次运行'
              }}）
              <NButton size="tiny" quaternary type="error" @click="removeKey">删除</NButton>
            </div>
            <NInput
              v-model:value="keyInput"
              type="password"
              show-password-on="click"
              :placeholder="status?.exists ? '输入新 Key 以替换' : '粘贴 API Key'"
              :input-props="{ 'aria-label': 'API Key', autocomplete: 'off' }"
              data-testid="api-key"
            />
            <NAlert v-if="urlChanged" type="warning" :show-icon="false">
              Key 和 Base URL 绑定保存。修改 Base URL 需要重新输入 Key。
            </NAlert>
            <NSpace>
              <NButton
                type="primary"
                :disabled="!keyInput.trim() || busy"
                data-testid="save-key"
                @click="saveKey"
              >
                保存 Key
              </NButton>
              <NButton :disabled="!status?.exists || busy" :loading="busy" @click="testConnection"
                >测试连接</NButton
              >
              <span v-if="provider.keyUrl" class="hint">获取 Key：{{ provider.keyUrl }}</span>
            </NSpace>
            <NAlert v-if="testResult" :type="testResult.ok ? 'success' : 'error'" :show-icon="false">{{
              testResult.text
            }}</NAlert>
            <p v-if="status?.backend === 'memory' && status.exists" class="hint">
              系统钥匙串不可用：Key 只保存在内存里，关闭应用后需要重新输入。Linux 上可以安装并启动
              gnome-keyring。
            </p>
            <p v-if="host" class="hint">素材和分镜会发送到：{{ host }}</p>
          </NSpace>
        </NFormItem>
        <NFormItem label="模型">
          <NInput
            :value="settings.ai.models[settings.ai.providerId] ?? ''"
            :placeholder="provider.defaultModel"
            @update:value="
              (v: string) => (settings.ai.models = { ...settings.ai.models, [settings.ai.providerId]: v })
            "
          />
        </NFormItem>
        <NFormItem label="JSON 模式">
          <NSwitch
            aria-label="JSON 模式"
            :value="settings.jsonMode()"
            @update:value="
              (v: boolean) =>
                (settings.ai.jsonMode = { ...settings.ai.jsonMode, [settings.ai.providerId]: v })
            "
          />
        </NFormItem>
        <NFormItem label="温度">
          <RangeInput
            v-model:value="settings.ai.temperature"
            :min="0"
            :max="1.5"
            :step="0.1"
            label="温度"
            style="max-width: 240px"
          />
          <span class="num">{{ settings.ai.temperature }}</span>
        </NFormItem>
        <NFormItem label="并发数">
          <NInputNumber
            :show-button="false"
            v-model:value="settings.ai.concurrency"
            :min="1"
            :max="4"
            style="width: 100px"
          />
        </NFormItem>
      </template>
      <NFormItem label="日志完整内容">
        <NSwitch v-model:value="logFull" aria-label="日志记录完整内容" />
        <span class="hint inline">关闭时 .awb/ai-log.jsonl 只记录耗时、用量等元数据</span>
      </NFormItem>
      <NFormItem label="代码场景">
        <NSwitch v-model:value="codeScenesFlag" aria-label="代码场景" data-testid="code-scenes-flag" />
        <span class="hint inline">关闭时检查器和导出与现在一致。打开后可以编辑并播放 kind:code。</span>
      </NFormItem>
      <NFormItem label="生成引擎">
        <NRadioGroup v-model:value="engine" data-testid="generation-engine">
          <NRadioButton value="legacy">旧大纲</NRadioButton>
          <NRadioButton value="agentic">Agent</NRadioButton>
        </NRadioGroup>
        <span class="hint inline">
          默认仍是旧大纲。Agent 还要打开代码场景才生效，关掉其中任意一个就回到旧生成。
        </span>
      </NFormItem>
    </NForm>
  </NModal>
</template>

<style scoped>
.gap {
  margin-bottom: 12px;
}
.key {
  font-size: 13px;
}
.hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  margin: 0;
}
.inline {
  margin-left: 8px;
}
.num {
  margin-left: 8px;
  font-variant-numeric: tabular-nums;
}
a {
  color: #70c0e8;
  font-size: 12px;
  align-self: center;
}
</style>
