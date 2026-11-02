import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import cmaps from 'virtual:pdf-cmaps';
import { fixCjkRadicals } from './cjk';

GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * CMap（中文等 CID 字体提取文字需要）在构建时读成 base64 打进包里：
 * 主窗口 CSP 的 connect-src 不允许运行时再去 fetch。
 */
class BundledDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const data = kind === 'cMapUrl' ? cmaps[filename] : undefined;
    if (!data) throw new Error(`PDF 需要的数据不可用：${kind} ${filename}`);
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
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
