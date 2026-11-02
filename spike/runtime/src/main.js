import {
  Player, Circle, Square, Text, MathTex, Create, Write, FadeIn, FadeOut, Transform, Indicate,
  onLog, setKatexStylesheetUrl, setMathJaxScriptUrl,
} from 'manim-web';
// 禁用一切 CDN 回退：失败要暴露成错误，而不是悄悄联网
setKatexStylesheetUrl(null);
setMathJaxScriptUrl(null);

const logs = [];
onLog((e) => logs.push(e));

async function threeScenes(scene) {
  const title = new Text({ text: '勾股定理：中文显示测试', fontSize: 40 });
  await scene.play(new Write(title));
  await scene.wait(0.5);

  await scene.nextSlide();
  const sum = new MathTex({ latex: '\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}' });
  await sum.waitForRender();
  await scene.play(new FadeOut(title), new FadeIn(sum));

  await scene.nextSlide();
  const integral = new MathTex({ latex: '\\int_0^1 x^2\\,dx = \\tfrac13' });
  const matrix = new MathTex({ latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' });
  await Promise.all([integral.waitForRender(), matrix.waitForRender()]);
  integral.moveTo([0, 1.5, 0]);
  matrix.moveTo([0, -1.5, 0]);
  await scene.play(new FadeOut(sum), new Write(integral), new Write(matrix));
  await scene.play(new Indicate(matrix));
}

// 20 场景 × 8 动画，用于重建耗时
async function bigScenes(scene) {
  for (let s = 0; s < 20; s++) {
    if (s > 0) await scene.nextSlide();
    const c = new Circle({ radius: 1 });
    const q = new Square({ sideLength: 1.5 });
    await scene.play(new Create(c));
    await scene.play(new Transform(c, q));
    await scene.play(new Indicate(c));
    await scene.play(new FadeOut(c));
    const c2 = new Circle({ radius: 0.5 });
    await scene.play(new FadeIn(c2));
    await scene.play(new Indicate(c2));
    await scene.play(new FadeOut(c2));
    await scene.wait(0.2);
  }
}

async function build(container, builder) {
  container.replaceChildren();
  const player = new Player(container, { width: 800, height: 450, allowExport: true });
  const t0 = performance.now();
  await player.sequence(builder);
  const buildMs = performance.now() - t0;
  const slides = player.timeline.getSlides().map((s) => ({ start: s.startTime, end: s.endTime }));
  return { player, buildMs, slides, duration: player.timeline.getDuration?.() };
}

export async function run(container) {
  const main = await build(container, threeScenes);
  return {
    manimWebVersion: __MANIM_WEB_VERSION__,
    hasVideoEncoder: typeof VideoEncoder !== 'undefined',
    ...main,
    logs,
  };
}

export async function bench(container, rounds = 3) {
  const times = [];
  let last;
  for (let i = 0; i < rounds; i++) {
    last?.player.dispose();
    last = await build(container, bigScenes);
    times.push(Math.round(last.buildMs));
  }
  return { times, slides: last.slides.length };
}