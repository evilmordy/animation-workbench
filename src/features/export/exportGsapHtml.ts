import type { Storyboard } from '../../shared/schema';
import { assembleExportHtml, type ExportOptions } from './exportHtml';

/**
 * GSAP 代码场的单文件导出。复用同一套 CSP：脚本内联后按哈希放行，不改指令。
 * 纯 dsl 仍走 buildExportHtml，不经过这里。
 */
export async function buildGsapExportHtml(sb: Storyboard, opts: ExportOptions): Promise<string> {
  const runtime = (await import('../../../dist-runtime/gsap-runtime.js?raw')).default as string;
  return assembleExportHtml(runtime, sb, { ...opts, codeScenes: true });
}
