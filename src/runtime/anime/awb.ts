import type { Timeline } from 'animejs';

/**
 * 代码场 helper。`player.ts` 编译每一场时把这段源码注入函数体，再把 `scene.code` 包进块作用域。
 *
 * 设计书 §4.2：合并 S8d 的 helpers 与 seek-guard，并补 `bind`。`three3d`（PR-10）和 `tex`（PR-9b）不在这里。
 * 仓库里没有 `prompts/helpers.js`、`helpers-safe.js`、`seek-guard.js`、`helpers.md`（复盘：S8d 原型没进仓库）。
 * 配色与产品里的 3b1b 预设对齐，并补上 §4.2 点名的其余颜色名。
 */
export const AWB_BINDS = '__awbBinds';

const HELPER_BODY = String.raw`
const W = ctx.width;
const H = ctx.height;
const C = {
  blue: '#58C4DD',
  green: '#83C167',
  orange: '#FF862F',
  red: '#FC6255',
  yellow: '#FFFF00',
  purple: '#9A72AC',
  teal: '#5CD0B3',
  text: '#FFFFFF',
  soft: '#BBBBBB',
  dim: '#888888',
  bg: '#000000',
};
const NS = 'http://www.w3.org/2000/svg';
const MONO = 'ui-monospace, "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace';

const UNITLESS = {
  opacity: 1,
  zIndex: 1,
  fontWeight: 1,
  flex: 1,
  flexGrow: 1,
  flexShrink: 1,
  lineHeight: 1,
  order: 1,
  zoom: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
};

const SKIP = {
  id: 1,
  keyframes: 1,
  playbackEase: 1,
  playbackRate: 1,
  frameRate: 1,
  loop: 1,
  reversed: 1,
  alternate: 1,
  persist: 1,
  autoplay: 1,
  duration: 1,
  delay: 1,
  loopDelay: 1,
  ease: 1,
  composition: 1,
  modifier: 1,
  onBegin: 1,
  onBeforeUpdate: 1,
  onUpdate: 1,
  onLoop: 1,
  onPause: 1,
  onComplete: 1,
  onRender: 1,
  priority: 1,
};

const _seen = new WeakMap();
const _binds = [];
let _lastStart = 0;
let _line = null;
root.__awbBinds = _binds;

function owns(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function copyInto(dst, src) {
  if (!src) return dst;
  for (const key in src) if (owns(src, key)) dst[key] = src[key];
  return dst;
}

function setHtml(node, html) {
  node.replaceChildren();
  if (html == null || html === '') return;
  const range = document.createRange();
  range.selectNodeContents(node);
  node.appendChild(range.createContextualFragment(String(html)));
}

function css(e, style) {
  if (!e || !style) return e;
  for (const key in style) {
    if (!owns(style, key) || style[key] == null) continue;
    const value = style[key];
    e.style[key] = typeof value === 'number' && !UNITLESS[key] ? value + 'px' : String(value);
  }
  return e;
}

function el(tag, style, html, parent) {
  const node = document.createElement(tag || 'div');
  node.style.position = 'absolute';
  css(node, style);
  if (html != null && html !== '') setHtml(node, html);
  (parent || root).appendChild(node);
  return node;
}

function txt(html, x, y, size, color, extra) {
  return el('div', copyInto({
    left: x,
    top: y,
    fontSize: size,
    color: color || C.text,
    whiteSpace: 'nowrap',
    lineHeight: 1.2,
  }, extra), html);
}

function ctext(html, y, size, color, extra) {
  return el('div', copyInto({
    left: 48,
    top: y,
    width: W - 96,
    textAlign: 'center',
    fontSize: size,
    color: color || C.text,
    whiteSpace: 'nowrap',
    lineHeight: 1.2,
  }, extra), html);
}

function svgRoot(parent) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('data-awb-role', 'canvas');
  css(svg, { position: 'absolute', left: 0, top: 0, width: W, height: H });
  (parent || root).appendChild(svg);
  return svg;
}

function sv(parent, tag, attrs) {
  const node = document.createElementNS(NS, tag);
  if (attrs) {
    for (const key in attrs) if (owns(attrs, key) && attrs[key] != null) node.setAttribute(key, String(attrs[key]));
  }
  if (parent) parent.appendChild(node);
  return node;
}

function fit(e, maxW, minSize) {
  if (!e || !e.style) return e;
  const limit = maxW == null ? (parseFloat(e.style.width) || W - 96) : maxW;
  const floor = minSize == null ? 18 : minSize;
  let size = parseFloat(e.style.fontSize) || 32;
  let steps = 0;
  while (size > floor && e.scrollWidth > limit + 0.5 && steps < 240) {
    size -= 1;
    e.style.fontSize = size + 'px';
    steps += 1;
  }
  return e;
}

function eachNode(target, fn) {
  const list = target == null ? [] : (typeof target.length === 'number' && !target.nodeType ? Array.from(target) : [target]);
  for (const node of list) fn(node);
}

function hid(target) {
  eachNode(target, (node) => {
    if (node && node.style) node.style.opacity = '0';
  });
}

function listTargets(targets) {
  if (targets == null) return [];
  if (typeof targets === 'string') return Array.from(root.querySelectorAll(targets));
  if (typeof NodeList !== 'undefined' && targets instanceof NodeList) return Array.from(targets);
  if (typeof HTMLCollection !== 'undefined' && targets instanceof HTMLCollection) return Array.from(targets);
  if (Array.isArray(targets)) {
    const out = [];
    for (const item of targets) for (const node of listTargets(item)) out.push(node);
    return out;
  }
  if (typeof targets === 'object') return [targets];
  return [];
}

function isFromTo(value) {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const head = value[0];
  return head != null && typeof head !== 'object';
}

function guardParams(targets, params) {
  const next = {};
  const initials = new Map();
  for (const key in params) {
    if (!owns(params, key)) continue;
    const value = params[key];
    if (SKIP[key] || !isFromTo(value)) {
      next[key] = value;
      continue;
    }
    const from = value[0];
    const to = value[1];
    for (const target of listTargets(targets)) {
      if (!target || typeof target !== 'object') continue;
      let seen = _seen.get(target);
      if (!seen) {
        seen = new Map();
        _seen.set(target, seen);
      }
      if (seen.has(key)) continue;
      seen.set(key, true);
      let bag = initials.get(target);
      if (!bag) {
        bag = {};
        initials.set(target, bag);
      }
      bag[key] = from;
    }
    next[key] = to;
  }
  for (const [target, bag] of initials) anime.utils.set(target, bag);
  return next;
}

const _add = tl.add.bind(tl);
tl.add = function (a1, a2, a3) {
  if (a2 && typeof a2 === 'object' && !Array.isArray(a2)) return _add(a1, guardParams(a1, a2), a3);
  return _add(a1, a2, a3);
};

function endMs() {
  const duration = Number(tl.duration) || 0;
  return duration < 1e-6 ? 0 : duration;
}

function abs(at) {
  if (typeof at === 'number' && Number.isFinite(at)) return at;
  if (at == null || at === '') return endMs();
  const text = String(at).replace(/\s+/g, '');
  if (text === '<<') return _lastStart;
  let matched = /^<<\+=(\d+(?:\.\d+)?)$/.exec(text);
  if (matched) return _lastStart + Number(matched[1]);
  matched = /^<<-=(\d+(?:\.\d+)?)$/.exec(text);
  if (matched) return _lastStart - Number(matched[1]);
  matched = /^\+=(\d+(?:\.\d+)?)$/.exec(text);
  if (matched) return endMs() + Number(matched[1]);
  matched = /^-=(\d+(?:\.\d+)?)$/.exec(text);
  if (matched) return endMs() - Number(matched[1]);
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : endMs();
}

function tw(targets, params, at) {
  const ms = abs(at);
  _lastStart = ms;
  tl.add(targets, params || {}, ms);
  return targets;
}

function fadeIn(target, at, opts) {
  hid(target);
  tw(target, copyInto({ opacity: [0, 1], duration: 500 }, opts), at);
}

function rise(target, at, opts) {
  fadeIn(target, at, copyInto({ y: [24, 0] }, opts));
}

function fadeOut(target, at, opts) {
  tw(target, copyInto({ opacity: 0, duration: 400 }, opts), at);
}

function wait(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return;
  tl.add({ duration: n });
}

function say(html, at, color) {
  const prev = _line;
  const node = txt(html, 48, 952, 32, color || C.text, { width: W - 96, textAlign: 'center' });
  fit(node, W - 96, 18);
  if (prev) fadeOut(prev, at);
  fadeIn(node, prev ? '<<' : at);
  _line = node;
  return node;
}

function head(html, at) {
  const node = txt(html, 48, 52, 44, C.text, { width: W - 96, textAlign: 'center', fontWeight: 700 });
  fit(node, W - 96, 18);
  fadeIn(node, at);
  return node;
}

function bind(state, draw) {
  if (!state || typeof draw !== 'function') return;
  _binds.push(() => draw(state));
}
`;

export const AWB_HELPER_SOURCE = HELPER_BODY.replaceAll('__awbBinds', AWB_BINDS);

/** 把 helper 放在块作用域外面。场景里再写 `const W` 只会遮蔽，不会和注入的常量冲突。 */
export function wrapSceneCode(code: string): string {
  return `${AWB_HELPER_SOURCE}\n{\n${code}\n}\n`;
}

type AnimeLike = {
  utils: { set: (targets: unknown, params: Record<string, unknown>) => unknown };
};

/** 场景函数签名不变。helper 是注入进函数体的名字，不是模块导出。 */
export interface AwbSceneArgs {
  root: HTMLElement;
  anime: AnimeLike;
  tl: Timeline;
  ctx: { width: number; height: number };
}

export interface AwbPalette {
  blue: string;
  green: string;
  orange: string;
  red: string;
  yellow: string;
  purple: string;
  teal: string;
  text: string;
  soft: string;
  dim: string;
  bg: string;
}

export interface AwbFadeOpts {
  duration?: number;
  delay?: number | ((target: unknown, index: number, targets: unknown[]) => number);
  ease?: string;
  x?: number | [number, number];
  y?: number | [number, number];
  scale?: number | [number, number];
  scaleX?: number | [number, number];
  scaleY?: number | [number, number];
  [key: string]: unknown;
}

/**
 * `AWB_HELPER_SOURCE` 在每个代码场里定义的名字。速查表从这里生成，不另写一份。
 * `at`：数字是本场绝对毫秒；`+=n` 是时间线末尾之后 n 毫秒；`<<` 与上一个 helper 动画同时开始；`<<+=n` 再晚 n 毫秒。
 */
export interface AwbSceneScope {
  /** 舞台宽。来自 ctx.width，当前播放器传入 1920。 */
  readonly W: number;
  /** 舞台高。来自 ctx.height，当前播放器传入 1080。 */
  readonly H: number;
  /** 配色。蓝绿红字灰底与产品 3b1b 预设相同，其余名字用同一套色值。 */
  readonly C: AwbPalette;
  /** SVG 命名空间 */
  readonly NS: string;
  /** 等宽字体栈 */
  readonly MONO: string;
  /** 建绝对定位元素。数字样式补 px，默认挂到 root。 */
  el(
    tag: string,
    style?: Record<string, unknown> | null,
    html?: string | null,
    parent?: ParentNode | null,
  ): HTMLElement;
  /** 单行文字，nowrap。 */
  txt(
    html: string,
    x: number,
    y: number,
    size: number,
    color?: string,
    extra?: Record<string, unknown> | null,
  ): HTMLElement;
  /** 整行居中，左右各留 48px。 */
  ctext(
    html: string,
    y: number,
    size: number,
    color?: string,
    extra?: Record<string, unknown> | null,
  ): HTMLElement;
  /** 满屏 SVG，viewBox 为 0 0 W H，打 data-awb-role="canvas"。 */
  svgRoot(parent?: ParentNode | null): SVGSVGElement;
  /** 建 SVG 子元素。 */
  sv(parent: SVGElement, tag: string, attrs?: Record<string, unknown> | null): SVGElement;
  /** 批量设样式。 */
  css(e: HTMLElement | SVGElement, style?: Record<string, unknown> | null): HTMLElement | SVGElement;
  /** 建场时量一次，放不下就缩字号。seek 仍确定。 */
  fit(e: HTMLElement, maxW?: number, minSize?: number): HTMLElement;
  /** 先藏起来（opacity 0）。 */
  hid(target: unknown): void;
  /** 把 at 换成绝对毫秒。 */
  abs(at?: number | string | null): number;
  /**
   * 代替直接写多段 [起点, 终点]。同一目标同一属性第一次把起点写进初始状态，之后只用终点。
   */
  tw(targets: unknown, params?: Record<string, unknown> | null, at?: number | string | null): unknown;
  /** 先 hid，再 opacity 0→1，默认 500ms。 */
  fadeIn(target: unknown, at?: number | string | null, opts?: AwbFadeOpts | null): void;
  /** fadeIn，再加 y: [24, 0]。 */
  rise(target: unknown, at?: number | string | null, opts?: AwbFadeOpts | null): void;
  /** opacity → 0，默认 400ms。 */
  fadeOut(target: unknown, at?: number | string | null, opts?: AwbFadeOpts | null): void;
  /** 场内停顿，把时间线末尾往后推。 */
  wait(ms: number): void;
  /** 底部字幕，y≈952。新一句淡入时旧一句淡出。 */
  say(html: string, at?: number | string | null, color?: string): HTMLElement;
  /** 顶部标题，y≈52。 */
  head(html: string, at?: number | string | null): HTMLElement;
  /**
   * state 用 tw 补间。draw 在每次 seek / 每帧之后由播放器对可见场调用，必须是 state 的纯函数。
   */
  bind<T extends object>(state: T, draw: (state: T) => void): void;
}
