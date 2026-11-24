import type { TraceEvent } from './check/gate';
import { changedBounds, type Raster } from './check/pixels';
import { SHARED_END, SHARED_START, splitShared } from './tools/code';

/** 设计书 §6.1。场内毫秒。只点了一帧时 range_ms 的两端相等。 */
export interface EditRequest {
  scene_id: string;
  range_ms: [number, number];
  point?: { x: number; y: number };
  element?: { tag: string; text: string; bbox: [number, number, number, number]; awb_n: number };
  instruction: string;
}

export interface FilmSpan {
  id: string;
  start: number;
  end: number;
}

const CREATE_NAMES = new Set(['el', 'txt', 'ctext', 'sv', 'head', 'say', 'tex']);
const ANIM_NAMES = new Set(['tw', 'wait', 'fadeIn', 'fadeOut', 'rise', 'head', 'say']);

export interface IndexedCall {
  line: number;
  text: string;
  name: string;
  n: number | null;
  start: number | null;
  end: number | null;
}

/** 去掉注释和字符串，换行留着，用来数调用。 */
function maskCalls(code: string): string {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i]!;
    const n = code[i + 1];
    if (c === '/' && n === '/') {
      while (i < code.length && code[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && n === '*') {
      out += '  ';
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        out += code[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < code.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      out += ' ';
      i += 1;
      while (i < code.length && code[i] !== c) {
        if (code[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        out += code[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < code.length) {
        out += ' ';
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function scanCalls(code: string, names: Set<string>): { line: number; text: string; name: string }[] {
  const raw = code.split('\n');
  const masked = maskCalls(code).split('\n');
  const found: { line: number; text: string; name: string }[] = [];
  const re = /\b(el|txt|ctext|sv|tw|wait|fadeIn|fadeOut|rise|head|say|tex)\s*\(/g;
  for (let i = 0; i < masked.length; i++) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(masked[i] ?? ''))) {
      const name = match[1] ?? '';
      if (!names.has(name)) continue;
      found.push({ line: i + 1, text: raw[i] ?? '', name });
    }
  }
  return found;
}

/**
 * 把运行轨迹按出现顺序安到源码调用上。
 * head/say 既建元素又是动画：建元素的 n 来自 node，时间来自同名 call。
 */
export function indexCalls(code: string, trace: TraceEvent[]): IndexedCall[] {
  const folded = code.includes(SHARED_START) && code.includes(SHARED_END);
  const body = folded ? splitShared(code).body : code;
  const offset = folded ? 1 : 0;
  const creates = scanCalls(body, CREATE_NAMES);
  const anims = scanCalls(body, ANIM_NAMES);
  const nodes = trace.filter((event) => event.kind === 'node');
  const calls = trace.filter((event) => event.kind === 'call');
  const byLine = new Map<number, IndexedCall>();
  creates.forEach((call, index) => {
    const node = nodes[index];
    const line = call.line + offset;
    byLine.set(line, {
      line,
      text: call.text,
      name: call.name,
      n: node?.n ?? index + 1,
      start: null,
      end: null,
    });
  });
  let callIndex = 0;
  for (const anim of anims) {
    const event = calls[callIndex];
    if (!event || event.name !== anim.name) continue;
    callIndex += 1;
    const line = anim.line + offset;
    const prev = byLine.get(line);
    byLine.set(line, {
      line,
      text: anim.text,
      name: anim.name,
      n: prev?.n ?? null,
      start: event.start ?? null,
      end: event.end ?? null,
    });
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

export function overlaps(call: IndexedCall, range: [number, number]): boolean {
  if (call.start == null || call.end == null) return false;
  const [from, to] = range[0] <= range[1] ? range : [range[1], range[0]];
  return call.end >= from && call.start <= to;
}

/** 区间等分 4 张。单帧再加前后 300ms，并夹在本场时长里。 */
export function frameTimes(range: [number, number], durationMs: number): number[] {
  const dur = Math.max(0, Math.round(durationMs));
  const [rawA, rawB] = range;
  const a = Math.max(0, Math.min(dur, Math.round(Math.min(rawA, rawB))));
  const b = Math.max(0, Math.min(dur, Math.round(Math.max(rawA, rawB))));
  const clamp = (value: number) => Math.max(0, Math.min(dur, Math.round(value)));
  const times =
    a === b ? [clamp(a - 300), a, clamp(a + 300)] : [0, 1, 2, 3].map((i) => clamp(a + ((b - a) * i) / 3));
  return [...new Set(times)];
}

/** 区间外各取一个时刻，用来写差异说明。 */
export function outsideTimes(range: [number, number], durationMs: number, used: number[]): number[] {
  const dur = Math.max(0, Math.round(durationMs));
  const [rawA, rawB] = range;
  const a = Math.max(0, Math.min(dur, Math.round(Math.min(rawA, rawB))));
  const b = Math.max(0, Math.min(dur, Math.round(Math.max(rawA, rawB))));
  const taken = new Set(used);
  const out: number[] = [];
  if (a >= 80) {
    const t = Math.round(a / 2);
    if (!taken.has(t)) out.push(t);
  }
  if (dur - b >= 80) {
    const t = Math.round((b + dur) / 2);
    if (!taken.has(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

function sceneOf(spans: FilmSpan[], time: number): FilmSpan | undefined {
  if (!spans.length) return undefined;
  const last = spans[spans.length - 1]!;
  if (time >= last.end) return last;
  return spans.find((span, index) => {
    const end = index === spans.length - 1 ? span.end : span.end;
    if (index === spans.length - 1) return time >= span.start && time <= end;
    return time >= span.start && time < span.end;
  });
}

function sliceMs(span: FilmSpan, from: number, to: number, last: boolean): [number, number] | null {
  const a = Math.max(from, span.start);
  const b = Math.min(to, span.end);
  if (last) {
    if (b < a) return null;
  } else if (b <= a) return null;
  return [Math.round((a - span.start) * 1000), Math.round((b - span.start) * 1000)];
}

/**
 * 由暂停点、时间线区间和点选生成请求。
 * 跨场区间拆成按场的多个请求。点和元素只挂在暂停时刻所在的那场。
 */
export function editRequests(input: {
  spans: FilmSpan[];
  time: number;
  range: [number, number] | null;
  point?: { x: number; y: number } | null;
  element?: EditRequest['element'] | null;
  instruction: string;
}): EditRequest[] {
  const spans = input.spans.filter((span) => span.end >= span.start);
  if (!spans.length || !input.instruction.trim()) return [];
  const filmEnd = spans[spans.length - 1]!.end;
  const time = Math.max(0, Math.min(input.time, filmEnd));
  const from = input.range ? Math.max(0, Math.min(input.range[0], input.range[1], filmEnd)) : time;
  const to = input.range ? Math.max(0, Math.min(Math.max(input.range[0], input.range[1]), filmEnd)) : time;
  const host = sceneOf(spans, time);
  const requests: EditRequest[] = [];
  spans.forEach((span, index) => {
    const last = index === spans.length - 1;
    const range =
      from === to
        ? sceneOf(spans, from)?.id === span.id
          ? ([
              Math.max(0, Math.round((from - span.start) * 1000)),
              Math.max(0, Math.round((from - span.start) * 1000)),
            ] as [number, number])
          : null
        : sliceMs(span, from, to, last);
    if (!range) return;
    const here = span.id === host?.id;
    requests.push({
      scene_id: span.id,
      range_ms: range,
      ...(here && input.point ? { point: { x: input.point.x, y: input.point.y } } : {}),
      ...(here && input.element ? { element: input.element } : {}),
      instruction: input.instruction.trim(),
    });
  });
  return requests;
}

export function outsideNote(samples: { tMs: number; before?: Raster; after?: Raster }[]): string {
  const lines: string[] = [];
  for (const sample of samples) {
    if (!sample.before || !sample.after) {
      lines.push(`区间外 ${sample.tMs}ms：没有像素可对`);
      continue;
    }
    const diff = changedBounds(sample.before, sample.after, 24);
    if (!diff) {
      lines.push(`区间外 ${sample.tMs}ms：两帧尺寸不同，没法比`);
      continue;
    }
    if (!diff.count) {
      lines.push(`区间外 ${sample.tMs}ms：没有差异`);
      continue;
    }
    const [x, y, w, h] = diff.bbox;
    const wide = w > (sample.before.width || 1) * 0.7 && h > (sample.before.height || 1) * 0.7;
    const local = diff.ratio < 0.2 && !wide;
    lines.push(
      `区间外 ${sample.tMs}ms：差异 ${diff.count} 像素（${(diff.ratio * 100).toFixed(1)}%），包围盒 [${x},${y},${w},${h}]，${local ? '局部' : '铺得比较开'}`,
    );
  }
  return lines.join('\n');
}

export function durationNote(previousMs: number, nextMs: number): string {
  if (previousMs <= 0 || Math.abs(nextMs - previousMs) <= 1) return '';
  return `本场时长 ${previousMs}ms → ${nextMs}ms，后面的场会整体后移`;
}
