import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/pythagoras.json';
import sample from '../../samples/pythagoras/storyboard.json';
import { newId } from './id';
import { ANIMS, ELEMENTS } from './registry';
import { formatPath, parseStoryboard } from './schema';

const clone = (): any => structuredClone(fixture);

describe('分镜 schema', () => {
  it('附录 A 的 fixture 通过校验，且与示例项目一致', () => {
    expect(parseStoryboard(fixture)).toMatchObject({ ok: true });
    expect(sample).toEqual(fixture);
  });

  const cases: [string, (d: any) => void, string][] = [
    ['schemaVersion 不对', (d) => (d.schemaVersion = 2), 'schemaVersion'],
    ['缺少 meta.title', (d) => delete d.meta.title, 'meta.title'],
    [
      '颜色格式错误',
      (d) => (d.scenes[0].elements[0].style.color = 'red'),
      'scenes[0].elements[0].style.color',
    ],
    ['未知元素类型', (d) => (d.scenes[0].elements[0].type = 'Star'), 'scenes[0].elements[0].type'],
    [
      '多边形少于 3 个点',
      (d) => d.scenes[0].elements[0].props.points.pop(),
      'scenes[0].elements[0].props.points',
    ],
    ['props 多余字段', (d) => (d.scenes[1].elements[0].props.color = '#fff'), 'scenes[1].elements[0].props'],
    [
      '正方形边长为负',
      (d) => (d.scenes[1].elements[0].props.sideLength = -1),
      'scenes[1].elements[0].props.sideLength',
    ],
    ['未知 step 类型', (d) => (d.scenes[0].steps[0].kind = 'jump'), 'scenes[0].steps[0].kind'],
    [
      '动画缺少 target',
      (d) => delete d.scenes[0].steps[0].anims[0].target,
      'scenes[0].steps[0].anims[0].target',
    ],
    [
      'Transform 缺少 to',
      (d) => (d.scenes[0].steps[0].anims[0].type = 'Transform'),
      'scenes[0].steps[0].anims[0].to',
    ],
    [
      'Shift 缺少 by',
      (d) => (d.scenes[2].steps[0].anims[0].type = 'Shift'),
      'scenes[2].steps[0].anims[0].params.by',
    ],
    ['lag 超过 1', (d) => (d.scenes[0].steps[1].lag = 2), 'scenes[0].steps[1].lag'],
    ['顶层多余字段', (d) => (d.extra = 1), ''],
  ];

  it.each(cases)('非法：%s', (_name, mutate, path) => {
    const d = clone();
    mutate(d);
    const r = parseStoryboard(d);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.map((i) => i.path)).toContain(path);
      expect(r.issues.every((i) => i.message.length > 0)).toBe(true);
    }
  });

  it('formatPath', () => {
    expect(formatPath(['scenes', 0, 'elements', 1, 'props', 'radius'])).toBe(
      'scenes[0].elements[1].props.radius',
    );
    expect(formatPath([])).toBe('');
  });
});

describe('注册表', () => {
  it('每个类型都有中文名和说明', () => {
    for (const spec of [...Object.values(ELEMENTS), ...Object.values(ANIMS)]) {
      expect(spec.label).toMatch(/\p{Script=Han}/u);
      expect(spec.desc.length).toBeGreaterThan(0);
    }
  });

  it('每个元素的示例 props 都合法', () => {
    for (const [type, spec] of Object.entries(ELEMENTS)) {
      expect(spec.props.safeParse(spec.example).success, type).toBe(true);
    }
  });

  it('props 默认值可以补齐', () => {
    expect(ELEMENTS.Circle.props.parse({})).toEqual({ radius: 1 });
    expect(ELEMENTS.MathTex.props.parse({ latex: 'a' })).toEqual({ latex: 'a', fontSize: 48 });
  });
});

describe('id', () => {
  it('格式合法且避开已有 id', () => {
    const id = newId('s');
    expect(id).toMatch(/^s_[a-z0-9]{6}$/);
    const taken = new Set([id]);
    expect(taken.has(newId('s', taken))).toBe(false);
  });
});
