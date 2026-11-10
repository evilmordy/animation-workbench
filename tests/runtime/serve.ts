import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/** 与 src-tauri 的 awpreview 一致的预览 CSP，只把协议源换成测试用的 http 源 */
export const PREVIEW_CSP =
  "default-src 'none'; script-src http://awpreview.test 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";

const FILES: Record<string, [string, string]> = {
  'http://awpreview.test/index.html': ['dist-runtime/index.html', 'text/html'],
  'http://awpreview.test/runtime.js': ['dist-runtime/runtime.js', 'text/javascript'],
  'http://awpreview.test/code-harness.html': ['tests/runtime/code-harness.html', 'text/html'],
  'http://awpreview.test/code-harness.js': ['tests/runtime/code-harness.js', 'text/javascript'],
  'http://awpreview.test/anime.html': ['dist-runtime/anime.html', 'text/html'],
  'http://awpreview.test/anime-runtime.js': ['dist-runtime/anime-runtime.js', 'text/javascript'],
  'http://host.test/harness.html': ['tests/runtime/harness.html', 'text/html'],
  'http://host.test/harness.js': ['tests/runtime/harness.js', 'text/javascript'],
};

/** 只提供白名单文件，其他请求一律中止并记录（用来发现 CDN 回退等外联） */
export async function serveRuntime(page: Page): Promise<string[]> {
  const external: string[] = [];
  await page.route('**/*', (route) => {
    const url = route.request().url().split('?')[0]!;
    const f = FILES[url];
    if (!f) {
      external.push(url);
      return route.abort();
    }
    const headers: Record<string, string> = url.startsWith('http://awpreview.test')
      ? { 'Content-Security-Policy': PREVIEW_CSP }
      : {};
    return route.fulfill({ body: readFileSync(f[0]), contentType: f[1], headers });
  });
  return external;
}
