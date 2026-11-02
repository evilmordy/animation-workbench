// T0.2：在预览 CSP 下加载 runtime.js，验证 slides/seek/中文/MathTex 离线，并测重建耗时。
// 用法：node check.mjs [chromium|webkit|firefox]
import { readFileSync } from 'node:fs';
import { chromium, webkit, firefox } from '@playwright/test';

const CSP = "default-src 'none'; script-src http://awpreview.test 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";
const ORIGIN = 'http://awpreview.test';
const files = {
  '/index.html': ['harness/index.html', 'text/html; charset=utf-8'],
  '/harness.js': ['harness/harness.js', 'text/javascript'],
  '/runtime.js': ['dist-runtime/runtime.js', 'text/javascript'],
};

const name = process.argv[2] ?? 'chromium';
const browser = await { chromium, webkit, firefox }[name].launch(name === 'chromium' ? { channel: 'chromium' } : {});
const page = await browser.newPage();
const external = [];
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.route('**/*', (route) => {
  const url = new URL(route.request().url());
  const f = url.origin === ORIGIN && files[url.pathname];
  if (!f) {
    external.push(route.request().url());
    return route.abort();
  }
  return route.fulfill({ body: readFileSync(f[0]), contentType: f[1], headers: { 'Content-Security-Policy': CSP } });
});

const t0 = Date.now();
await page.goto(`${ORIGIN}/index.html`);
const r = await page.evaluate(() => window.__result);
const loadMs = Date.now() - t0;

let seekOk = null;
let bench = null;
if (!r.fatal) {
  // seek 前后跳：跳到第 3 个 slide 中间，再跳回第 1 个，检查 timeline 时间
  seekOk = await page.evaluate((slides) => {
    const p = window.__player;
    const out = [];
    for (const t of [(slides[2].start + slides[2].end) / 2, slides[0].start + 0.1, slides[1].end - 0.05]) {
      p.seek(t);
      out.push(Math.abs(p.timeline.getCurrentTime() - t) < 1e-6);
    }
    return out;
  }, r.slides);
  await page.evaluate((d) => window.__player.seek(d - 0.01), r.duration);
  await page.screenshot({ path: `shot-${name}-end.png` });
  await page.evaluate(() => window.__player.seek(0.9));
  await page.screenshot({ path: `shot-${name}-zh.png` });
  bench = await page.evaluate(() => AwbSpike.bench(document.getElementById('stage'), 3));
}

console.log(JSON.stringify({ browser: name, loadMs, ...r, seekOk, bench, external, consoleErrors }, null, 1));
await browser.close();
