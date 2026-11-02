<script setup lang="ts">
import { json } from '@codemirror/lang-json';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { NRadioButton, NRadioGroup } from 'naive-ui';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { locate } from '../../shared/jsonpath';
import type { Scene, Storyboard } from '../../shared/schema';
import { validate, type Issue } from '../../shared/validate';
import { useEditorStore } from '../../stores/editor';
import { useProjectStore } from '../../stores/project';

const project = useProjectStore();
const editor = useEditorStore();
const host = ref<HTMLDivElement | null>(null);
const status = ref('');
let view: EditorView | null = null;
let applying = false;
let syncing = false;

const scope = computed(() => (editor.expertScope === 'scene' && editor.scene ? 'scene' : 'all'));

/** 当前编辑的文本（整片或单个场景） */
function currentText(): string {
  const sb = project.storyboard;
  if (!sb) return '';
  return JSON.stringify(scope.value === 'scene' ? editor.scene : sb, null, 2);
}

/** 把编辑器文本合成完整分镜，并给出属于本文本范围的问题（路径已去掉场景前缀） */
function evaluate(text: string): { next: Storyboard | null; issues: Issue[]; parseError?: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { next: null, issues: [], parseError: (e as Error).message };
  }
  const sb = project.storyboard!;
  const idx = editor.sceneIndex;
  const candidate =
    scope.value === 'scene'
      ? { ...sb, scenes: sb.scenes.map((s, i) => (i === idx ? (data as Scene) : s)) }
      : data;
  const all = validate(candidate);
  const prefix = `scenes[${idx}]`;
  const issues =
    scope.value === 'scene'
      ? all
          .filter(
            (i) => i.path === prefix || i.path.startsWith(prefix + '.') || i.path.startsWith(prefix + '['),
          )
          .map((i) => ({ ...i, path: i.path.slice(prefix.length).replace(/^\./, '') }))
      : all;
  const blocking = all.some((i) => i.level === 'error' && i.code === 'V1');
  return { next: blocking ? null : (candidate as Storyboard), issues };
}

const diagnostics = linter(
  (v) => {
    const text = v.state.doc.toString();
    const r = evaluate(text);
    if (r.parseError)
      return [
        {
          from: 0,
          to: Math.min(1, text.length),
          severity: 'error',
          message: `JSON 语法错误：${r.parseError}`,
        },
      ];
    return r.issues.map((i): Diagnostic => {
      const span = locate(text, i.path) ?? { from: 0, to: 1 };
      return { ...span, severity: i.level, message: `${i.code} ${i.message}` };
    });
  },
  { delay: 100 },
);

function onDocChanged(text: string) {
  const r = evaluate(text);
  if (r.parseError) {
    status.value = 'JSON 语法错误，修正后才会应用';
    return;
  }
  if (!r.next) {
    status.value = '结构不合法，修正标红的地方后才会应用';
    return;
  }
  const errors = r.issues.filter((i) => i.level === 'error').length;
  status.value = errors ? `已应用（还有 ${errors} 个错误）` : '已应用';
  applying = true;
  project.update(r.next, { coalesce: 'json-editor' });
  applying = false;
}

function setDoc(text: string) {
  if (!view || view.state.doc.toString() === text) return;
  syncing = true;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  syncing = false;
}

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: currentText(),
      extensions: [
        basicSetup,
        json(),
        oneDark,
        lintGutter(),
        diagnostics,
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !syncing) onDocChanged(u.state.doc.toString());
        }),
        EditorView.contentAttributes.of({ 'aria-label': '分镜 JSON 编辑器' }),
      ],
    }),
  });
});
onBeforeUnmount(() => view?.destroy());

// 外部修改（撤销、检查器、AI）同步进编辑器；自己触发的修改不回写，避免打断输入
watch([() => project.storyboard, scope, () => editor.sceneId], () => {
  if (!applying) setDoc(currentText());
});
</script>

<template>
  <div class="expert">
    <div class="bar">
      <NRadioGroup v-model:value="editor.expertScope" size="small">
        <NRadioButton value="scene" :disabled="!editor.scene">当前场景</NRadioButton>
        <NRadioButton value="all">整个分镜</NRadioButton>
      </NRadioGroup>
      <span class="status" data-testid="expert-status">{{ status }}</span>
    </div>
    <div ref="host" class="cm" data-testid="json-editor" />
  </div>
</template>

<style scoped>
.expert {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 8px;
}
.status {
  font-size: 12px;
  color: #aaa;
}
.cm {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.cm :deep(.cm-editor) {
  height: 100%;
}
</style>
