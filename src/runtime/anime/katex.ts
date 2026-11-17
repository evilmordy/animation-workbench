import './katex-env';
import katex from 'katex';
import { css, fonts } from 'virtual:katex-fonts';

function fontUri(file: string): string {
  const raw = fonts[file];
  if (!raw) throw new Error(`缺少 KaTeX 字体 ${file}`);
  return `data:font/woff2;base64,${raw}`;
}

/** 只留 woff2。woff / ttf 的相对地址在导出会去请求，CSP 会拦。 */
const inlined = css.replace(
  /url\(fonts\/([^)]+\.woff2)\) format\("woff2"\),url\(fonts\/[^)]+\) format\("woff"\),url\(fonts\/[^)]+\) format\("truetype"\)/g,
  (_match: string, file: string) => `url("${fontUri(file)}") format("woff2")`,
);

/**
 * 数学斜体在 48px 上下会把笔画收口收成 1px，右上角露出断开的白点或竖线。
 * 八个方向各补 1px 同色阴影，把收口补上。strut / pstrut / vlist-s 是排版支架，不该有墨。
 */
const TEX_INK =
  '.katex{text-shadow:1px 0 currentColor,-1px 0 currentColor,0 1px currentColor,0 -1px currentColor,' +
  '1px 1px currentColor,-1px -1px currentColor,1px -1px currentColor,-1px 1px currentColor}' +
  '.katex .katex-strut,.katex .pstrut,.katex .vlist-s{color:transparent}';

export const KATEX_CSS = inlined + TEX_INK;

const STYLE_ID = 'awb-katex-css';

/** happy-dom 没有 doctype，compatMode 是空的，KaTeX 会直接抛。页面本身有 doctype。 */
function standardsMode(doc: Document): void {
  if (doc.compatMode === 'CSS1Compat') return;
  try {
    Object.defineProperty(doc, 'compatMode', { configurable: true, get: () => 'CSS1Compat' });
  } catch {
    // 真浏览器上 compatMode 不可写。有 doctype 时已经是标准模式。
  }
}

export function ensureKatexCss(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = KATEX_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}

const KATEX_FAMILIES = [
  'KaTeX_AMS',
  'KaTeX_Caligraphic',
  'KaTeX_Fraktur',
  'KaTeX_Main',
  'KaTeX_Math',
  'KaTeX_SansSerif',
  'KaTeX_Script',
  'KaTeX_Size1',
  'KaTeX_Size2',
  'KaTeX_Size3',
  'KaTeX_Size4',
  'KaTeX_Typewriter',
];

/**
 * 公式的宽高在建场时量。字体没进页面时量到的是回退字体，加载后再量会偏一截，
 * 整片和单场对不齐。@font-face 写进文档后主动 load，再等 fonts.ready。
 */
export async function loadKatexFonts(doc: Document): Promise<void> {
  ensureKatexCss(doc);
  const fonts = doc.fonts;
  if (!fonts?.load) return;
  const specs = ['16px', 'italic 16px', '700 16px', 'italic 700 16px'];
  await Promise.all(
    KATEX_FAMILIES.flatMap((family) =>
      specs.map((spec) => fonts.load(`${spec} "${family}"`).catch(() => [])),
    ),
  );
  await fonts.ready?.catch(() => undefined);
}

/** 同步渲染。公式写进 node，字号和颜色由调用方设在 node 上。 */
export function renderTex(node: HTMLElement, latex: string): void {
  ensureKatexCss(node.ownerDocument);
  standardsMode(node.ownerDocument);
  try {
    katex.render(latex, node, {
      throwOnError: false,
      displayMode: false,
      output: 'html',
      strict: 'ignore',
    });
  } catch {
    node.textContent = latex;
  }
}
