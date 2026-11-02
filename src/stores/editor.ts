import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useProjectStore } from './project';

export type LeftTab = 'project' | 'inputs' | 'ai';
export type InspectorTab = 'scene' | 'elements' | 'steps' | 'global';

/** 界面选择状态（不写入项目文件） */
export const useEditorStore = defineStore('editor', () => {
  const sceneId = ref<string | null>(null);
  const elementId = ref<string | null>(null);
  const stepId = ref<string | null>(null);
  const leftTab = ref<LeftTab>('project');
  const inspectorTab = ref<InspectorTab>('scene');
  const expertOpen = ref(false);
  const expertScope = ref<'scene' | 'all'>('scene');
  const exportOpen = ref(false);
  const settingsOpen = ref(false);
  /** Ctrl+Enter 递增它，AI 面板监听后发送指令 */
  const sendSignal = ref(0);

  const project = useProjectStore();
  const sceneIndex = computed(
    () => project.storyboard?.scenes.findIndex((s) => s.id === sceneId.value) ?? -1,
  );
  const scene = computed(() =>
    sceneIndex.value >= 0 ? project.storyboard!.scenes[sceneIndex.value]! : null,
  );

  function selectScene(id: string | null) {
    sceneId.value = id;
    elementId.value = null;
    stepId.value = null;
  }

  /** 跳到某个 JSON 路径对应的场景/元素/步骤（问题列表用） */
  function reveal(path: string) {
    const m = /^scenes\[(\d+)\](?:\.(elements|steps)\[(\d+)\])?/.exec(path);
    const sc = m && project.storyboard?.scenes[Number(m[1])];
    if (!sc) {
      inspectorTab.value = 'global';
      return;
    }
    selectScene(sc.id);
    if (m[2] === 'elements') {
      elementId.value = sc.elements[Number(m[3])]?.id ?? null;
      inspectorTab.value = 'elements';
    } else if (m[2] === 'steps') {
      stepId.value = sc.steps[Number(m[3])]?.id ?? null;
      inspectorTab.value = 'steps';
    } else inspectorTab.value = 'scene';
  }

  return {
    sceneId,
    elementId,
    stepId,
    leftTab,
    inspectorTab,
    expertOpen,
    expertScope,
    exportOpen,
    settingsOpen,
    sendSignal,
    sceneIndex,
    scene,
    selectScene,
    reveal,
  };
});
