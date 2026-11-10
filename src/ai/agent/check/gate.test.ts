// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { runScene, syntaxError, type BanMatch } from './gate';

const okScene = `
const box = el('div', { left: 80, top: 80, width: 200, height: 80, background: C.blue }, 'ok');
fadeIn(box, 0);
wait(1000);
`;

function match(result: Awaited<ReturnType<typeof runScene>>, rule: string): BanMatch | undefined {
  return result.ok ? undefined : result.error.matches?.find((item) => item.rule === rule);
}

describe('运行门', () => {
  it('能播的场通过，时长含 hold，场景里可以再声明 const W', async () => {
    const passed = await runScene(okScene);
    expect(passed.ok).toBe(true);
    if (passed.ok) expect(passed.durationMs).toBeGreaterThan(1000);

    const shadowed = await runScene(`const W = 320;\nconst box = el('div');\nfadeIn(box, 0);\nwait(500);`);
    expect(shadowed.ok).toBe(true);

    const held = await runScene('wait(50);', { hold: 1 });
    expect(held.ok).toBe(true);
    if (held.ok) expect(held.durationMs).toBeGreaterThan(1000);

    const titled = await runScene("head('这一行全是中文标题', 0);");
    expect(titled.ok).toBe(true);
  });

  it('loop:true、setTimeout、整行中文、anime.timeline()、200 秒各报错误码和行号', async () => {
    const looped = await runScene(
      ['const box = el("div");', 'tw(box, { x: [0, 40], duration: 800, loop: true }, 0);'].join('\n'),
    );
    expect(looped.ok).toBe(false);
    if (!looped.ok) {
      expect(looped.error.code).toBe('BANNED_API');
      expect(match(looped, 'loop: true')).toMatchObject({ line: 2 });
    }

    const timer = await runScene('setTimeout(() => {}, 0);\nwait(500);');
    expect(timer.ok).toBe(false);
    if (!timer.ok) {
      expect(timer.error.code).toBe('BANNED_API');
      expect(match(timer, 'setTimeout')).toMatchObject({ line: 1 });
    }

    const chinese = await runScene('这一轮只写说明，不写代码\nwait(500);');
    expect(chinese.ok).toBe(false);
    if (!chinese.ok) {
      expect(chinese.error.code).toBe('BANNED_API');
      expect(match(chinese, '整行中文')).toMatchObject({ line: 1, snippet: '这一轮只写说明，不写代码' });
    }

    const v3 = await runScene('anime.timeline({ autoplay: false });\nwait(500);');
    expect(v3.ok).toBe(false);
    if (!v3.ok) {
      expect(v3.error.code).toBe('BANNED_API');
      expect(match(v3, 'anime.timeline(')).toMatchObject({ line: 1 });
    }

    const long = await runScene('wait(200000);');
    expect(long.ok).toBe(false);
    if (!long.ok) {
      expect(long.error.code).toBe('DURATION_INVALID');
      expect(long.error.line).toBe(1);
      expect(long.error.snippet).toContain('200000');
      expect(long.error.hint).toBe('查 loop、wait');
      expect(long.durationMs).toBeGreaterThan(120_000);
    }
  });

  it('注释和字符串里的禁用词不误伤，root 上的 querySelector 可以用', async () => {
    const quoted = await runScene(`
      // setTimeout
      /* anime.timeline() */
      say('loop: true');
      const html = '<img src="https://example.com/a.png">';
      root.querySelectorAll('div');
      wait(500);
    `);
    expect(quoted.ok).toBe(false);
    if (!quoted.ok) {
      expect(quoted.error.code).toBe('BANNED_API');
      expect(quoted.error.matches?.map((item) => item.rule)).toEqual(['<img src="http']);
    }

    const outside = await runScene("document.querySelector('#a');\nwait(500);");
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(match(outside, 'querySelector 指向 root 之外')?.line).toBe(1);
  });

  it('§4.5 的其余写法都报 BANNED_API 和行号', async () => {
    const cases: [string, string][] = [
      ['anime({ duration: 1 });', 'anime('],
      ['anime.animate({}, {});', 'anime.animate('],
      ['anime.createTimeline();', 'anime.createTimeline('],
      ['createTimeline();', 'createTimeline('],
      ['tl.play();', 'tl.play('],
      ['tl.restart();', 'tl.restart('],
      ['tl.resume();', '.resume('],
      ['setInterval(() => {}, 1);', 'setInterval'],
      ['requestAnimationFrame(() => {});', 'requestAnimationFrame'],
      ['renderer.setAnimationLoop(() => {});', 'setAnimationLoop'],
      ['new THREE.Clock();', 'THREE.Clock'],
      ['@keyframes spin {}', '@keyframes'],
      ['const style = { animation: "spin 1s", transition: "opacity 1s" };', 'animation:'],
      ['tw(el("div"), { loop: Infinity, duration: 100 }, 0);', 'loop: Infinity'],
      ['tw(el("div"), { loop: 21, duration: 100 }, 0);', 'loop 数字 > 20'],
      ['Date.now();', 'Date.now'],
      ['performance.now();', 'performance.now'],
      ['new Date();', 'new Date('],
      ['Math.random();', 'Math.random'],
      ['fetch("/x");', 'fetch'],
      ['import x from "y";', 'import'],
      ['import("x");', 'import('],
      ['new XMLHttpRequest();', 'XMLHttpRequest'],
      ['document.body.append(root);', 'document.body'],
      ['document.getElementById("a");', 'document.getElementById'],
      ['export const a = 1;', 'export'],
      ['tw(el("div"), { onUpdate() {}, duration: 100 }, 0);', 'onUpdate'],
      ['tw(el("div"), { onRender() {}, duration: 100 }, 0);', 'onRender'],
      ['el("div", { background: "url(http://cdn.example/a.png)" });', 'url(http'],
    ];
    for (const [code, rule] of cases) {
      const result = await runScene(`${code}\nwait(500);`);
      expect(result.ok, code).toBe(false);
      if (!result.ok) {
        expect(result.error.code, code).toBe('BANNED_API');
        expect(match(result, rule), code).toMatchObject({ line: 1 });
      }
    }

    const allowed = await runScene('tw(el("div"), { loop: 20, duration: 100 }, 0);\nwait(500);');
    expect(allowed.ok).toBe(true);
  });

  it('语法错误带行号和疑似行，运行错误带回那一行', async () => {
    const located = syntaxError('const box = el("div");\nconst x = ;\nwait(500);');
    expect(located).toMatchObject({ line: 2, snippet: 'const x = ;' });
    expect(located?.message).toContain('疑似这一行');

    const compiled = await runScene('const box = el("div");\nconst x = ;\nwait(500);');
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) {
      expect(compiled.error.code).toBe('COMPILE_ERROR');
      expect(compiled.error.line).toBe(2);
      expect(compiled.error.hint).toBe('改那一行');
    }

    const crashed = await runScene('const box = el("div");\nthrow new Error("boom");\nwait(500);');
    expect(crashed.ok).toBe(false);
    if (!crashed.ok) {
      expect(crashed.error.code).toBe('RUNTIME_ERROR');
      expect(crashed.error.message).toBe('boom');
      expect(crashed.error.line).toBe(2);
      expect(crashed.error.snippet).toContain('throw new Error');
    }
  });

  it('短于 0.1 秒和整片超过 600 秒都不通过', async () => {
    const brief = await runScene('wait(50);');
    expect(brief.ok).toBe(false);
    if (!brief.ok) {
      expect(brief.error.code).toBe('DURATION_INVALID');
      expect(brief.durationMs).toBeLessThanOrEqual(100);
    }

    const film = await runScene(okScene, { otherDurationMs: 599_000 });
    expect(film.ok).toBe(false);
    if (!film.ok) {
      expect(film.error.code).toBe('DURATION_INVALID');
      expect(film.error.message).toContain('整片');
    }

    const empty = await runScene('   \n');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('COMPILE_ERROR');
  });
});
