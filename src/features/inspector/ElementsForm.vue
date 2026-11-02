<script setup lang="ts">
import { NButton, NDivider, NEmpty, NFormItem, NInputNumber, NSelect, NTag } from 'naive-ui';
import RangeInput from '../shell/RangeInput.vue';
import { computed, ref } from 'vue';
import { describeObject, type Field } from '../../shared/fields';
import { newId } from '../../shared/id';
import { DIRS, ELEMENTS, ELEMENT_TYPES, type ElementType } from '../../shared/registry';
import type { Element, Scene } from '../../shared/schema';
import { useEditorStore } from '../../stores/editor';
import FieldInput from './FieldInput.vue';
import ColorInput from './ColorInput.vue';
import { useSceneEdit } from './useSceneEdit';

const editor = useEditorStore();
const { patch, refIds, issuesAt } = useSceneEdit();
const scene = computed(() => editor.scene!);
const newType = ref<ElementType>('Circle');
const typeOptions = ELEMENT_TYPES.map((t) => ({ label: `${ELEMENTS[t].label}（${t}）`, value: t }));
const dirOptions = DIRS.map((d) => ({ label: d, value: d }));

const current = computed(() => scene.value.elements.find((e) => e.id === editor.elementId) ?? null);
const index = computed(() => scene.value.elements.findIndex((e) => e.id === editor.elementId));
const fields = computed<Field[]>(() =>
  current.value ? describeObject(ELEMENTS[current.value.type].props, ELEMENTS[current.value.type].refs) : [],
);
const otherIds = computed(() => refIds.value.filter((id) => id !== editor.elementId));

function editEl(field: string, fn: (e: Element) => Element) {
  const id = editor.elementId;
  patch(`el:${id}:${field}`, (s) => ({ ...s, elements: s.elements.map((e) => (e.id === id ? fn(e) : e)) }));
}
const setProp = (key: string, v: unknown) =>
  editEl(`p.${key}`, (e) => {
    const props = { ...e.props };
    if (v === undefined || v === null || v === '') delete props[key];
    else props[key] = v;
    return { ...e, props };
  });
const setPlace = (key: 'at' | 'nextTo' | 'toEdge', v: unknown) =>
  editEl(`place.${key}`, (e) => {
    const place: Record<string, unknown> = { ...e.place };
    if (v === undefined || v === null) delete place[key];
    else place[key] = v;
    const { place: _old, ...rest } = e;
    void _old;
    return Object.keys(place).length ? { ...rest, place: place as Element['place'] } : rest;
  });
const setStyle = (key: string, v: unknown) =>
  editEl(`style.${key}`, (e) => {
    const style: Record<string, unknown> = { ...e.style };
    if (v === undefined || v === null) delete style[key];
    else style[key] = v;
    const { style: _old, ...rest } = e;
    void _old;
    return Object.keys(style).length ? { ...rest, style: style as Element['style'] } : rest;
  });

function add() {
  const taken = new Set(refIds.value);
  const id = newId(newType.value.toLowerCase().slice(0, 4), taken);
  const example = structuredClone(ELEMENTS[newType.value].example);
  // 示例里的引用换成本场景真实存在的元素
  for (const key of ELEMENTS[newType.value].refs ?? []) {
    if (key in example)
      example[key] = Array.isArray(example[key]) ? refIds.value.slice(0, 2) : refIds.value[0];
  }
  const el: Element = { id, type: newType.value, props: example, place: { at: [0, 0] } };
  patch(`add:${id}`, (s) => ({ ...s, elements: [...s.elements, el] }));
  editor.elementId = id;
}

/** 删除元素，同时删掉本场景里以它为目标的动画（变空的步骤一起删掉） */
function remove(id: string) {
  patch(`del:${id}`, (s): Scene => ({
    ...s,
    elements: s.elements.filter((e) => e.id !== id),
    steps: s.steps
      .map((st) =>
        st.kind === 'play' ? { ...st, anims: st.anims.filter((a) => a.target !== id && a.to !== id) } : st,
      )
      .filter((st) => st.kind === 'wait' || st.anims.length > 0),
  }));
  editor.elementId = null;
}
</script>

<template>
  <div class="elements" data-testid="elements-form">
    <div class="add">
      <NSelect
        v-model:value="newType"
        size="small"
        :options="typeOptions"
        filterable
        :input-props="{ 'aria-label': '新元素类型' }"
        aria-label="新元素类型"
      />
      <NButton size="small" type="primary" data-testid="add-element" @click="add">添加</NButton>
    </div>
    <NEmpty v-if="!scene.elements.length" description="这个场景还没有元素" />
    <ul class="list" role="listbox" aria-label="元素列表">
      <li
        v-for="(e, i) in scene.elements"
        :key="e.id"
        role="option"
        tabindex="0"
        :aria-selected="e.id === editor.elementId"
        :class="{ selected: e.id === editor.elementId }"
        @click="editor.elementId = e.id"
        @keydown.enter="editor.elementId = e.id"
      >
        <span class="type">{{ ELEMENTS[e.type].label }}</span>
        <code>{{ e.id }}</code>
        <NTag v-if="issuesAt(`scenes[${editor.sceneIndex}].elements[${i}]`).length" size="tiny" type="error"
          >!</NTag
        >
      </li>
    </ul>

    <template v-if="current">
      <NDivider title-placement="left">
        {{ ELEMENTS[current.type].label }} <code>{{ current.id }}</code>
      </NDivider>
      <p class="desc">{{ ELEMENTS[current.type].desc }}</p>
      <ul v-if="issuesAt(`scenes[${editor.sceneIndex}].elements[${index}]`).length" class="issues">
        <li v-for="(x, k) in issuesAt(`scenes[${editor.sceneIndex}].elements[${index}]`)" :key="k">
          {{ x.message }}
        </li>
      </ul>
      <NFormItem
        v-for="f in fields"
        :key="f.key"
        :label="f.key"
        size="small"
        label-placement="left"
        label-width="90"
      >
        <FieldInput
          :field="f"
          :value="current.props[f.key]"
          :ref-options="otherIds"
          @update:value="(v) => setProp(f.key, v)"
        />
      </NFormItem>

      <NDivider title-placement="left">位置</NDivider>
      <NFormItem label="坐标 at" size="small" label-placement="left" label-width="90">
        <FieldInput
          :field="{ key: 'at', kind: 'vec2', optional: true }"
          :value="current.place?.at"
          @update:value="(v) => setPlace('at', v)"
        />
      </NFormItem>
      <NFormItem label="紧挨" size="small" label-placement="left" label-width="90">
        <div class="row">
          <NSelect
            size="small"
            clearable
            placeholder="元素"
            :value="current.place?.nextTo?.id ?? null"
            :options="otherIds.map((id) => ({ label: id, value: id }))"
            @update:value="
              (v: string | null) =>
                setPlace('nextTo', v ? { id: v, dir: current!.place?.nextTo?.dir ?? 'RIGHT' } : undefined)
            "
          />
          <NSelect
            v-if="current.place?.nextTo"
            size="small"
            :value="current.place.nextTo.dir"
            :options="dirOptions"
            @update:value="(v: string) => setPlace('nextTo', { ...current!.place!.nextTo!, dir: v })"
          />
        </div>
      </NFormItem>
      <NFormItem label="贴边" size="small" label-placement="left" label-width="90">
        <NSelect
          size="small"
          clearable
          placeholder="不贴边"
          :value="current.place?.toEdge ?? null"
          :options="dirOptions"
          @update:value="(v: string | null) => setPlace('toEdge', v ?? undefined)"
        />
      </NFormItem>

      <NDivider title-placement="left">样式</NDivider>
      <NFormItem label="线条/文字色" size="small" label-placement="left" label-width="90">
        <ColorInput clearable :value="current.style?.color" @update:value="(v) => setStyle('color', v)" />
      </NFormItem>
      <NFormItem label="填充色" size="small" label-placement="left" label-width="90">
        <ColorInput clearable :value="current.style?.fill" @update:value="(v) => setStyle('fill', v)" />
      </NFormItem>
      <NFormItem label="填充不透明度" size="small" label-placement="left" label-width="90">
        <RangeInput
          :value="current.style?.fillOpacity ?? 0"
          :min="0"
          :max="1"
          :step="0.05"
          label="填充不透明度"
          @update:value="(v: number) => setStyle('fillOpacity', v)"
        />
      </NFormItem>
      <NFormItem label="线宽" size="small" label-placement="left" label-width="90">
        <NInputNumber
          :show-button="false"
          size="small"
          clearable
          :min="0"
          :step="0.5"
          :value="current.style?.strokeWidth"
          @update:value="(v: number | null) => setStyle('strokeWidth', v ?? undefined)"
        />
      </NFormItem>
      <NFormItem label="缩放" size="small" label-placement="left" label-width="90">
        <NInputNumber
          :show-button="false"
          size="small"
          clearable
          :min="0.05"
          :step="0.1"
          :value="current.style?.scale"
          @update:value="(v: number | null) => setStyle('scale', v ?? undefined)"
        />
      </NFormItem>
      <NFormItem label="旋转（度）" size="small" label-placement="left" label-width="90">
        <NInputNumber
          :show-button="false"
          size="small"
          clearable
          :step="15"
          :value="current.style?.rotate"
          @update:value="(v: number | null) => setStyle('rotate', v ?? undefined)"
        />
      </NFormItem>
      <NButton size="small" type="error" ghost data-testid="delete-element" @click="remove(current.id)">
        删除这个元素
      </NButton>
    </template>
  </div>
</template>

<style scoped>
.add,
.row {
  display: flex;
  gap: 6px;
  width: 100%;
}
.add {
  margin-bottom: 8px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.list li {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
}
.list li.selected {
  background: rgba(99, 226, 183, 0.15);
}
.list li:focus-visible {
  outline: 2px solid #70c0e8;
}
.type {
  min-width: 56px;
}
code {
  font-size: 12px;
  opacity: 0.75;
}
.desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  margin: 0 0 8px;
}
.issues {
  color: #ff8a80;
  font-size: 12px;
  padding-left: 16px;
}
</style>
