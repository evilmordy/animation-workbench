import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../tests/fixtures/pythagoras.json';
import { mockPlatform as p, resetMockFs } from '../platform/mock';
import type { Storyboard } from '../shared/schema';
import { AUTOSAVE_MS, MAX_SNAPSHOTS, MAX_UNDO, ProjectError, useProjectStore } from './project';

const sb = fixture as Storyboard;
const retitle = (s: Storyboard, title: string): Storyboard => ({ ...s, meta: { ...s.meta, title } });

beforeEach(() => {
  resetMockFs();
  setActivePinia(createPinia());
});
afterEach(() => vi.useRealTimers());

describe('项目 store', () => {
  it('新建项目生成目录结构，并加入最近项目', async () => {
    const s = useProjectStore();
    expect(await s.create('测试', sb, '/projects/a')).toBe(true);
    expect((await p.readDir('/projects/a')).sort()).toEqual(
      ['.awb', 'assets', 'exports', 'inputs', 'project.json', 'storyboard.json', 'versions'].sort(),
    );
    expect(JSON.parse(await p.readText('/projects/a/storyboard.json'))).toEqual(sb);
    expect(s.recent[0]).toMatchObject({ dir: '/projects/a', name: '测试' });
  });

  it('打开项目、最近项目最多 10 个且去重', async () => {
    const s = useProjectStore();
    for (let i = 0; i < 12; i++) await s.create(`p${i}`, sb, `/projects/p${i}`);
    await s.open('/projects/p3');
    expect(s.recent).toHaveLength(10);
    expect(s.recent[0]!.dir).toBe('/projects/p3');
    expect(new Set(s.recent.map((r) => r.dir)).size).toBe(10);
    setActivePinia(createPinia());
    const s2 = useProjectStore();
    await s2.loadRecent();
    expect(s2.recent[0]!.dir).toBe('/projects/p3');
  });

  it('自动保存 1s 防抖', async () => {
    vi.useFakeTimers();
    const s = useProjectStore();
    await s.create('x', sb, '/projects/x');
    s.update(retitle(sb, 'A'));
    s.update(retitle(sb, 'B'));
    expect(s.saveState).toBe('dirty');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 10);
    expect(JSON.parse(await p.readText('/projects/x/storyboard.json')).meta.title).toBe(sb.meta.title);
    await vi.advanceTimersByTimeAsync(20);
    expect(JSON.parse(await p.readText('/projects/x/storyboard.json')).meta.title).toBe('B');
    expect(s.saveState).toBe('saved');
  });

  it('撤销/重做，最多 100 步，新修改清空重做', async () => {
    const s = useProjectStore();
    await s.create('x', sb, '/projects/x');
    for (let i = 0; i < MAX_UNDO + 5; i++) s.update(retitle(sb, `t${i}`));
    let n = 0;
    while (s.canUndo) {
      s.undo();
      n++;
    }
    expect(n).toBe(MAX_UNDO);
    expect(s.storyboard!.meta.title).toBe('t4');
    s.redo();
    expect(s.storyboard!.meta.title).toBe('t5');
    s.update(retitle(sb, 'new'));
    expect(s.canRedo).toBe(false);
  });

  it('手动保存写快照，最多保留 50 份', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const s = useProjectStore();
    await s.create('x', sb, '/projects/x');
    for (let i = 0; i < MAX_SNAPSHOTS + 3; i++) {
      vi.setSystemTime(new Date(2026, 10, 2, 12, 0, i));
      await s.save(true);
    }
    const snaps = await s.listSnapshots();
    expect(snaps).toHaveLength(MAX_SNAPSHOTS);
    expect(snaps[0]).toBe('storyboard-20261102-120003-manual.json');
  });

  it('拒绝打开更新版本的 schema', async () => {
    const s = useProjectStore();
    await s.create('x', sb, '/projects/x');
    await p.writeTextAtomic('/projects/x/storyboard.json', JSON.stringify({ ...sb, schemaVersion: 2 }));
    await expect(s.open('/projects/x')).rejects.toThrow('更新版本');
  });

  it('storyboard.json 损坏时可以从最新快照恢复', async () => {
    const s = useProjectStore();
    await s.create('x', sb, '/projects/x');
    s.update(retitle(sb, '快照版'));
    await s.save(true);
    await p.writeTextAtomic('/projects/x/storyboard.json', '{ 坏掉了');
    const err = await s.open('/projects/x').catch((e) => e);
    expect(err).toBeInstanceOf(ProjectError);
    expect(err.recoverable).toBe(true);
    expect(await s.recover('/projects/x')).toBe(true);
    expect(s.storyboard!.meta.title).toBe('快照版');
  });

  it('示例项目不需要 Key 也能打开，再次打开保留修改', async () => {
    const s = useProjectStore();
    expect(await s.openSample()).toBe(true);
    expect(s.storyboard!.scenes).toHaveLength(3);
    s.update(retitle(s.storyboard!, '改过'));
    await s.save();
    await s.openSample();
    expect(s.storyboard!.meta.title).toBe('改过');
  });

  it('非项目目录给出明确错误', async () => {
    const s = useProjectStore();
    await p.mkdir('/projects/empty');
    await expect(s.open('/projects/empty')).rejects.toThrow('不是 Animation Workbench 项目');
  });
});
