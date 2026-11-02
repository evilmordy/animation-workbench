import { useDialog } from 'naive-ui';
import {
  deleteScene,
  duplicateScene,
  emptyScene,
  insertScene,
  moveScene,
  updateScene,
} from '../../shared/ops';
import { resizeScene, sceneDuration } from '../../shared/timing';
import { useEditorStore } from '../../stores/editor';
import { useProjectStore } from '../../stores/project';

/** 时间线、快捷键、右键菜单共用的场景操作 */
export function useSceneActions() {
  const project = useProjectStore();
  const editor = useEditorStore();
  const dialog = useDialog();
  const sb = () => project.storyboard!;
  const index = (id: string) => sb().scenes.findIndex((s) => s.id === id);

  function insertAfter(id: string | null) {
    const scene = emptyScene(sb());
    project.update(insertScene(sb(), id ? index(id) + 1 : sb().scenes.length, scene));
    editor.selectScene(scene.id);
  }

  function duplicate(id: string) {
    const next = duplicateScene(sb(), id);
    project.update(next);
    editor.selectScene(next.scenes[index(id) + 1]!.id);
  }

  function remove(id: string) {
    const s = sb().scenes[index(id)];
    if (!s) return;
    dialog.warning({
      title: '删除场景',
      content: `确定删除"${s.title}"吗？删除后可以用 Ctrl+Z 撤销。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: () => {
        const i = index(id);
        project.update(deleteScene(sb(), id));
        const neighbor = sb().scenes[Math.min(i, sb().scenes.length - 1)];
        editor.selectScene(neighbor?.id ?? null);
      },
    });
  }

  function move(id: string, delta: number) {
    const i = index(id);
    const to = i + delta;
    if (i < 0 || to < 0 || to >= sb().scenes.length) return;
    project.update(moveScene(sb(), i, to));
  }

  function toggleLock(id: string) {
    project.update(updateScene(sb(), id, (s) => ({ ...s, locked: !s.locked || undefined })));
  }

  function resizeBy(id: string, delta: number) {
    const i = index(id);
    const s = sb().scenes[i];
    if (!s) return;
    resizeTo(id, Math.max(0.1, sceneDuration(s, i) + delta));
  }

  function resizeTo(id: string, seconds: number) {
    const i = index(id);
    project.update(updateScene(sb(), id, (s) => resizeScene(s, i, seconds)));
  }

  return { insertAfter, duplicate, remove, move, toggleLock, resizeBy, resizeTo };
}
