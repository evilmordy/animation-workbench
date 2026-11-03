import type { InspectorTab } from '../../stores/editor';

export const INSPECTOR_TABS: { key: InspectorTab; label: string }[] = [
  { key: 'scene', label: '场景' },
  { key: 'elements', label: '元素' },
  { key: 'steps', label: '步骤' },
  { key: 'global', label: '全局' },
];

/**
 * 代码场景开关关掉时，标签栏与原来相同，哪怕某场 kind 是 code。
 * 开关打开且当前场是 kind:code 时，藏起元素和步骤，不删这两个组件。
 */
export function visibleInspectorTabs(opts: { codeScenes: boolean; kind?: string }) {
  const codeScene = opts.codeScenes && opts.kind === 'code';
  return codeScene
    ? INSPECTOR_TABS.filter((t) => t.key !== 'elements' && t.key !== 'steps')
    : [...INSPECTOR_TABS];
}
