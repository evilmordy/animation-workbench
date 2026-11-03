import type { Storyboard } from '../../shared/schema';

export interface ExportOptions {
  /** 在场景边界暂停，用方向键翻页 */
  slides: boolean;
  loop: boolean;
  /**
   * 宿主的 runtime.codeScenes。只有为 true 且分镜里真有 kind:code 时，
   * 导出页才会执行 scene.code。纯 dsl 项目忽略此字段，输出与不传时逐字节一致。
   */
  codeScenes?: boolean;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 含 code 场景且宿主开关打开时，导出页才被允许执行 scene.code。 */
export function exportRunsCode(sb: Storyboard, opts: ExportOptions): boolean {
  return opts.codeScenes === true && sb.scenes.some((s) => s.kind === 'code');
}

/**
 * 把运行时脚本体嵌进单文件 HTML。
 * 不执行 code 时，模板与 S2a 逐字节一致（同一份 runtime 字符串）。
 * 执行 code 时只多一个 data-code-scenes="1"：CSP 指令不增不改，
 * new AsyncFunction 复用原本就有的 'unsafe-eval'。
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
  const codeAttr = exportRunsCode(sb, opts) ? ' data-code-scenes="1"' : '';
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
<script type="application/json" id="awb-storyboard" data-slides="${opts.slides}" data-loop="${opts.loop}"${codeAttr}>${data}</script>
<script type="module">${runtime}</script>
</body>
</html>
`;
}

/**
 * 生成单文件 HTML（PLAN T4.2）：内联运行时和分镜，离线可用。
 * meta CSP 只放行这一段内联脚本（按哈希），并禁止一切网络请求。
 */
export async function buildExportHtml(sb: Storyboard, opts: ExportOptions): Promise<string> {
  // 运行时有十几 MB，只在导出时才加载
  const runtime = (await import('../../../dist-runtime/runtime.js?raw')).default as string;
  return assembleExportHtml(runtime, sb, opts);
}
