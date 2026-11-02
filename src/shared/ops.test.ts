import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/pythagoras.json';
import { applyOps, deleteScene, duplicateScene, EditOps, emptyScene, insertScene, moveScene } from './ops';
import type { Storyboard } from './schema';
import { validate } from './validate';

const sb = fixture as Storyboard;
const ids = (s: Storyboard) => s.scenes.map((x) => x.id);

describe('场景操作', () => {
  it('插入、删除、移动', () => {
    const e = emptyScene(sb);
    const a = insertScene(sb, 1, e);
    expect(ids(a)).toEqual(['s_tri001', e.id, 's_sq0002', 's_eq0003']);
    // 插在中间会打断 keep 场景的继承（V3 报错是正确的），插在末尾则仍然合法
    expect(validate(a).some((i) => i.code === 'V3')).toBe(true);
    expect(validate(insertScene(sb, 3, e))).toEqual([]);
    expect(ids(deleteScene(a, e.id))).toEqual(ids(sb));
    expect(ids(moveScene(sb, 0, 2))).toEqual(['s_sq0002', 's_eq0003', 's_tri001']);
  });

  it('复制场景：换新 id、内部引用同步改名，结果仍然合法', () => {
    const d = duplicateScene(sb, 's_tri001');
    expect(d.scenes).toHaveLength(4);
    const copy = d.scenes[1]!;
    expect(copy.title).toBe('引入直角三角形（副本）');
    expect(copy.elements.map((e) => e.id)).not.toContain('tri');
    const triCopy = copy.elements[0]!.id;
    expect(copy.elements[1]!.place!.nextTo!.id).toBe(triCopy);
    const first = copy.steps[0]!;
    expect(first.kind === 'play' && first.anims[0]!.target).toBe(triCopy);
    // 副本紧跟原场景且是 keep：没有改名的话会和继承的在场元素冲突
    expect(validate(d).filter((i) => i.code === 'V2')).toEqual([]);
  });
});

describe('AI 修改操作', () => {
  it('replace / insert / delete / move，锁定场景被跳过', () => {
    const locked: Storyboard = {
      ...sb,
      scenes: sb.scenes.map((s, i) => (i === 2 ? { ...s, locked: true } : s)),
    };
    const newScene = { ...sb.scenes[0]!, id: 's_new', title: '新' };
    const ops = EditOps.parse({
      ops: [
        { op: 'replaceScene', id: 's_tri001', scene: { ...sb.scenes[0], title: '改过', id: 'whatever' } },
        { op: 'insertScene', after: 's_tri001', scene: newScene },
        { op: 'deleteScene', id: 's_eq0003' },
        { op: 'moveScene', id: 's_new', after: null },
        { op: 'deleteScene', id: 'nope' },
      ],
    }).ops;
    const r = applyOps(locked, ops);
    expect(ids(r.storyboard)).toEqual(['s_new', 's_tri001', 's_sq0002', 's_eq0003']);
    expect(r.storyboard.scenes[1]!.title).toBe('改过');
    expect(r.changed.sort()).toEqual(['s_new', 's_tri001']);
    expect(r.skipped).toEqual(['deleteScene：场景 s_eq0003 已锁定', 'deleteScene：场景 nope 不存在']);
  });

  it('插入的场景 id 重复时自动换新', () => {
    const r = applyOps(sb, [{ op: 'insertScene', after: null, scene: sb.scenes[0]! }]);
    expect(new Set(ids(r.storyboard)).size).toBe(4);
  });

  it('操作列表的结构校验', () => {
    expect(EditOps.safeParse({ ops: [] }).success).toBe(false);
    expect(EditOps.safeParse({ ops: [{ op: 'rename', id: 'x' }] }).success).toBe(false);
  });
});
