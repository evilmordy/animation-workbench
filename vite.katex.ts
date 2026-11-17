import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * KaTeX 的 woff2 打成 base64 塞进模块。
 * rolldown 不能 ?inline 二进制（和 pdfjs 的 CMap 一样），导出页的 font-src 又只放行 data:。
 */
export function katexInline(): Plugin {
  const id = '\0virtual:katex-fonts';
  return {
    name: 'katex-fonts',
    resolveId: (source) => (source === 'virtual:katex-fonts' ? id : undefined),
    load(resolved) {
      if (resolved !== id) return;
      const dir = 'node_modules/katex/dist/fonts';
      const fonts = readdirSync(dir)
        .filter((name) => name.endsWith('.woff2'))
        .map((name) => {
          const b64 = readFileSync(join(dir, name)).toString('base64');
          return `${JSON.stringify(name)}:${JSON.stringify(b64)}`;
        });
      const css = readFileSync('node_modules/katex/dist/katex.min.css', 'utf8');
      return `export const fonts = {${fonts.join(',')}};\nexport const css = ${JSON.stringify(css)};`;
    },
  };
}
