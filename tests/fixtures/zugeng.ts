import type { Scene, Storyboard } from '../../src/shared/schema';

/**
 * 祖暅原理求球体积。全片共用同一组常量（R / 左右圆心 / 底边），
 * 对象只用动画引入，换场先把 ctx.present() FadeOut。禁止 scene.add。
 *
 * 半球（平底在 BASE）在高度 h 处的截面半径是 sqrt(R²−h²)，面积 π(R²−h²)。
 * 旁边等高的圆柱挖去倒立圆锥：截面是外半径 R、内半径 h 的环，面积同样是 π(R²−h²)。
 * 半球体积 = 圆柱 − 圆锥 = ⅔πR³，球体积 = ⁴⁄₃πR³。
 */
const SHARED = `const R = 1.6;
const LEFT = -3.2;
const RIGHT = 3.2;
const BASE = -2.0;
const INK = '#F7F8FA';
const HEMI = '#58C4DD';
const CYL = '#83C167';
const CONE = '#FC6255';
const CUT = '#FFD166';
const tag = (m) => { m.awbTag = TAG; return m; };
const paint = (m, color, fill) => {
  m.setColor(color);
  if (fill > 0) m.setFill(color, fill);
  return tag(m);
};
const caption = (text, at, size) => {
  const t = tag(new M.Text({ text, fontSize: size, color: INK, fontFamily: 'sans-serif' }));
  t.moveTo(at);
  return t;
};`;

const SOLIDS = `const dome = paint(new M.Sector({ radius: R, startAngle: 0, angle: Math.PI, color: HEMI, fillOpacity: 0.35, strokeWidth: 4, center: [LEFT, BASE, 0] }), HEMI, 0.35);
const dia = paint(new M.Line({ start: [LEFT - R, BASE, 0], end: [LEFT + R, BASE, 0], color: INK, strokeWidth: 4 }), INK, 0);
const cyl = paint(new M.Rectangle({ width: 2 * R, height: R, color: CYL, fillOpacity: 0.16, strokeWidth: 4, center: [RIGHT, BASE + R / 2, 0] }), CYL, 0.16);
const cone = paint(new M.Polygon({ vertices: [[RIGHT, BASE, 0], [RIGHT - R, BASE + R, 0], [RIGHT + R, BASE + R, 0]], color: CONE, fillOpacity: 0.45, strokeWidth: 3 }), CONE, 0.45);`;

const CLEAR = `const lingering = ctx.present();
if (lingering.length) await scene.play(...lingering.map((m) => new M.FadeOut(m, { duration: 0.5 })));`;

function source(tag: string, marker: string, clear: boolean, body: string): string {
  return `const TAG = ${JSON.stringify(tag)};
const MARK = ${JSON.stringify(marker)};
${SHARED}
${clear ? CLEAR : ''}
${body}`;
}

const scene = (id: string, title: string, description: string, hold: number, code: string): Scene => ({
  id,
  title,
  description,
  notes: '浅色字、黑底。对象用动画引入；换场 FadeOut 清场。',
  kind: 'code',
  enter: 'fresh',
  hold,
  elements: [],
  steps: [],
  code,
});

export const ZUGENG_MARKERS = [
  { id: 's_ask', marker: '#FF2BD6' },
  { id: 's_solids', marker: '#39FF14' },
  { id: 's_slice', marker: '#00E5FF' },
  { id: 's_derive', marker: '#FFE14A' },
] as const;

const mark = `const mark = paint(new M.Rectangle({ width: 0.5, height: 0.5, color: MARK, fillOpacity: 1, strokeWidth: 0, center: [6.3, 3.3, 0] }), MARK, 1);`;

export const zugeng: Storyboard = {
  schemaVersion: 1,
  meta: {
    title: '祖暅原理求球体积',
    mode: '2d',
    aspect: '16:9',
    background: '#000000',
    stylePreset: '3b1b',
  },
  scenes: [
    scene(
      's_ask',
      '等高截面，体积相等',
      '提出祖暅原理，并画出待求体积的球。',
      3.4,
      source(
        's_ask',
        ZUGENG_MARKERS[0].marker,
        false,
        `${mark}
const title = caption('祖暅原理', [0, 3.15, 0], 42);
const sub = caption('等高处截面积相等，则体积相等', [0, 2.4, 0], 28);
await scene.play(new M.FadeIn(mark, { duration: 0.6 }), new M.FadeIn(title, { duration: 0.8 }), new M.FadeIn(sub, { duration: 0.8 }));
const ball = paint(new M.Circle({ radius: R, color: HEMI, fillOpacity: 0.2, strokeWidth: 5, center: [0, -0.35, 0] }), HEMI, 0.2);
await scene.play(new M.Create(ball, { duration: 1.2 }));
const ask = tag(new M.MathTex({ latex: 'V=\\\\,?', color: INK, fontSize: 48 }));
await ask.waitForRender();
ask.moveTo([0, -2.45, 0]);
await scene.play(new M.Write(ask, { duration: 1 }));`,
      ),
    ),
    scene(
      's_solids',
      '半球与圆柱挖锥',
      '同一 R：左边半球，右边等高圆柱挖去倒立圆锥。',
      3.3,
      source(
        's_solids',
        ZUGENG_MARKERS[1].marker,
        true,
        `${mark}
const title = caption('半球，对照挖去圆锥的圆柱', [0, 3.15, 0], 32);
await scene.play(new M.FadeIn(mark, { duration: 0.5 }), new M.FadeIn(title, { duration: 0.7 }));
${SOLIDS}
await scene.play(new M.Create(dome, { duration: 1.1 }), new M.Create(dia, { duration: 0.8 }), new M.Create(cyl, { duration: 1.1 }), new M.Create(cone, { duration: 1.1 }));
const leftLabel = caption('半球', [LEFT, BASE + R + 0.48, 0], 28);
const rightLabel = caption('圆柱 − 圆锥', [RIGHT, BASE + R + 0.48, 0], 28);
const note = caption('底面半径都是 R，高都是 R', [0, -3.05, 0], 28);
await scene.play(new M.FadeIn(leftLabel, { duration: 0.6 }), new M.FadeIn(rightLabel, { duration: 0.6 }), new M.FadeIn(note, { duration: 0.6 }));`,
      ),
    ),
    scene(
      's_slice',
      '等高截面同步',
      '截面从底扫到顶。半球截面是圆，圆柱挖锥是圆环，面积都是 π(R²−h²)。',
      4.8,
      source(
        's_slice',
        ZUGENG_MARKERS[2].marker,
        true,
        `${mark}
const title = caption('同一高度 h，两边截面积相等', [0, 3.2, 0], 30);
const formula = tag(new M.MathTex({ latex: 'S=\\\\pi(R^{2}-h^{2})', color: INK, fontSize: 42 }));
await formula.waitForRender();
formula.moveTo([0, 2.4, 0]);
await scene.play(new M.FadeIn(mark, { duration: 0.4 }), new M.FadeIn(title, { duration: 0.6 }), new M.Write(formula, { duration: 0.8 }));
${SOLIDS}
await scene.play(new M.Create(dome, { duration: 0.7 }), new M.Create(dia, { duration: 0.5 }), new M.Create(cyl, { duration: 0.7 }), new M.Create(cone, { duration: 0.7 }));
let sweep = [];
const heights = [0.4, 1.2, 0.7, 0.9];
for (const h of heights) {
  if (sweep.length) await scene.play(...sweep.map((m) => new M.FadeOut(m, { duration: 0.2 })));
  const r = Math.sqrt(R * R - h * h);
  const y = BASE + h;
  const chord = paint(new M.Line({ start: [LEFT - r, y, 0], end: [LEFT + r, y, 0], color: CUT, strokeWidth: 8 }), CUT, 0);
  const cut = paint(new M.Line({ start: [RIGHT - R, y, 0], end: [RIGHT + R, y, 0], color: CUT, strokeWidth: 8 }), CUT, 0);
  const disk = paint(new M.Circle({ radius: Math.max(0.05, r * 0.42), color: HEMI, fillOpacity: 0.92, strokeWidth: 2, center: [-0.75, 1.05, 0] }), HEMI, 0.92);
  const ring = paint(new M.Annulus({ innerRadius: Math.max(0.04, h * 0.42), outerRadius: R * 0.42, color: CYL, fillOpacity: 0.92, strokeWidth: 2, center: [0.95, 1.05, 0] }), CYL, 0.92);
  sweep = [chord, cut, disk, ring];
  await scene.play(...sweep.map((m) => new M.FadeIn(m, { duration: 0.45 })));
}`,
      ),
    ),
    scene(
      's_derive',
      '推到球体积',
      '半球等于圆柱减圆锥，得到 ⅔πR³；球是两个半球，得到 ⁴⁄₃πR³。',
      4,
      source(
        's_derive',
        ZUGENG_MARKERS[3].marker,
        true,
        `${mark}
const title = caption('所以球的体积是 ⁴⁄₃ π R³', [0, 3.05, 0], 32);
await scene.play(new M.FadeIn(mark, { duration: 0.4 }), new M.FadeIn(title, { duration: 0.7 }));
const line1 = caption('半球 = 圆柱 − 圆锥', [0, 1.55, 0], 32);
const eq1 = tag(new M.MathTex({ latex: '\\\\pi R^{2}\\\\cdot R-\\\\frac{1}{3}\\\\pi R^{2}\\\\cdot R=\\\\frac{2}{3}\\\\pi R^{3}', color: INK, fontSize: 36 }));
await eq1.waitForRender();
eq1.moveTo([0, 0.55, 0]);
await scene.play(new M.FadeIn(line1, { duration: 0.6 }), new M.Write(eq1, { duration: 1.2 }));
const line2 = caption('整球 = 两个半球', [0, -0.7, 0], 32);
const eq2 = tag(new M.MathTex({ latex: '2\\\\times\\\\frac{2}{3}\\\\pi R^{3}=\\\\frac{4}{3}\\\\pi R^{3}', color: INK, fontSize: 42 }));
await eq2.waitForRender();
eq2.moveTo([0, -1.75, 0]);
await scene.play(new M.FadeIn(line2, { duration: 0.6 }), new M.Write(eq2, { duration: 1.2 }));`,
      ),
    ),
  ],
};
