<script setup lang="ts">
import {
  NAlert,
  NButton,
  NCheckbox,
  NEmpty,
  NInput,
  NInputNumber,
  NModal,
  NSpace,
  useMessage,
} from 'naive-ui';
import { computed, ref } from 'vue';
import { SOURCE_BUDGET } from '../../ai/prompts';
import { platform } from '../../platform';
import { describeError } from '../../shared/errors';
import { newId } from '../../shared/id';
import { safeFileName, type InputRef } from '../../shared/project';
import { useEditorStore } from '../../stores/editor';
import { useGenerationStore } from '../../stores/generation';
import { useProjectStore } from '../../stores/project';
import { decodeText, estimateTokens, TEXT_EXTENSIONS } from './text';

const project = useProjectStore();
const gen = useGenerationStore();
const editor = useEditorStore();
const message = useMessage();

const selected = ref(new Set<string>());
const texts = ref(new Map<string, string>());
const inputs = computed(() => project.project?.inputs ?? []);

/** 导入/粘贴后的确认框：可编辑文本；PDF 可选页码范围 */
const draft = ref<{
  name: string;
  text: string;
  bytes?: Uint8Array;
  ext: string;
  pdf?: {
    pages: number;
    from: number;
    to: number;
    noText: boolean;
    read: (a: number, b: number) => Promise<{ text: string; hasTextLayer: boolean }>;
  };
} | null>(null);
const busy = ref(false);

const inputsDir = () => platform.join(project.dir!, 'inputs');

async function textOf(r: InputRef): Promise<string> {
  if (!texts.value.has(r.id)) {
    const t = await platform.readText(await platform.join(await inputsDir(), r.textFile)).catch(() => '');
    texts.value = new Map(texts.value).set(r.id, t);
  }
  return texts.value.get(r.id)!;
}

async function importFile() {
  const path = await platform.pickFile('导入素材', [
    { name: '文本、代码和 PDF', extensions: [...TEXT_EXTENSIONS, 'pdf'] },
  ]);
  if (!path) return;
  busy.value = true;
  try {
    const name = path.split(/[\\/]/).pop()!;
    const ext = name.split('.').pop()!.toLowerCase();
    const bytes = await platform.readBinary(path);
    if (ext === 'pdf') {
      const { openPdf } = await import('./pdf');
      const pdf = await openPdf(bytes);
      const to = Math.min(pdf.pages, 20);
      const r = await pdf.read(1, to);
      draft.value = {
        name,
        ext,
        bytes,
        text: r.text,
        pdf: { pages: pdf.pages, from: 1, to, noText: !r.hasTextLayer, read: pdf.read },
      };
    } else {
      const { text, encoding } = decodeText(bytes);
      if (encoding === 'gbk') message.info('文件不是 UTF-8 编码，已按 GBK 读取');
      draft.value = { name, ext, bytes, text };
    }
  } catch (e) {
    const d = describeError(e);
    message.error(`导入失败：${d.what}`);
  } finally {
    busy.value = false;
  }
}

function pasteText() {
  draft.value = { name: `粘贴的文本 ${inputs.value.length + 1}`, ext: 'txt', text: '' };
}

async function rereadPdf() {
  const p = draft.value!.pdf!;
  busy.value = true;
  const r = await p.read(p.from, p.to);
  draft.value = { ...draft.value!, text: r.text, pdf: { ...p, noText: !r.hasTextLayer } };
  busy.value = false;
}

/** 素材副本和提取的文本都存进项目的 inputs/ */
async function saveDraft() {
  const d = draft.value!;
  const id = newId('in');
  const dir = await inputsDir();
  await platform.mkdir(dir);
  const file = `${id}-${safeFileName(d.name)}`;
  if (d.bytes) await platform.writeBinary(await platform.join(dir, file), d.bytes);
  else await platform.writeTextAtomic(await platform.join(dir, file), d.text);
  const textFile = `${id}.txt`;
  await platform.writeTextAtomic(await platform.join(dir, textFile), d.text);
  const ref: InputRef = {
    id,
    name: d.name,
    file,
    textFile,
    chars: d.text.length,
    addedAt: new Date().toISOString(),
  };
  project.updateProject({ inputs: [...inputs.value, ref] });
  texts.value = new Map(texts.value).set(id, d.text);
  selected.value = new Set([...selected.value, id]);
  draft.value = null;
}

async function remove(r: InputRef) {
  project.updateProject({ inputs: inputs.value.filter((x) => x.id !== r.id) });
  const dir = await inputsDir();
  await platform.remove(await platform.join(dir, r.textFile)).catch(() => {});
  await platform.remove(await platform.join(dir, r.file)).catch(() => {});
  const next = new Set(selected.value);
  next.delete(r.id);
  selected.value = next;
}

function toggle(id: string, on: boolean) {
  const next = new Set(selected.value);
  if (on) next.add(id);
  else next.delete(id);
  selected.value = next;
}

const selectedTokens = computed(() =>
  inputs.value
    .filter((r) => selected.value.has(r.id))
    .reduce((a, r) => a + estimateTokens(texts.value.get(r.id) ?? 'x'.repeat(r.chars)), 0),
);
const budgetTokens = estimateTokens('字'.repeat(SOURCE_BUDGET.outline));

async function useAsSource() {
  const chosen = inputs.value.filter((r) => selected.value.has(r.id));
  const parts = await Promise.all(chosen.map(async (r) => `【${r.name}】\n${await textOf(r)}`));
  gen.source = parts.join('\n\n');
  editor.leftTab = 'ai';
}
</script>

<template>
  <div data-testid="inputs-panel">
    <NSpace>
      <NButton size="small" type="primary" :loading="busy" data-testid="import-file" @click="importFile"
        >导入文件</NButton
      >
      <NButton size="small" data-testid="paste-text" @click="pasteText">粘贴文本</NButton>
    </NSpace>
    <p class="hint">支持 txt、md、代码文件和 PDF（读取文本层）。素材副本保存在项目的 inputs/ 文件夹。</p>
    <NEmpty v-if="!inputs.length" description="还没有素材" />
    <ul v-else class="list">
      <li v-for="r in inputs" :key="r.id">
        <NCheckbox :checked="selected.has(r.id)" @update:checked="(v: boolean) => toggle(r.id, v)">
          {{ r.name }}
        </NCheckbox>
        <span class="muted">{{ r.chars }} 字</span>
        <NButton size="tiny" quaternary :aria-label="`删除素材 ${r.name}`" @click="remove(r)">✕</NButton>
      </li>
    </ul>
    <template v-if="inputs.length">
      <p class="hint">已选约 {{ selectedTokens }} tokens（大纲预算约 {{ budgetTokens }}）</p>
      <NAlert v-if="selectedTokens > budgetTokens" type="warning" :show-icon="false">
        选中的素材超出预算，超出部分会被截断。可以少选几份，或导入 PDF 时缩小页码范围。
      </NAlert>
      <NButton
        size="small"
        block
        class="gap"
        :disabled="!selected.size"
        data-testid="use-inputs"
        @click="useAsSource"
      >
        用作 AI 素材
      </NButton>
    </template>

    <NModal
      :show="!!draft"
      preset="card"
      :title="draft?.ext === 'pdf' ? `导入 PDF：${draft?.name}` : '添加素材'"
      style="width: 720px"
      @close="draft = null"
    >
      <template v-if="draft">
        <NInput
          v-if="!draft.bytes"
          v-model:value="draft.name"
          size="small"
          class="gap"
          :input-props="{ 'aria-label': '素材名称' }"
        />
        <NSpace v-if="draft.pdf" align="center" class="gap">
          <span>共 {{ draft.pdf.pages }} 页，读取第</span>
          <NInputNumber
            :show-button="false"
            v-model:value="draft.pdf.from"
            size="small"
            :min="1"
            :max="draft.pdf.pages"
            style="width: 90px"
            :input-props="{ 'aria-label': '起始页' }"
          />
          <span>到</span>
          <NInputNumber
            :show-button="false"
            v-model:value="draft.pdf.to"
            size="small"
            :min="draft.pdf.from"
            :max="draft.pdf.pages"
            style="width: 90px"
            :input-props="{ 'aria-label': '结束页' }"
          />
          <span>页</span>
          <NButton size="small" :loading="busy" @click="rereadPdf">重新读取</NButton>
        </NSpace>
        <NAlert v-if="draft.pdf?.noText" type="warning" :show-icon="false" class="gap">
          这份 PDF 似乎没有文本层（可能是扫描件），提取不到文字。可以用其他工具 OCR 后再导入文本。
        </NAlert>
        <NInput
          v-model:value="draft.text"
          type="textarea"
          :autosize="{ minRows: 10, maxRows: 18 }"
          placeholder="在这里粘贴或修改素材内容"
          :input-props="{ 'aria-label': '素材内容' }"
          data-testid="draft-text"
        />
        <p class="hint">约 {{ estimateTokens(draft.text) }} tokens</p>
      </template>
      <template #action>
        <NSpace justify="end">
          <NButton @click="draft = null">取消</NButton>
          <NButton type="primary" :disabled="!draft?.text.trim()" data-testid="save-draft" @click="saveDraft"
            >保存素材</NButton
          >
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  margin: 6px 0;
}
.muted {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-left: auto;
}
.list {
  list-style: none;
  padding: 0;
  margin: 4px 0;
}
.list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}
.gap {
  margin: 8px 0;
}
</style>
