import { computed } from 'vue';
import { updateScene } from '../../shared/ops';
import type { Scene } from '../../shared/schema';
import { inheritedIds } from '../../shared/validate';
import { useEditorStore } from '../../stores/editor';
import { useProjectStore } from '../../stores/project';

/** 检查器修改当前场景；同一字段的连续输入合并为一步撤销 */
export function useSceneEdit() {
  const project = useProjectStore();
  const editor = useEditorStore();

  function patch(field: string, fn: (s: Scene) => Scene) {
    if (!project.storyboard || !editor.sceneId) return;
    project.update(updateScene(project.storyboard, editor.sceneId, fn), {
      coalesce: `inspector:${editor.sceneId}:${field}`,
    });
  }

  /** 当前场景可引用的元素：继承来的在场元素 + 本场景定义的元素 */
  const refIds = computed(() => {
    const sb = project.storyboard;
    const i = editor.sceneIndex;
    if (!sb || i < 0) return [];
    const inherited = inheritedIds(sb)[i] ?? [];
    return [...new Set([...inherited, ...sb.scenes[i]!.elements.map((e) => e.id)])];
  });

  const issuesAt = (prefix: string) =>
    project.issues.filter(
      (x) => x.path === prefix || x.path.startsWith(prefix + '.') || x.path.startsWith(prefix + '['),
    );

  return { patch, refIds, issuesAt };
}
