import { describe, expect, it } from 'vitest';
import { describeObject } from './fields';
import { ANIMS, ELEMENTS } from './registry';

const kinds = (type: keyof typeof ELEMENTS) =>
  Object.fromEntries(describeObject(ELEMENTS[type].props, ELEMENTS[type].refs).map((f) => [f.key, f.kind]));

describe('从注册表推断表单字段', () => {
  it('各类字段', () => {
    expect(kinds('Circle')).toEqual({ radius: 'number' });
    expect(kinds('Polygon')).toEqual({ points: 'points' });
    expect(kinds('Line')).toEqual({ start: 'vec2', end: 'vec2' });
    expect(kinds('Axes')).toEqual({
      xRange: 'range3',
      yRange: 'range3',
      xLength: 'number',
      yLength: 'number',
    });
    expect(kinds('FunctionGraph')).toEqual({ expr: 'text', xRange: 'vec2', axes: 'ref' });
    expect(kinds('Brace')).toEqual({ target: 'ref', dir: 'enum' });
    expect(kinds('Group')).toEqual({ children: 'refs' });
  });

  it('默认值、可选、正数约束和枚举选项', () => {
    const [radius] = describeObject(ELEMENTS.Circle.props);
    expect(radius).toMatchObject({ optional: true, defaultValue: 1, positive: true });
    const dir = describeObject(ELEMENTS.Brace.props, ELEMENTS.Brace.refs)[1]!;
    expect(dir.options).toContain('UL');
    expect(describeObject(ANIMS.SetColor.params)[0]).toMatchObject({
      key: 'color',
      kind: 'color',
      optional: false,
    });
  });
});
