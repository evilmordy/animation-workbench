/**
 * KaTeX 在模块加载时检查 document.compatMode，不是标准模式就把 render 换成抛错。
 * happy-dom 没有 doctype，这里在导入 katex 之前补上。真页面有 doctype，进不了这个分支。
 */
if (typeof document !== 'undefined' && document.compatMode !== 'CSS1Compat') {
  try {
    Object.defineProperty(document, 'compatMode', {
      configurable: true,
      get: () => 'CSS1Compat',
    });
  } catch {
    // 真浏览器上 compatMode 不可写。
  }
}
