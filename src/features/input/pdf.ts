import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fixCjkRadicals } from './cjk';

GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * CMap（中文等 CID 字体提取文字需要）打包进前端，按需以 base64 加载：
 * 主窗口 CSP 的 connect-src 不允许 fetch 应用自身资源，所以不能用 pdfjs 默认的 cMapUrl 加载方式。
 */
const cmaps = import.meta.glob<string>('/node_modules/pdfjs-dist/cmaps/*.bcmap', {
  query: '?inline',
  import: 'default',
});

class BundledDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const load = kind === 'cMapUrl' ? cmaps[`/node_modules/pdfjs-dist/cmaps/${filename}`] : undefined;
    if (!load) throw new Error(`PDF 需要的数据不可用：${kind} ${filename}`);
    const dataUrl = await load();
    return Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  }
}

export interface PdfInfo {
  pages: number;
  read(from: number, to: number): Promise<{ text: string; hasTextLayer: boolean }>;
  destroy(): Promise<void>;
}

export async function openPdf(data: Uint8Array): Promise<PdfInfo> {
  const task = getDocument({
    data,
    cMapUrl: 'bundled/',
    cMapPacked: true,
    BinaryDataFactory: BundledDataFactory,
    useWorkerFetch: false,
    useWasm: false,
    disableFontFace: true,
  });
  const doc = await task.promise;
  return {
    pages: doc.numPages,
    async read(from, to) {
      const parts: string[] = [];
      for (let p = Math.max(1, from); p <= Math.min(to, doc.numPages); p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        let line = '';
        for (const item of content.items) {
          if (!('str' in item)) continue;
          line += item.str;
          if (item.hasEOL) line += '\n';
        }
        parts.push(line.trim());
      }
      const text = fixCjkRadicals(parts.filter(Boolean).join('\n\n'));
      // 平均每页少于 20 个字，基本可以判定是扫描件
      return { text, hasTextLayer: text.replace(/\s/g, '').length >= 20 * Math.max(1, parts.length) * 0.25 };
    },
    destroy: () => task.destroy(),
  };
}
