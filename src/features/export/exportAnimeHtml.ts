import type { Storyboard } from '../../shared/schema';
import { assembleExportHtml, type ExportOptions } from './exportHtml';

/**
 * 单文件导出。分镜（含 kind:'dsl'）由运行时转译后播放。
 * 复用 assembleExportHtml 的 CSP：脚本内联后按哈希放行，不改指令。
 */
export async function buildAnimeExportHtml(sb: Storyboard, opts: ExportOptions): Promise<string> {
  const runtime = (await import('../../../dist-runtime/anime-runtime.js?raw')).default as string;
  return assembleExportHtml(runtime, sb, opts);
}
