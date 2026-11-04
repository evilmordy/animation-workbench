#!/usr/bin/env node
// SEC-08：生产依赖里不允许 GPL / AGPL / LGPL。
// GSAP 的 Standard No Charge（2025）禁止的是无代码可视化搭建，并且和 Webflow 的动画编辑器竞争。
// 这里只把 GSAP 核心当作代码场的播放器：Agent 写 JavaScript，运行时按时间 seek。
// 官方 FAQ 写明 AI 生成 GSAP 代码不属于禁止用途。别的包仍不能挂这个许可证。
import { execSync } from 'node:child_process';

const data = JSON.parse(execSync('pnpm licenses list --prod --json', { encoding: 'utf8' }));
const bannedLicense = /\b(A?GPL|LGPL)\b|GreenSock|Standard 'no charge'/i;

const problems = [];
for (const [lic, pkgs] of Object.entries(data)) {
  if (!bannedLicense.test(lic)) continue;
  const names = pkgs.map((pkg) => pkg.name);
  const onlyGsap =
    /Standard 'no charge'/i.test(lic) && names.length > 0 && names.every((name) => name === 'gsap');
  if (onlyGsap) continue;
  problems.push(`${lic}: ${names.join(', ')}`);
}
if (problems.length) {
  for (const line of problems) console.error(line);
  process.exit(1);
}
console.log(`许可证检查通过：${Object.keys(data).join('、')}`);
