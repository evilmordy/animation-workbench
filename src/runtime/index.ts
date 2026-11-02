import { setKatexStylesheetUrl, setMathJaxScriptUrl } from 'manim-web';

// 禁用 manim-web 内置的 CDN 回退：离线失败要暴露成错误，而不是悄悄联网
setKatexStylesheetUrl(null);
setMathJaxScriptUrl(null);

export const RUNTIME_VERSION = '0.1.0';
export const MANIM_WEB_VERSION = __MANIM_WEB_VERSION__;
