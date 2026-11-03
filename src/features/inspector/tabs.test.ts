import { describe, expect, it } from 'vitest';
import { visibleInspectorTabs } from './tabs';

describe('检查器标签', () => {
  it('kind:code 且代码场景打开时藏起元素和步骤，dsl 与关 flag 保持原样', () => {
    const labels = (codeScenes: boolean, kind?: string) =>
      visibleInspectorTabs({ codeScenes, kind }).map((tab) => tab.key);

    expect(labels(false, 'dsl')).toEqual(['scene', 'elements', 'steps', 'global']);
    expect(labels(false, 'code')).toEqual(['scene', 'elements', 'steps', 'global']);
    expect(labels(true, 'dsl')).toEqual(['scene', 'elements', 'steps', 'global']);
    expect(labels(true, undefined)).toEqual(['scene', 'elements', 'steps', 'global']);
    expect(labels(true, 'code')).toEqual(['scene', 'global']);
  });
});
