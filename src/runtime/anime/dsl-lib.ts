import { utils, type Timeline } from 'animejs';
import { isSafeExpr } from '../../shared/validate';
import { AWB_BINDS } from './awb';
import type { DslAnimSpec, DslNodeSpec, DslPlace, RateName } from './dsl';
import { renderTex } from './katex';

/**
 * 转译产物调用的形状和动画。不进 agent 速查表。
 * 动画都走场景里的 tl.add：helper 会把 [起点, 终点] 的起点写进初始状态，seek 才回得去。
 * 坐标是 manim 帧：高 8 单位，原点在舞台中心，y 向上。
 */

const FONT = '"Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
const NS = 'http://www.w3.org/2000/svg';

const DIR: Record<string, [number, number]> = {
  UP: [0, 1],
  DOWN: [0, -1],
  LEFT: [-1, 0],
  RIGHT: [1, 0],
  UL: [-1, 1],
  UR: [1, 1],
  DL: [-1, -1],
  DR: [1, -1],
};

function direction(name: string | undefined, fallback: 'RIGHT' | 'DOWN'): [number, number] {
  const hit = (name ? DIR[name] : undefined) ?? DIR[fallback];
  if (hit) return [hit[0], hit[1]];
  return fallback === 'DOWN' ? [0, -1] : [1, 0];
}

type Ease = (t: number) => number;

function smooth(t: number): number {
  const inflection = 10;
  const sig = (x: number) => 1 / (1 + Math.exp(-x));
  const error = sig(-inflection / 2);
  const raw = (sig(inflection * (t - 0.5)) - error) / (1 - 2 * error);
  return Math.min(1, Math.max(0, raw));
}

/** 与 manim 的五个 rate 同名。anime.js 4 直接吃函数，见 dsl-lib.test.ts。 */
export const RATE_EASE: Record<RateName, Ease> = {
  linear: (t) => t,
  smooth,
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  rushInto: (t) => 2 * smooth(t / 2),
  thereAndBack: (t) => smooth(t < 0.5 ? t * 2 : (1 - t) * 2),
};

function easeOf(name: string | undefined): Ease {
  return RATE_EASE[name as RateName] ?? RATE_EASE.smooth;
}

interface Stroke {
  el: SVGElement;
  len: number;
}

interface AxesGeom {
  cx: number;
  cy: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xLen: number;
  yLen: number;
}

interface Handle {
  id: string;
  outer: HTMLElement;
  inner: HTMLElement;
  cx: number;
  cy: number;
  w: number;
  h: number;
  color: string;
  fill?: string;
  fillOpacity: number;
  rotate: number;
  scale: number;
  tx: number;
  ty: number;
  carried: boolean;
  strokes: Stroke[];
  axes?: AxesGeom;
}

export interface DslApi {
  pad(ms: number): void;
  node(spec: DslNodeSpec): void;
  fadeCarried(ms: number): void;
  anim(spec: DslAnimSpec): void;
}

export interface DslEnv {
  root: HTMLElement;
  tl: Timeline;
  width: number;
  height: number;
}

function num(props: Record<string, unknown>, key: string, fallback: number): number {
  const value = props[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function pair(value: unknown, fallback: [number, number] = [0, 0]): [number, number] {
  if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') {
    return [value[0], value[1]];
  }
  return fallback;
}

/**
 * manim 逆时针为正，CSS rotate 顺时针为正。舞台已经把 y 翻成向下，
 * 同一个度数画出来是反的，只在写进 CSS 时取反。元素上记下的角度仍是 manim 的。
 */
function cssRotate(deg: number): number {
  return -deg;
}

function visualSize(w: number, h: number, rotate: number): { w: number; h: number } {
  if (!rotate) return { w, h };
  const rad = (Math.abs(rotate) * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return { w: w * c + h * s, h: w * s + h * c };
}

function estimateWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) width += (ch.codePointAt(0) ?? 0) > 255 ? fontSize : fontSize * 0.55;
  return Math.max(fontSize * 0.4, width);
}

/** 上标的字形盒会高出 `.katex` 的 offset 盒。pstrut 是零宽支架，不能算进去。 */
function fitTex(
  inner: HTMLElement,
  latex: string,
  fontSize: number,
): { w: number; h: number; dx: number; dy: number } {
  const host = inner.getBoundingClientRect();
  const fallback = () => {
    const w = inner.offsetWidth || estimateWidth(latex, fontSize);
    const h = inner.offsetHeight || fontSize * 1.2;
    return { w: Math.max(1, w), h: Math.max(1, h), dx: 0, dy: 0 };
  };
  if (host.width < 1 || host.height < 1) return fallback();
  let left = host.left;
  let top = host.top;
  let right = host.right;
  let bottom = host.bottom;
  for (const node of inner.querySelectorAll('.katex-html span')) {
    if (!(node instanceof HTMLElement)) continue;
    if (
      node.classList.contains('pstrut') ||
      node.classList.contains('katex-strut') ||
      node.classList.contains('vlist-s')
    ) {
      continue;
    }
    const rect = node.getBoundingClientRect();
    if (rect.width < 0.5 || rect.height < 0.5) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return {
    w: Math.max(1, right - left),
    h: Math.max(1, bottom - top),
    dx: host.left - left,
    dy: host.top - top,
  };
}

export function createDsl(env: DslEnv): DslApi {
  const { root, tl, width, height } = env;
  const unit = height / 8;
  const px = (x: number) => width / 2 + x * unit;
  const py = (y: number) => height / 2 - y * unit;
  const handles = new Map<string, Handle>();
  let zTop = 1;

  const svg = (tag: string, attrs: Record<string, string | number>) => {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    return el;
  };

  const mount = (h: Handle) => {
    const w = h.w * unit;
    const ht = h.h * unit;
    h.outer.style.left = `${px(h.cx) - w / 2}px`;
    h.outer.style.top = `${py(h.cy) - ht / 2}px`;
    h.outer.style.width = `${w}px`;
    h.outer.style.height = `${ht}px`;
  };

  const resolveCenter = (
    natural: { cx: number; cy: number; w: number; h: number },
    place: DslPlace | undefined,
    offset: [number, number] | undefined,
  ) => {
    let cx = natural.cx;
    let cy = natural.cy;
    if (place?.at) {
      cx = place.at[0];
      cy = place.at[1];
    }
    if (place?.nextTo) {
      const other = handles.get(place.nextTo.id);
      if (!other) throw new Error(`引用的元素 "${place.nextTo.id}" 不存在`);
      const dir = direction(place.nextTo.dir, 'RIGHT');
      const buff = place.nextTo.buff ?? 0.25;
      const len = Math.hypot(dir[0], dir[1]) || 1;
      const sx = Math.sign(dir[0]);
      const sy = Math.sign(dir[1]);
      const size = visualSize(other.w, other.h, other.rotate);
      cx = other.cx + (sx * size.w) / 2 + (dir[0] / len) * buff + (sx * natural.w) / 2;
      cy = other.cy + (sy * size.h) / 2 + (dir[1] / len) * buff + (sy * natural.h) / 2;
    }
    if (place?.toEdge) {
      const dir = direction(place.toEdge, 'DOWN');
      const buff = 0.5;
      const frameW = width / unit;
      const frameH = height / unit;
      if (dir[0] !== 0) cx = dir[0] * (frameW / 2 - buff - natural.w / 2);
      if (dir[1] !== 0) cy = dir[1] * (frameH / 2 - buff - natural.h / 2);
    }
    if (offset) {
      cx += offset[0];
      cy += offset[1];
    }
    return { cx, cy };
  };

  const adopt = (
    spec: DslNodeSpec,
    drawn: { w: number; h: number },
    naturalCx: number,
    naturalCy: number,
  ) => {
    const vis = visualSize(drawn.w, drawn.h, spec.rotate);
    const center = resolveCenter(
      { cx: naturalCx, cy: naturalCy, w: vis.w, h: vis.h },
      spec.place,
      spec.offset,
    );
    const outer = document.createElement('div');
    outer.dataset.awbId = spec.id;
    outer.style.position = 'absolute';
    outer.style.overflow = 'visible';
    outer.style.color = spec.color;
    outer.style.opacity = spec.show === 'carry' ? '1' : '0';
    outer.style.transformOrigin = '50% 50%';
    outer.style.zIndex = String(spec.z ?? zTop++);
    const inner = document.createElement('div');
    inner.style.width = '100%';
    inner.style.height = '100%';
    inner.style.position = 'relative';
    inner.style.transformOrigin = '50% 50%';
    outer.appendChild(inner);
    root.appendChild(outer);
    const handle: Handle = {
      id: spec.id,
      outer,
      inner,
      cx: center.cx,
      cy: center.cy,
      w: drawn.w,
      h: drawn.h,
      color: spec.color,
      fill: spec.fill,
      fillOpacity: spec.fillOpacity ?? (spec.fill ? 1 : 0),
      rotate: spec.rotate,
      scale: 1,
      tx: 0,
      ty: 0,
      carried: spec.show === 'carry',
      strokes: [],
    };
    mount(handle);
    utils.set(outer, { x: 0, y: 0, scale: 1 });
    if (spec.rotate) utils.set(inner, { rotate: cssRotate(spec.rotate) });
    handles.set(spec.id, handle);
    return handle;
  };

  const addSvg = (inner: HTMLElement, wPx: number, hPx: number) => {
    const el = svg('svg', { viewBox: `0 0 ${wPx} ${hPx}`, width: wPx, height: hPx });
    el.style.display = 'block';
    el.style.overflow = 'visible';
    inner.appendChild(el);
    return el;
  };

  const paint = (spec: DslNodeSpec, solid: boolean) => {
    if (solid) return { fill: spec.color, opacity: 1, stroke: 'none', sw: 0 };
    const opacity = spec.fillOpacity ?? (spec.fill ? 1 : 0);
    return {
      fill: opacity > 0 ? (spec.fill ?? spec.color) : 'none',
      opacity,
      stroke: 'currentColor',
      sw: spec.strokeWidth,
    };
  };

  const addShape = (
    parent: SVGElement,
    tag: string,
    attrs: Record<string, string | number>,
    len: number,
    handle: Handle,
  ) => {
    const el = svg(tag, attrs);
    parent.appendChild(el);
    if (len > 0) handle.strokes.push({ el, len });
    return el;
  };

  const drawPoints = (
    spec: DslNodeSpec,
    points: { x: number; y: number }[],
    close: boolean,
    natural: { cx: number; cy: number },
  ) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = 0;
      maxY = 0;
    }
    const sw = spec.strokeWidth;
    const drawn = { w: Math.max(0, maxX - minX) + sw / unit, h: Math.max(0, maxY - minY) + sw / unit };
    const handle = adopt(spec, drawn, natural.cx, natural.cy);
    const wPx = drawn.w * unit;
    const hPx = drawn.h * unit;
    const rootSvg = addSvg(handle.inner, wPx, hPx);
    const local = points.map((p) => ({
      x: (p.x - minX) * unit + sw / 2,
      y: (maxY - p.y) * unit + sw / 2,
    }));
    let d = '';
    let len = 0;
    local.forEach((p, i) => {
      d += i === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`;
      if (i > 0) {
        const prev = local[i - 1]!;
        len += Math.hypot(p.x - prev.x, p.y - prev.y);
      }
    });
    if (close && local.length > 2) {
      d += ' Z';
      const first = local[0]!;
      const last = local[local.length - 1]!;
      len += Math.hypot(first.x - last.x, first.y - last.y);
    }
    const ink = paint(spec, false);
    addShape(
      rootSvg,
      'path',
      {
        d,
        fill: ink.fill,
        'fill-opacity': ink.opacity,
        stroke: ink.stroke,
        'stroke-width': ink.sw,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      },
      len,
      handle,
    );
    return handle;
  };

  const scaleAround = (points: { x: number; y: number }[], scale: number) => {
    if (scale === 1 || !points.length) return points;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return points.map((p) => ({ x: cx + (p.x - cx) * scale, y: cy + (p.y - cy) * scale }));
  };

  const drawOval = (spec: DslNodeSpec, rw: number, rh: number, solid: boolean) => {
    const sw = solid ? 0 : spec.strokeWidth;
    const drawn = { w: rw * 2 + sw / unit, h: rh * 2 + sw / unit };
    const handle = adopt(spec, drawn, 0, 0);
    const wPx = drawn.w * unit;
    const hPx = drawn.h * unit;
    const rootSvg = addSvg(handle.inner, wPx, hPx);
    const ink = paint(spec, solid);
    const rx = rw * unit;
    const ry = rh * unit;
    addShape(
      rootSvg,
      'ellipse',
      {
        cx: wPx / 2,
        cy: hPx / 2,
        rx,
        ry,
        fill: ink.fill,
        'fill-opacity': ink.opacity,
        stroke: ink.stroke,
        'stroke-width': ink.sw,
      },
      solid ? 0 : 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2),
      handle,
    );
    return handle;
  };

  const drawRect = (spec: DslNodeSpec, rw: number, rh: number) => {
    const sw = spec.strokeWidth;
    const drawn = { w: rw + sw / unit, h: rh + sw / unit };
    const handle = adopt(spec, drawn, 0, 0);
    const wPx = drawn.w * unit;
    const hPx = drawn.h * unit;
    const rootSvg = addSvg(handle.inner, wPx, hPx);
    const ink = paint(spec, false);
    addShape(
      rootSvg,
      'rect',
      {
        x: sw / 2,
        y: sw / 2,
        width: rw * unit,
        height: rh * unit,
        fill: ink.fill,
        'fill-opacity': ink.opacity,
        stroke: ink.stroke,
        'stroke-width': ink.sw,
        'stroke-linejoin': 'round',
      },
      2 * (rw + rh) * unit,
      handle,
    );
    return handle;
  };

  const measure = (inner: HTMLElement, text: string, fontSize: number) => {
    const w = inner.offsetWidth || estimateWidth(text, fontSize);
    const h = inner.offsetHeight || fontSize * 1.2;
    return { w: Math.max(1, w) / unit, h: Math.max(1, h) / unit };
  };

  const drawText = (spec: DslNodeSpec, text: string, fontSize: number) => {
    const size = fontSize * spec.scale;
    const outer = document.createElement('div');
    outer.dataset.awbId = spec.id;
    outer.style.position = 'absolute';
    outer.style.color = spec.color;
    outer.style.opacity = spec.show === 'carry' ? '1' : '0';
    outer.style.transformOrigin = '50% 50%';
    outer.style.zIndex = String(spec.z ?? zTop++);
    const inner = document.createElement('div');
    inner.style.position = 'relative';
    inner.style.width = 'max-content';
    inner.style.fontSize = `${size}px`;
    inner.style.lineHeight = '1.2';
    inner.style.whiteSpace = 'nowrap';
    inner.style.fontFamily = FONT;
    inner.style.transformOrigin = '50% 50%';
    inner.textContent = text;
    outer.appendChild(inner);
    root.appendChild(outer);
    const box = measure(inner, text, size);
    const vis = visualSize(box.w, box.h, spec.rotate);
    const center = resolveCenter({ cx: 0, cy: 0, w: vis.w, h: vis.h }, spec.place, spec.offset);
    const handle: Handle = {
      id: spec.id,
      outer,
      inner,
      cx: center.cx,
      cy: center.cy,
      w: box.w,
      h: box.h,
      color: spec.color,
      fillOpacity: 0,
      rotate: spec.rotate,
      scale: 1,
      tx: 0,
      ty: 0,
      carried: spec.show === 'carry',
      strokes: [],
    };
    mount(handle);
    utils.set(outer, { x: 0, y: 0, scale: 1 });
    if (spec.rotate) utils.set(inner, { rotate: cssRotate(spec.rotate) });
    handles.set(spec.id, handle);
    return handle;
  };

  const drawTex = (spec: DslNodeSpec, latex: string, fontSize: number) => {
    // KaTeX 斜体比 MathJax 窄。同样的 fontSize，b² 墨迹大约 41px，manim 是 50px，差 18%。
    // 1.1 只把字宽拉进 15%。上标高度靠抬高那一行，不靠这个倍数。
    const size = fontSize * spec.scale * 1.1;
    const outer = document.createElement('div');
    outer.dataset.awbId = spec.id;
    outer.style.position = 'absolute';
    outer.style.overflow = 'visible';
    outer.style.color = spec.color;
    outer.style.opacity = spec.show === 'carry' ? '1' : '0';
    outer.style.transformOrigin = '50% 50%';
    outer.style.zIndex = String(spec.z ?? zTop++);
    const inner = document.createElement('div');
    inner.style.position = 'relative';
    inner.style.width = 'max-content';
    inner.style.fontSize = `${size}px`;
    inner.style.lineHeight = 'normal';
    inner.style.overflow = 'visible';
    inner.style.transformOrigin = '50% 50%';
    // contrast(1) 不改颜色、不改粗细。滤镜层让字形走灰度抗锯齿，
    // 否则白字边上会留下蓝、橙色的亚像素，放大后像描了一圈。
    inner.style.filter = 'contrast(1)';
    outer.appendChild(inner);
    root.appendChild(outer);
    renderTex(inner, latex);
    // offsetWidth 不含上标伸出去的那一截。Write 的 clip-path 按外框裁，
    // 上标会只剩一条边。按字形盒子量，再把伸出的部分挪进外框。
    const fit = fitTex(inner, latex, size);
    inner.style.position = 'absolute';
    inner.style.left = `${fit.dx}px`;
    inner.style.top = `${fit.dy}px`;
    const box = { w: fit.w / unit, h: fit.h / unit };
    const vis = visualSize(box.w, box.h, spec.rotate);
    const center = resolveCenter({ cx: 0, cy: 0, w: vis.w, h: vis.h }, spec.place, spec.offset);
    const handle: Handle = {
      id: spec.id,
      outer,
      inner,
      cx: center.cx,
      cy: center.cy,
      w: box.w,
      h: box.h,
      color: spec.color,
      fillOpacity: 0,
      rotate: spec.rotate,
      scale: 1,
      tx: 0,
      ty: 0,
      carried: spec.show === 'carry',
      strokes: [],
      // latex 留在节点上，公式变形按片段比对
    };
    inner.dataset.latex = latex;
    mount(handle);
    utils.set(outer, { x: 0, y: 0, scale: 1 });
    if (spec.rotate) utils.set(inner, { rotate: cssRotate(spec.rotate) });
    handles.set(spec.id, handle);
    return handle;
  };

  const dataPoint = (axes: AxesGeom, x: number, y: number) => ({
    x: axes.cx - axes.xLen / 2 + ((x - axes.xMin) / (axes.xMax - axes.xMin || 1)) * axes.xLen,
    y: axes.cy - axes.yLen / 2 + ((y - axes.yMin) / (axes.yMax - axes.yMin || 1)) * axes.yLen,
  });

  const drawAxes = (spec: DslNodeSpec, plane: boolean) => {
    const xRange = pair(Array.isArray(spec.props.xRange) ? spec.props.xRange : null, [-5, 5]);
    const yRange = pair(
      Array.isArray(spec.props.yRange) ? spec.props.yRange : null,
      plane ? [-4, 4] : [-3, 3],
    );
    const xStep = Array.isArray(spec.props.xRange) ? Number(spec.props.xRange[2] ?? 1) : 1;
    const yStep = Array.isArray(spec.props.yRange) ? Number(spec.props.yRange[2] ?? 1) : 1;
    const xMin = xRange[0];
    const xMax = xRange[1];
    const yMin = yRange[0];
    const yMax = yRange[1];
    const xLen = num(spec.props, 'xLength', xMax - xMin) * spec.scale;
    const yLen = num(spec.props, 'yLength', yMax - yMin) * spec.scale;
    const sw = plane ? 1 : spec.strokeWidth || 2;
    const drawn = { w: xLen + sw / unit, h: yLen + sw / unit };
    const handle = adopt(spec, drawn, 0, 0);
    if (plane) handle.outer.dataset.awbRole = 'canvas';
    const axes: AxesGeom = { cx: handle.cx, cy: handle.cy, xMin, xMax, yMin, yMax, xLen, yLen };
    handle.axes = axes;
    const wPx = drawn.w * unit;
    const hPx = drawn.h * unit;
    const rootSvg = addSvg(handle.inner, wPx, hPx);
    const toLocal = (x: number, y: number) => {
      const p = dataPoint(axes, x, y);
      return { x: wPx / 2 + (p.x - axes.cx) * unit, y: hPx / 2 - (p.y - axes.cy) * unit };
    };
    const lines: { x: number; y: number }[][] = [];
    const pushLine = (a: { x: number; y: number }, b: { x: number; y: number }) => lines.push([a, b]);
    if (plane) {
      const xs = xStep > 0 ? xStep : 1;
      const ys = yStep > 0 ? yStep : 1;
      for (let x = Math.ceil(xMin / xs) * xs; x <= xMax + 1e-6; x += xs) {
        pushLine(toLocal(x, yMin), toLocal(x, yMax));
      }
      for (let y = Math.ceil(yMin / ys) * ys; y <= yMax + 1e-6; y += ys) {
        pushLine(toLocal(xMin, y), toLocal(xMax, y));
      }
    }
    if (yMin <= 0 && yMax >= 0) pushLine(toLocal(xMin, 0), toLocal(xMax, 0));
    if (xMin <= 0 && xMax >= 0) pushLine(toLocal(0, yMin), toLocal(0, yMax));
    const tick = 0.08 * unit;
    const xs = xStep > 0 ? xStep : 1;
    const ys = yStep > 0 ? yStep : 1;
    if (!plane) {
      if (yMin <= 0 && yMax >= 0) {
        for (let x = Math.ceil(xMin / xs) * xs; x <= xMax + 1e-6; x += xs) {
          const p = toLocal(x, 0);
          pushLine({ x: p.x, y: p.y - tick }, { x: p.x, y: p.y + tick });
        }
      }
      if (xMin <= 0 && xMax >= 0) {
        for (let y = Math.ceil(yMin / ys) * ys; y <= yMax + 1e-6; y += ys) {
          const p = toLocal(0, y);
          pushLine({ x: p.x - tick, y: p.y }, { x: p.x + tick, y: p.y });
        }
      }
    }
    let d = '';
    let len = 0;
    for (const [a, b] of lines) {
      if (!a || !b) continue;
      d += `M ${a.x} ${a.y} L ${b.x} ${b.y} `;
      len += Math.hypot(b.x - a.x, b.y - a.y);
    }
    addShape(
      rootSvg,
      'path',
      {
        d,
        fill: 'none',
        stroke: plane ? '#888888' : 'currentColor',
        'stroke-width': sw,
        'stroke-opacity': plane ? 0.45 : 1,
      },
      len,
      handle,
    );
    return handle;
  };

  const drawGraph = (spec: DslNodeSpec) => {
    const expr = String(spec.props.expr ?? '');
    if (!isSafeExpr(expr)) throw new Error('函数表达式包含不允许的内容');
    const fn = new Function('x', `return (${expr});`) as (x: number) => number;
    const axesId = spec.props.axes;
    const axes = typeof axesId === 'string' ? handles.get(axesId)?.axes : undefined;
    if (typeof axesId === 'string' && !axes) throw new Error(`引用的元素 "${axesId}" 不存在`);
    const range = pair(spec.props.xRange, axes ? [axes.xMin, axes.xMax] : [-5, 5]);
    const points: { x: number; y: number }[] = [];
    const samples = 80;
    for (let i = 0; i <= samples; i++) {
      const x = range[0] + ((range[1] - range[0]) * i) / samples;
      let y: number;
      try {
        y = fn(x);
      } catch {
        continue;
      }
      if (!Number.isFinite(y)) continue;
      points.push(axes ? dataPoint(axes, x, y) : { x, y });
    }
    const scaled = scaleAround(points, spec.scale);
    if (!scaled.length) return drawPoints(spec, [{ x: 0, y: 0 }], false, { cx: 0, cy: 0 });
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of scaled) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return drawPoints(spec, scaled, false, { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
  };

  const drawBrace = (spec: DslNodeSpec) => {
    const target = handles.get(String(spec.props.target ?? ''));
    if (!target) throw new Error(`引用的元素 "${spec.props.target ?? ''}" 不存在`);
    const dir = direction(String(spec.props.dir ?? 'DOWN'), 'DOWN');
    const horizontal = Math.abs(dir[1]) >= Math.abs(dir[0]);
    const span = horizontal ? target.w : target.h;
    const thick = 0.22 * spec.scale;
    const gap = 0.08;
    const sx = Math.sign(dir[0]);
    const sy = Math.sign(dir[1]);
    const cx = target.cx + sx * (target.w / 2 + gap + (horizontal ? 0 : thick / 2));
    const cy = target.cy + sy * (target.h / 2 + gap + (horizontal ? thick / 2 : 0));
    const drawn = horizontal ? { w: Math.max(span, 0.2), h: thick } : { w: thick, h: Math.max(span, 0.2) };
    const handle = adopt(spec, drawn, cx, cy);
    const wPx = drawn.w * unit;
    const hPx = drawn.h * unit;
    const rootSvg = addSvg(handle.inner, wPx, hPx);
    const tip = horizontal ? (dir[1] > 0 ? hPx : 0) : dir[0] > 0 ? wPx : 0;
    const base = horizontal ? (dir[1] > 0 ? 0 : hPx) : dir[0] > 0 ? 0 : wPx;
    let d: string;
    if (horizontal) {
      const mid = wPx / 2;
      const q = (tip + base) / 2;
      d = `M 0 ${base} Q 0 ${q} ${mid / 2} ${q} Q ${mid} ${q} ${mid} ${tip} Q ${mid} ${q} ${mid + mid / 2} ${q} Q ${wPx} ${q} ${wPx} ${base}`;
    } else {
      const mid = hPx / 2;
      const q = (tip + base) / 2;
      d = `M ${base} 0 Q ${q} 0 ${q} ${mid / 2} Q ${q} ${mid} ${tip} ${mid} Q ${q} ${mid} ${q} ${mid + mid / 2} Q ${q} ${hPx} ${base} ${hPx}`;
    }
    const len = (horizontal ? wPx : hPx) * 1.4;
    addShape(
      rootSvg,
      'path',
      {
        d,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': spec.strokeWidth || 3,
        'stroke-linecap': 'round',
      },
      len,
      handle,
    );
    return handle;
  };

  const drawGroup = (spec: DslNodeSpec) => {
    const ids = Array.isArray(spec.props.children) ? spec.props.children : [];
    const kids: Handle[] = [];
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      const kid = handles.get(id);
      if (!kid) throw new Error(`引用的元素 "${id}" 不存在`);
      kids.push(kid);
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const kid of kids) {
      const size = visualSize(kid.w, kid.h, kid.rotate);
      minX = Math.min(minX, kid.cx - size.w / 2);
      maxX = Math.max(maxX, kid.cx + size.w / 2);
      minY = Math.min(minY, kid.cy - size.h / 2);
      maxY = Math.max(maxY, kid.cy + size.h / 2);
    }
    if (!kids.length) {
      minX = 0;
      minY = 0;
      maxX = 0;
      maxY = 0;
    }
    const natural = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
    const drawn = { w: natural.w * spec.scale, h: natural.h * spec.scale };
    const handle = adopt({ ...spec, scale: 1, rotate: spec.rotate }, drawn, natural.cx, natural.cy);
    const dx = handle.cx - natural.cx;
    const dy = handle.cy - natural.cy;
    const gl = px(handle.cx) - (drawn.w * unit) / 2;
    const gt = py(handle.cy) - (drawn.h * unit) / 2;
    for (const kid of kids) {
      kid.cx += dx;
      kid.cy += dy;
      kid.outer.style.opacity = '1';
      const kl = px(kid.cx) - (kid.w * unit) / 2;
      const kt = py(kid.cy) - (kid.h * unit) / 2;
      kid.outer.style.left = `${kl - gl}px`;
      kid.outer.style.top = `${kt - gt}px`;
      handle.inner.appendChild(kid.outer);
    }
    return handle;
  };

  const build = (spec: DslNodeSpec) => {
    const props = spec.props;
    const scale = spec.scale || 1;
    switch (spec.type) {
      case 'Circle':
        return drawOval(spec, num(props, 'radius', 1) * scale, num(props, 'radius', 1) * scale, false);
      case 'Dot':
        return drawOval(
          { ...spec, scale: 1 },
          num(props, 'radius', 0.08) * scale,
          num(props, 'radius', 0.08) * scale,
          true,
        );
      case 'Square':
        return drawRect(spec, num(props, 'sideLength', 2) * scale, num(props, 'sideLength', 2) * scale);
      case 'Rectangle':
        return drawRect(spec, num(props, 'width', 4) * scale, num(props, 'height', 2) * scale);
      case 'Polygon': {
        const raw = Array.isArray(props.points)
          ? props.points.map((p) => ({
              x: Number((p as number[])[0] ?? 0),
              y: Number((p as number[])[1] ?? 0),
            }))
          : [];
        const points = scaleAround(raw, scale);
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const p of points) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        const cx = points.length ? (minX + maxX) / 2 : 0;
        const cy = points.length ? (minY + maxY) / 2 : 0;
        return drawPoints(spec, points, true, { cx, cy });
      }
      case 'Line':
      case 'Arrow': {
        const start = pair(props.start);
        const end = pair(props.end);
        const mid = { x: (start[0] + end[0]) / 2, y: (start[1] + end[1]) / 2 };
        const a = { x: mid.x + (start[0] - mid.x) * scale, y: mid.y + (start[1] - mid.y) * scale };
        const b = { x: mid.x + (end[0] - mid.x) * scale, y: mid.y + (end[1] - mid.y) * scale };
        if (spec.type === 'Line') return drawPoints(spec, [a, b], false, { cx: mid.x, cy: mid.y });
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const head = Math.min(0.28 * scale, len * 0.45);
        const hw = head * 0.45;
        const base = { x: b.x - ux * head, y: b.y - uy * head };
        const left = { x: base.x - uy * hw, y: base.y + ux * hw };
        const right = { x: base.x + uy * hw, y: base.y - ux * hw };
        const handle = drawPoints(spec, [a, base], false, { cx: mid.x, cy: mid.y });
        const sw = spec.strokeWidth;
        const minX = Math.min(a.x, base.x);
        const maxY = Math.max(a.y, base.y);
        const rootSvg = handle.inner.querySelector('svg');
        if (rootSvg) {
          const loc = (p: { x: number; y: number }) => ({
            x: (p.x - minX) * unit + sw / 2,
            y: (maxY - p.y) * unit + sw / 2,
          });
          const p1 = loc(b);
          const p2 = loc(left);
          const p3 = loc(right);
          const headLen =
            Math.hypot(p1.x - p2.x, p1.y - p2.y) +
            Math.hypot(p2.x - p3.x, p2.y - p3.y) +
            Math.hypot(p3.x - p1.x, p3.y - p1.y);
          addShape(
            rootSvg,
            'path',
            {
              d: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} Z`,
              fill: spec.color,
              stroke: 'none',
            },
            headLen,
            handle,
          );
        }
        return handle;
      }
      case 'Text':
        return drawText(spec, String(props.text ?? ''), num(props, 'fontSize', 48));
      case 'MathTex':
        return drawTex(spec, String(props.latex ?? ''), num(props, 'fontSize', 48));
      case 'Axes':
        return drawAxes(spec, false);
      case 'NumberPlane':
        return drawAxes(spec, true);
      case 'FunctionGraph':
        return drawGraph(spec);
      case 'Brace':
        return drawBrace(spec);
      case 'Group':
        return drawGroup(spec);
      default:
        throw new Error(`未知元素 ${spec.type}`);
    }
  };

  const track = (draw: () => void) => {
    const host = root as HTMLElement & Record<string, unknown>;
    const bag = host[AWB_BINDS];
    const list = Array.isArray(bag) ? (bag as Array<() => void>) : [];
    list.push(draw);
    host[AWB_BINDS] = list;
    draw();
  };

  const need = (id: string) => {
    const handle = handles.get(id);
    if (!handle) throw new Error(`引用的元素 "${id}" 不存在`);
    return handle;
  };

  const play = (spec: DslAnimSpec) => {
    const handle = need(spec.target);
    const ease = easeOf(spec.ease);
    const at = spec.at;
    const duration = Math.max(1, spec.duration);
    const params = spec.params ?? {};
    const show = () => tl.add(handle.outer, { opacity: [0, 1], duration: 1 }, at);
    // anime.js 会把 stroke-dashoffset 收成 1px 量级，描边会一下子全出现。
    // 改成普通数字，seek 时由 bind 写回真实长度。后一次描边覆盖前一次。
    const drawStroke = (from: number, to: number, start: number, dur: number) => {
      const state = { p: from };
      tl.add(state, { p: [from, to], duration: dur, ease }, start);
      const end = start + dur;
      track(() => {
        if (tl.currentTime + 0.01 < start) return;
        const p = tl.currentTime >= end ? to : state.p;
        for (const stroke of handle.strokes) {
          stroke.el.style.strokeDasharray = String(stroke.len);
          stroke.el.style.strokeDashoffset = String(stroke.len * p);
        }
      });
    };
    switch (spec.type) {
      case 'Create':
        show();
        drawStroke(1, 0, at, duration);
        return;
      case 'Uncreate':
        drawStroke(0, 1, at, duration);
        tl.add(handle.outer, { opacity: [1, 0], duration, ease }, at);
        return;
      case 'Write': {
        show();
        const state = { p: 0 };
        tl.add(state, { p: [0, 1], duration, ease }, at);
        const end = at + duration;
        track(() => {
          const now = tl.currentTime;
          if (now + 0.01 < at) {
            handle.outer.style.clipPath = 'inset(0 100% 0 0)';
            return;
          }
          // 落定后去掉裁切。inset(0) 仍按边框裁，抗锯齿和伸出的上标会被切掉。
          if (now + 0.01 >= end) {
            handle.outer.style.clipPath = 'none';
            return;
          }
          handle.outer.style.clipPath = `inset(0 ${(1 - state.p) * 100}% 0 0)`;
        });
        return;
      }
      case 'FadeIn':
        tl.add(handle.outer, { opacity: [0, 1], duration, ease }, at);
        return;
      case 'FadeOut':
        tl.add(handle.outer, { opacity: [1, 0], duration, ease }, at);
        return;
      case 'DrawBorderThenFill': {
        show();
        const half = Math.max(1, Math.round(duration / 2));
        drawStroke(1, 0, at, half);
        const fill = handle.fill ?? handle.color;
        const opacity = handle.fillOpacity > 0 ? handle.fillOpacity : 1;
        for (const stroke of handle.strokes) {
          stroke.el.setAttribute('fill', fill);
          tl.add(
            stroke.el,
            { fillOpacity: [0, opacity], duration: Math.max(1, duration - half), ease },
            at + half,
          );
        }
        return;
      }
      case 'GrowFromCenter':
        tl.add(handle.outer, { opacity: [0, 1], scale: [0, 1], duration, ease }, at);
        return;
      case 'Shift': {
        const by = pair(params.by);
        const x = handle.tx + by[0] * unit;
        const y = handle.ty - by[1] * unit;
        tl.add(handle.outer, { x: [handle.tx, x], y: [handle.ty, y], duration, ease }, at);
        handle.tx = x;
        handle.ty = y;
        return;
      }
      case 'MoveTo': {
        const dest = pair(params.at);
        const x = (dest[0] - handle.cx) * unit;
        const y = -(dest[1] - handle.cy) * unit;
        tl.add(handle.outer, { x: [handle.tx, x], y: [handle.ty, y], duration, ease }, at);
        handle.tx = x;
        handle.ty = y;
        return;
      }
      case 'Rotate': {
        const next = handle.rotate + Number(params.degrees ?? 0);
        tl.add(handle.inner, { rotate: [cssRotate(handle.rotate), cssRotate(next)], duration, ease }, at);
        handle.rotate = next;
        return;
      }
      case 'ScaleInPlace': {
        const next = handle.scale * Number(params.factor ?? 1);
        tl.add(handle.outer, { scale: [handle.scale, next], duration, ease }, at);
        handle.scale = next;
        return;
      }
      case 'SetColor': {
        const next = String(params.color ?? handle.color);
        tl.add(handle.outer, { color: [handle.color, next], duration, ease }, at);
        handle.color = next;
        return;
      }
      case 'Indicate':
        tl.add(
          handle.outer,
          {
            scale: [handle.scale, handle.scale * 1.2],
            color: [handle.color, '#FFFF00'],
            duration,
            ease: RATE_EASE.thereAndBack,
          },
          at,
        );
        return;
      case 'Wiggle':
        tl.add(
          handle.inner,
          {
            rotate: [cssRotate(handle.rotate), cssRotate(handle.rotate + 8)],
            duration,
            ease: (t: number) => Math.sin(t * Math.PI * 3) * (1 - t),
          },
          at,
        );
        return;
      case 'Circumscribe': {
        const size = visualSize(handle.w, handle.h, handle.rotate);
        const pad = 0.15 * unit;
        const w = size.w * unit + pad * 2;
        const ht = size.h * unit + pad * 2;
        const box = document.createElement('div');
        box.style.position = 'absolute';
        box.style.left = `${px(handle.cx) - w / 2}px`;
        box.style.top = `${py(handle.cy) - ht / 2}px`;
        box.style.width = `${w}px`;
        box.style.height = `${ht}px`;
        box.style.pointerEvents = 'none';
        const frame = addSvg(box, w, ht);
        const len = 2 * (w + ht);
        const rect = svg('rect', {
          x: 2,
          y: 2,
          width: Math.max(0, w - 4),
          height: Math.max(0, ht - 4),
          fill: 'none',
          stroke: handle.color,
          'stroke-width': 3,
          'stroke-dasharray': len,
          'stroke-dashoffset': len,
        });
        frame.appendChild(rect);
        root.appendChild(box);
        const drawFor = Math.max(1, Math.round(duration * 0.7));
        const state = { p: 1 };
        tl.add(state, { p: [1, 0], duration: drawFor, ease }, at);
        const end = at + drawFor;
        track(() => {
          if (tl.currentTime + 0.01 < at) return;
          const p = tl.currentTime >= end ? 0 : state.p;
          rect.style.strokeDasharray = String(len);
          rect.style.strokeDashoffset = String(len * p);
        });
        tl.add(box, { opacity: [1, 0], duration: Math.max(1, duration - drawFor), ease }, end);
        return;
      }
      case 'Flash': {
        const len = 0.45 * unit;
        const box = document.createElement('div');
        box.style.position = 'absolute';
        box.style.left = `${px(handle.cx) + handle.tx - len}px`;
        box.style.top = `${py(handle.cy) + handle.ty - len}px`;
        box.style.width = `${len * 2}px`;
        box.style.height = `${len * 2}px`;
        box.style.opacity = '0';
        box.style.transformOrigin = '50% 50%';
        const frame = addSvg(box, len * 2, len * 2);
        let d = '';
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2;
          const x1 = len + Math.cos(ang) * len * 0.25;
          const y1 = len + Math.sin(ang) * len * 0.25;
          const x2 = len + Math.cos(ang) * len * 0.95;
          const y2 = len + Math.sin(ang) * len * 0.95;
          d += `M ${x1} ${y1} L ${x2} ${y2} `;
        }
        frame.appendChild(
          svg('path', { d, fill: 'none', stroke: '#FFFF00', 'stroke-width': 3, 'stroke-linecap': 'round' }),
        );
        root.appendChild(box);
        const burst = Math.max(1, Math.round(duration * 0.35));
        tl.add(box, { opacity: [0, 1], scale: [0.4, 1], duration: burst, ease }, at);
        tl.add(box, { opacity: 0, scale: 1.5, duration: Math.max(1, duration - burst), ease }, at + burst);
        return;
      }
      case 'Transform':
      case 'TransformMatchingTex': {
        const to = need(spec.to ?? '');
        if (spec.type === 'TransformMatchingTex' && matchTex(handle, to, at, duration, ease)) return;
        const dx = (handle.cx - to.cx) * unit + handle.tx - to.tx;
        const dy = -(handle.cy - to.cy) * unit + handle.ty - to.ty;
        tl.add(handle.outer, { opacity: [1, 0], duration, ease }, at);
        tl.add(to.outer, { opacity: [0, 1], x: [dx, to.tx], y: [dy, to.ty], duration, ease }, at);
        return;
      }
      default:
        throw new Error(`未知动画 ${spec.type}`);
    }
  };

  const matchTex = (from: Handle, to: Handle, at: number, duration: number, ease: Ease) => {
    const leaves = (node: HTMLElement) =>
      [...node.querySelectorAll('.katex-html .base span')].filter(
        (el) => el.childElementCount === 0 && (el.textContent ?? '') !== '',
      ) as HTMLElement[];
    const a = leaves(from.inner);
    const b = leaves(to.inner);
    if (a.length < 2 || b.length < 2) return false;
    const pairs = lcs(
      a.map((el) => el.textContent ?? ''),
      b.map((el) => el.textContent ?? ''),
    );
    if (!pairs.length) return false;
    const matchedA = new Set(pairs.map((pair) => pair[0]));
    const matchedB = new Set(pairs.map((pair) => pair[1]));
    const tail = Math.max(1, Math.round(duration * 0.25));
    const head = Math.max(1, duration - tail);
    tl.add(to.outer, { opacity: [0, 1], duration: 1 }, at);
    a.forEach((el, i) => {
      const start = matchedA.has(i) ? at + head : at;
      const dur = matchedA.has(i) ? tail : duration;
      tl.add(el, { opacity: [1, 0], duration: dur, ease }, start);
    });
    b.forEach((el, i) => {
      el.style.opacity = '0';
      const start = matchedB.has(i) ? at + head : at;
      const dur = matchedB.has(i) ? tail : duration;
      tl.add(el, { opacity: [0, 1], duration: dur, ease }, start);
    });
    return true;
  };

  return {
    pad(ms: number) {
      if (ms > 0) tl.add({ duration: ms }, 0);
    },
    node(spec: DslNodeSpec) {
      build(spec);
    },
    fadeCarried(ms: number) {
      const nodes = [...handles.values()].filter((h) => h.carried).map((h) => h.outer);
      if (!nodes.length || ms <= 0) return;
      tl.add(nodes, { opacity: [1, 0], duration: ms, ease: RATE_EASE.smooth }, 0);
    },
    anim(spec: DslAnimSpec) {
      play(spec);
    },
  };
}

function lcs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = dp[i]!;
      const next = dp[i + 1]!;
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) i += 1;
    else j += 1;
  }
  return pairs;
}
