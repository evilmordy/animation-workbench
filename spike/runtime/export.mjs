// T0.3：把 runtime.js 和启动脚本内联成单个 HTML，并用 file:// 在各浏览器打开验证。
// 用法：node export.mjs [chromium|webkit|firefox ...]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, webkit, firefox } from '@playwright/test';

const runtime = readFileSync('dist-runtime/runtime.js', 'utf8');
const boot = readFileSync('harness/harness.js', 'utf8');
// 内联脚本里不能出现 </script，否则会提前闭合
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
const sha = (js) => `'sha256-${createHash('sha256').update(js).digest('base64')}'`;
const [r, b] = [safe(runtime), safe(boot)];
const csp = `default-src 'none'; script-src ${sha(r)} ${sha(b)} 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>export</title></head>
<body style="margin:0;background:#000"><div id="stage" style="width:800px;height:450px"></div>
<script>${r}</script>
<script>${b}</script>
</body></html>`;
const out = resolve('export.html');
writeFileSync(out, html);
console.log(`export.html ${(html.length / 1e6).toFixed(1)} MB`);

for (const name of process.argv.slice(2)) {
  const browser = await { chromium, webkit, firefox }[name].launch(name === 'chromium' ? { channel: 'chromium' } : {});
  const page = await browser.newPage();
  const external = [];
  const errors = [];
  page.on('request', (q) => !q.url().startsWith('file:') && !q.url().startsWith('data:') && external.push(q.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`file://${out}`);
  const res = await page.evaluate(() => window.__result);
  if (!res.fatal) await page.evaluate((d) => window.__player.seek(d - 0.01), res.duration);
  await page.screenshot({ path: `export-${name}.png` });
  console.log(JSON.stringify({ browser: name, fatal: res.fatal, slides: res.slides, logs: res.logs, external, errors }));
  await browser.close();
}
