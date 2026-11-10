/** 截帧像素与版面启发式。只看像素和 bbox，不看 opacity。 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Raster {
  width: number;
  height: number;
  /** RGBA，行优先，长度必须是 width * height * 4。 */
  rgba: Uint8Array;
}

export interface LayoutBox {
  id: string;
  role: 'text' | 'other';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  /** `data-awb-role`。`canvas` 是满屏 svg/canvas，不出界。 */
  awbRole?: string;
}

/** 出界只算超出舞台四边这么多像素。贴边的网格线不算。 */
export const OVERFLOW_MARGIN = 48;

export interface LayoutHit {
  kind: 'overflow' | 'overlap';
  role: 'text' | 'other';
  id: string;
  otherId?: string;
  text?: string;
  bbox?: [number, number, number, number];
  ratio?: number;
}

export interface LayoutReport {
  outOfBounds: string[];
  overlaps: string[];
  hits: LayoutHit[];
  summary: string;
}

export interface ResidualReport {
  suspect: boolean;
  leftoverPixels: number;
  leftoverRatio: number;
  summary: string;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = i + 1 < bytes.length ? (bytes[i + 1] ?? 0) : 0;
    const c = i + 2 < bytes.length ? (bytes[i + 2] ?? 0) : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += B64[(triple >> 18) & 63];
    out += B64[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[triple & 63] : '=';
  }
  return out;
}

export function pngDataUrl(png: Uint8Array): string {
  return `data:image/png;base64,${bytesToBase64(png)}`;
}

export function solidRaster(width: number, height: number, fill: Rgb): Raster {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = fill.r;
    rgba[i * 4 + 1] = fill.g;
    rgba[i * 4 + 2] = fill.b;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i] ?? 0;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(n);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  const crc = crc32(body);
  const out = new Uint8Array(8 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc);
  return out;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + (data[i] ?? 0)) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** 无压缩的 zlib（stored blocks），避免在浏览器里依赖 Node zlib。 */
function zlibStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [];
  const size = 65535;
  const steps = Math.max(1, Math.ceil(data.length / size));
  for (let step = 0; step < steps; step++) {
    const start = step * size;
    const slice = data.subarray(start, Math.min(data.length, start + size));
    const last = step === steps - 1;
    const block = new Uint8Array(5 + slice.length);
    block[0] = last ? 1 : 0;
    block[1] = slice.length & 0xff;
    block[2] = (slice.length >> 8) & 0xff;
    const nlen = ~slice.length & 0xffff;
    block[3] = nlen & 0xff;
    block[4] = (nlen >> 8) & 0xff;
    block.set(slice, 5);
    blocks.push(block);
  }
  const deflated = concat(blocks);
  const out = new Uint8Array(2 + deflated.length + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  out.set(deflated, 2);
  const sum = adler32(data);
  out[out.length - 4] = (sum >>> 24) & 0xff;
  out[out.length - 3] = (sum >>> 16) & 0xff;
  out[out.length - 2] = (sum >>> 8) & 0xff;
  out[out.length - 1] = sum & 0xff;
  return out;
}

/** 把 RGBA 写成 PNG。大图走 Playwright 自己的截图字节，这里给假截帧和单测用。 */
export function encodePng(raster: Raster): Uint8Array {
  const { width, height, rgba } = raster;
  if (width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('截帧尺寸超出范围');
  if (rgba.length !== width * height * 4) throw new Error('截帧像素长度不对');
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const dest = y * (stride + 1);
    raw[dest] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), dest + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibStore(raw)),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

function near(a: Rgb, b: Rgb, tolerance: number): boolean {
  return (
    Math.abs(a.r - b.r) <= tolerance && Math.abs(a.g - b.g) <= tolerance && Math.abs(a.b - b.b) <= tolerance
  );
}

function pixel(raster: Raster, index: number): Rgb {
  const i = index * 4;
  return { r: raster.rgba[i] ?? 0, g: raster.rgba[i + 1] ?? 0, b: raster.rgba[i + 2] ?? 0 };
}

export function sampleBackground(raster: Raster): Rgb {
  if (!raster.width || !raster.height) return { r: 0, g: 0, b: 0 };
  const corners = [0, raster.width - 1, (raster.height - 1) * raster.width, raster.width * raster.height - 1];
  const colors = corners.map((index) => pixel(raster, index));
  const first = colors[0] ?? { r: 0, g: 0, b: 0 };
  if (colors.every((color) => near(color, first, 8))) return first;
  return { r: 0, g: 0, b: 0 };
}

/** 画框最外一圈里，和背景不像的像素占比。满屏网格会贴边，体检不拿它算出界。 */
export function edgeContentRatio(
  raster: Raster,
  background = sampleBackground(raster),
  tolerance = 18,
): number {
  const { width, height } = raster;
  if (!width || !height) return 0;
  let border = 0;
  let hit = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
      border += 1;
      if (!near(pixel(raster, y * width + x), background, tolerance)) hit += 1;
    }
  }
  return border ? hit / border : 0;
}

/** 色差按通道最大差。尺寸不同时无法比较。 */
export function diffPixels(a: Raster, b: Raster, tolerance: number): { count: number; ratio: number } | null {
  if (a.width !== b.width || a.height !== b.height || !a.width || !a.height) return null;
  let count = 0;
  const total = a.width * a.height;
  for (let i = 0; i < total; i++) {
    const left = pixel(a, i);
    const right = pixel(b, i);
    if (
      Math.abs(left.r - right.r) > tolerance ||
      Math.abs(left.g - right.g) > tolerance ||
      Math.abs(left.b - right.b) > tolerance
    ) {
      count += 1;
    }
  }
  return { count, ratio: count / total };
}

/** 和背景不一样的像素占比。 */
export function contentRatio(raster: Raster, background = sampleBackground(raster), tolerance = 18): number {
  const total = raster.width * raster.height;
  if (!total) return 0;
  let hit = 0;
  for (let i = 0; i < total; i++) if (!near(pixel(raster, i), background, tolerance)) hit += 1;
  return hit / total;
}

function boxLabel(box: LayoutBox): string {
  const text = box.text?.trim();
  return text ? `${box.id}「${text}」` : box.id;
}

function boxInside(inner: LayoutBox, outer: LayoutBox): boolean {
  const innerArea = Math.max(0, inner.width) * Math.max(0, inner.height);
  const outerArea = Math.max(0, outer.width) * Math.max(0, outer.height);
  if (innerArea <= 0 || outerArea <= innerArea) return false;
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

function overlapArea(a: LayoutBox, b: LayoutBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const w = right - left;
  const h = bottom - top;
  if (w <= 0 || h <= 0) return 0;
  return w * h;
}

export function checkLayout(input: {
  width: number;
  height: number;
  boxes: LayoutBox[];
  /** 截帧仍可传入。出界不再看边缘像素，满屏网格会把四边涂满。 */
  raster?: Raster;
  truncated?: boolean;
}): LayoutReport {
  const outOfBounds: string[] = [];
  const overlaps: string[] = [];
  const hits: LayoutHit[] = [];
  for (const box of input.boxes) {
    if (box.awbRole === 'canvas') continue;
    const edges = [
      box.x < -OVERFLOW_MARGIN ? '左' : '',
      box.y < -OVERFLOW_MARGIN ? '上' : '',
      box.x + box.width > input.width + OVERFLOW_MARGIN ? '右' : '',
      box.y + box.height > input.height + OVERFLOW_MARGIN ? '下' : '',
    ].filter(Boolean);
    if (!edges.length) continue;
    outOfBounds.push(`出界 ${boxLabel(box)}：超出${edges.join('、')}边`);
    hits.push({
      kind: 'overflow',
      role: box.role,
      id: box.id,
      ...(box.text ? { text: box.text } : {}),
      bbox: [box.x, box.y, box.width, box.height],
    });
  }
  for (let i = 0; i < input.boxes.length; i++) {
    for (let j = i + 1; j < input.boxes.length; j++) {
      const a = input.boxes[i];
      const b = input.boxes[j];
      if (!a || !b || a.role !== 'text' || b.role !== 'text') continue;
      if (a.awbRole === 'canvas' || b.awbRole === 'canvas') continue;
      if (boxInside(a, b) || boxInside(b, a)) continue;
      const area = overlapArea(a, b);
      const minArea = Math.min(
        Math.max(0, a.width) * Math.max(0, a.height),
        Math.max(0, b.width) * Math.max(0, b.height),
      );
      if (minArea <= 0) continue;
      const ratio = area / minArea;
      if (ratio < 0.15) continue;
      overlaps.push(`字叠 ${boxLabel(a)} 与 ${boxLabel(b)}：重叠 ${Math.round(ratio * 100)}%`);
      const label = [a.text?.trim() || a.id, b.text?.trim() || b.id].sort().join(' / ');
      hits.push({
        kind: 'overlap',
        role: 'text',
        id: a.id,
        otherId: b.id,
        text: label,
        ratio,
        bbox: [a.x, a.y, a.width, a.height],
      });
    }
  }
  const lines = [...outOfBounds, ...overlaps];
  if (!input.boxes.length) {
    lines.push('布局检查不可用：这一帧没有 DOM 包围盒。canvas 场景画在画布上，出界和字叠无法按元素判断。');
  }
  if (input.truncated) lines.push('DOM 框超过 40 个，只检查了前 40 个，文字框优先。');
  const summary = lines.length ? lines.join('\n') : '没有发现出界或字叠。';
  return { outOfBounds, overlaps, hits, summary };
}

/**
 * 整片 seek 帧相对单场渲染帧多出来的像素。
 * 上一场对象若还留在画面上，会算进 leftover，不看对象的 opacity。
 */
export function compareResidual(
  sequence: Raster,
  isolated: Raster,
  opts?: { tolerance?: number; ratio?: number; note?: string },
): ResidualReport {
  if (sequence.width !== isolated.width || sequence.height !== isolated.height) {
    return {
      suspect: false,
      leftoverPixels: 0,
      leftoverRatio: 0,
      summary: '两帧尺寸不同，无法比对像素。请重新截帧。',
    };
  }
  const tolerance = opts?.tolerance ?? 18;
  const ratioLimit = opts?.ratio ?? 0.005;
  const background = sampleBackground(isolated);
  let leftover = 0;
  const count = sequence.width * sequence.height;
  for (let i = 0; i < count; i++) {
    const seq = pixel(sequence, i);
    const iso = pixel(isolated, i);
    if (!near(seq, background, tolerance) && !near(seq, iso, tolerance)) leftover += 1;
  }
  const ratio = count ? leftover / count : 0;
  const suspect = ratio > ratioLimit;
  const percent = (ratio * 100).toFixed(2);
  const limit = (ratioLimit * 100).toFixed(1);
  const head = suspect
    ? `换场残留：整片帧比单场帧多出 ${leftover} 个不同像素（占画面 ${percent}%）。这是像素差，不是 opacity。上一场对象可能还留在画面上。`
    : `没有明显换场残留：整片帧与单场帧相差 ${leftover} 像素（占 ${percent}%），没有超过画面的 ${limit}%。`;
  const summary = opts?.note ? `${head}\n${opts.note}` : head;
  return { suspect, leftoverPixels: leftover, leftoverRatio: ratio, summary };
}
