#!/usr/bin/env node
// SEC-08：生产依赖里不允许 GPL / AGPL / LGPL（以及 GSAP 的专有许可证）
import { execSync } from 'node:child_process';

const data = JSON.parse(execSync('pnpm licenses list --prod --json', { encoding: 'utf8' }));
const banned = Object.entries(data).filter(([lic]) =>
  /\b(A?GPL|LGPL)\b|GreenSock|Standard 'no charge'/i.test(lic),
);
const gsap = Object.values(data)
  .flat()
  .filter((p) => p.name === 'gsap');
if (banned.length || gsap.length) {
  for (const [lic, pkgs] of banned) console.error(`${lic}: ${pkgs.map((p) => p.name).join(', ')}`);
  if (gsap.length) console.error('依赖里出现了 gsap（许可证禁止用于动画构建工具）');
  process.exit(1);
}
console.log(`许可证检查通过：${Object.keys(data).join('、')}`);
