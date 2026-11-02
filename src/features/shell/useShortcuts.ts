import { onBeforeUnmount, onMounted } from 'vue';
import { useEditorStore } from '../../stores/editor';
import { usePreviewStore } from '../../stores/preview';
import { useProjectStore } from '../../stores/project';
import { useSceneActions } from '../timeline/useSceneActions';

/** 焦点在输入控件里时不拦截快捷键（CodeMirror 是 contenteditable） */
export function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** PLAN T2.6 快捷键 */
export function useShortcuts() {
  const project = useProjectStore();
  const preview = usePreviewStore();
  const editor = useEditorStore();
  const actions = useSceneActions();

  function stepScene(delta: number) {
    const scenes = project.storyboard?.scenes ?? [];
    if (!scenes.length) return;
    const i = Math.max(
      0,
      Math.min(scenes.length - 1, (editor.sceneIndex < 0 ? -1 : editor.sceneIndex) + delta),
    );
    editor.selectScene(scenes[i]!.id);
    const span = preview.spans.find((s) => s.id === scenes[i]!.id);
    if (span) preview.seek(span.start + 0.001);
  }

  function onKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    // 撤销/重做/导出/AI 发送在输入框里也可用（CodeMirror 有自己的撤销，交给它处理）
    if (mod && key === 'enter') return run(e, () => editor.sendSignal++);
    if (mod && key === 'e') return run(e, () => (editor.exportOpen = true));
    if (mod && key === 's') return run(e, () => void project.save(true));
    if (isTyping(e.target)) return;
    if (mod && key === 'z' && e.shiftKey) return run(e, project.redo);
    if (mod && key === 'y') return run(e, project.redo);
    if (mod && key === 'z') return run(e, project.undo);
    if (mod && key === 'd' && editor.sceneId) return run(e, () => actions.duplicate(editor.sceneId!));
    if (mod || e.altKey) return;
    if (e.key === ' ') return run(e, preview.toggle);
    if (e.key === 'ArrowLeft')
      return run(e, () => (e.shiftKey ? preview.seek(preview.time - 1) : stepScene(-1)));
    if (e.key === 'ArrowRight')
      return run(e, () => (e.shiftKey ? preview.seek(preview.time + 1) : stepScene(1)));
    if ((e.key === 'Delete' || e.key === 'Backspace') && editor.sceneId)
      return run(e, () => actions.remove(editor.sceneId!));
  }

  function run(e: KeyboardEvent, fn: () => unknown) {
    e.preventDefault();
    fn();
  }

  onMounted(() => window.addEventListener('keydown', onKey));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
}
