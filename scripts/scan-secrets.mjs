#!/usr/bin/env node
// SEC-03：在项目目录、导出文件和日志里搜索当前 API Key（原文、base64、末尾 12 位），发现即失败。
// 用法：AWB_SCAN_KEY=sk-... node scripts/scan-secrets.mjs <目录或文件>...
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const key = process.env.AWB_SCAN_KEY ?? '';
const roots = process.argv.slice(2);
if (key.length < 8 || !roots.length) {
  console.error('用法：AWB_SCAN_KEY=<key> node scripts/scan-secrets.mjs <目录或文件>...');
  process.exit(2);
}
const needles = [key, Buffer.from(key).toString('base64'), key.slice(-12)];
const SKIP = new Set(['node_modules', 'target', '.git']);
const hits = [];
let scanned = 0;

function walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) if (!SKIP.has(name)) walk(join(p, name));
    return;
  }
  scanned++;
  const text = readFileSync(p).toString('latin1');
  for (const n of needles)
    if (text.includes(Buffer.from(n).toString('latin1')))
      hits.push(`${p}（匹配 ${n === key ? '原文' : n === needles[1] ? 'base64' : '末 12 位'}）`);
}

for (const r of roots) walk(r);
if (hits.length) {
  console.error(`发现 Key 泄露（${hits.length} 处）：\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(`扫描 ${scanned} 个文件，未发现 Key。`);
