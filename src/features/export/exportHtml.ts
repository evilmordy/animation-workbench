import type { Storyboard } from '../../shared/schema';

export interface ExportOptions {
  /** 在场景边界暂停，用方向键翻页 */
  slides: boolean;
  loop: boolean;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * 把运行时脚本体嵌进单文件 HTML。
 * 模板与 S2a 逐字节一致（同一份 runtime 字符串）。CSP 指令不增不改。
 */
export async function assembleExportHtml(
  runtimeSource: string,
  sb: Storyboard,
  opts: ExportOptions,
): Promise<string> {
  const runtime = runtimeSource.replace(/<\/script/gi, '<\\/script');
  const data = JSON.stringify(sb).replace(/</g, '\\u003c');
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${await sha256(runtime)}' 'unsafe-eval'`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    'worker-src blob:',
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const bg = sb.meta.background.startsWith('#') ? sb.meta.background : '#000000';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="generator" content="Animation Workbench">
<title>${escapeHtml(sb.meta.title || '动画')}</title>
<style>html,body{margin:0;height:100%;background:${bg}}body{display:grid;place-items:center}</style>
</head>
<body>
<div id="stage"></div>
<script type="application/json" id="awb-storyboard" data-slides="${opts.slides}" data-loop="${opts.loop}">${data}</script>
<script type="module">${runtime}</script>
</body>
</html>
`;
}
