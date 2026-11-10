import { createTimeline, type Timeline } from 'animejs';
import { AWB_HELPER_SOURCE, wrapSceneCode } from '../../../runtime/anime/awb';
import { animeApi, STAGE_HEIGHT, STAGE_WIDTH, type AnimeApi } from '../../../runtime/anime/player';

/**
 * 运行门。设计书 §7.1：禁用扫描、编译、执行、时长。
 * S8d 的 `syntaxError` 只存在于仓外原型，`apply.ts` 里没有这份函数，所以直接写在这里。
 *
 * 时长上限与 `validate.ts` 的场 120s、整片 600s 相同。这里量的是 anime 时间线毫秒，不是 DSL 的 sceneDuration。
 * 播放器会把短于 100ms 的场垫到 100ms；运行门在垫之前判断，所以刚好 100ms 仍然不通过。
 */

/** 本场时长必须严格大于这个值。 */
export const SCENE_MIN_MS = 100;
/** 本场时长上限，含 hold。 */
export const SCENE_MAX_MS = 120_000;
/** 整片时长上限。 */
export const FILM_MAX_MS = 600_000;

const USER_LINE_OFFSET = `${AWB_HELPER_SOURCE}\n{\n`.split('\n').length - 1;

export interface GateContext {
  width?: number;
  height?: number;
  /** 秒，与分镜的 hold 相同，算进本场时长。 */
  hold?: number;
  /** 其他场已经占用的毫秒，不含本场。 */
  otherDurationMs?: number;
  sceneId?: string;
  title?: string;
  enter?: 'fresh' | 'keep';
}

export interface BanMatch {
  line: number;
  rule: string;
  snippet: string;
}

export type GateCode = 'COMPILE_ERROR' | 'RUNTIME_ERROR' | 'BANNED_API' | 'DURATION_INVALID';

export interface GateError {
  code: GateCode;
  message: string;
  hint: string;
  line?: number;
  snippet?: string;
  matches?: BanMatch[];
}

export type GateResult =
  { ok: true; durationMs: number } | { ok: false; error: GateError; durationMs?: number };

export interface SyntaxLocation {
  line: number;
  message: string;
  snippet: string;
}

type SceneFn = (root: HTMLElement, anime: AnimeApi, tl: Timeline, ctx: object) => Promise<unknown>;

interface Rule {
  rule: string;
  source: string;
  flags?: string;
  keep?: (match: RegExpExecArray) => boolean;
}

const RULES: Rule[] = [
  { rule: 'anime.timeline(', source: String.raw`anime\s*\.\s*timeline\s*\(` },
  { rule: 'anime.animate(', source: String.raw`anime\s*\.\s*animate\s*\(` },
  { rule: 'anime.createTimeline(', source: String.raw`anime\s*\.\s*createTimeline\s*\(` },
  { rule: 'anime(', source: String.raw`anime\s*\(` },
  { rule: 'createTimeline(', source: String.raw`(?<![\w$.])createTimeline\s*\(` },
  { rule: 'tl.play(', source: String.raw`\btl\s*\.\s*play\s*\(` },
  { rule: 'tl.restart(', source: String.raw`\btl\s*\.\s*restart\s*\(` },
  { rule: '.resume(', source: String.raw`\.\s*resume\s*\(` },
  { rule: 'setTimeout', source: String.raw`\bsetTimeout\b` },
  { rule: 'setInterval', source: String.raw`\bsetInterval\b` },
  { rule: 'requestAnimationFrame', source: String.raw`\brequestAnimationFrame\b` },
  { rule: 'setAnimationLoop', source: String.raw`\bsetAnimationLoop\b` },
  { rule: 'THREE.Clock', source: String.raw`\bTHREE\s*\.\s*Clock\b` },
  { rule: '@keyframes', source: String.raw`@keyframes\b` },
  { rule: 'animation:', source: String.raw`\banimation\s*:` },
  { rule: 'transition:', source: String.raw`\btransition\s*:` },
  { rule: 'loop: true', source: String.raw`\bloop\s*:\s*true\b` },
  { rule: 'loop: Infinity', source: String.raw`\bloop\s*:\s*Infinity\b` },
  {
    rule: 'loop 数字 > 20',
    source: String.raw`\bloop\s*:\s*(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)`,
    keep: (match) => Number(match[1]) > 20,
  },
  { rule: 'Date.now', source: String.raw`\bDate\s*\.\s*now\b` },
  { rule: 'performance.now', source: String.raw`\bperformance\s*\.\s*now\b` },
  { rule: 'new Date(', source: String.raw`\bnew\s+Date\s*\(` },
  { rule: 'Math.random', source: String.raw`\bMath\s*\.\s*random\b` },
  { rule: 'fetch', source: String.raw`\bfetch\s*\(` },
  { rule: 'import(', source: String.raw`(?<![\w$.])import\s*\(` },
  { rule: 'import', source: String.raw`(?<![\w$.])import\b` },
  { rule: 'XMLHttpRequest', source: String.raw`\bXMLHttpRequest\b` },
  { rule: 'document.body', source: String.raw`\bdocument\s*\.\s*body\b` },
  { rule: 'document.getElementById', source: String.raw`\bdocument\s*\.\s*getElementById\s*\(` },
  { rule: 'querySelector 指向 root 之外', source: String.raw`(?<!root\.)\bquerySelector(?:All)?\s*\(` },
  { rule: 'export', source: String.raw`(?<![\w$.])export\b` },
  { rule: 'onUpdate', source: String.raw`\bonUpdate\b` },
  { rule: 'onRender', source: String.raw`\bonRender\b` },
];

const URL_RULES: Rule[] = [
  { rule: '<img src="http', source: String.raw`<img\b[^>\n]*\bsrc\s*=\s*(['"])https?:`, flags: 'i' },
  { rule: 'url(http', source: String.raw`url\(\s*(['"]?)https?:`, flags: 'i' },
];

const HAN = /\p{Script=Han}/u;
const CODE_SYMBOL = /[A-Za-z0-9_$=()[\]{};,.<>+\-*/%&|!~?:\\'"`@#]/;

function normalize(code: string): string {
  return code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function snippetAt(lines: string[], line: number): string {
  return (lines[line - 1] ?? '').trim().slice(0, 180);
}

/** 去掉注释，以及（keepStrings 为假时）字符串。换行和其余字符的位置保持不动。 */
function maskCode(code: string, keepStrings: boolean): string {
  const out = new Array<string>(code.length);
  for (let i = 0; i < code.length; i++) out[i] = code[i]!;
  const blank = (index: number) => {
    if (code[index] !== '\n') out[index] = ' ';
  };
  type Frame =
    | { k: 'code' }
    | { k: 'line' }
    | { k: 'block' }
    | { k: 'sq' }
    | { k: 'dq' }
    | { k: 'tpl' }
    | { k: 'expr'; depth: number };
  const stack: Frame[] = [{ k: 'code' }];

  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    const n = code[i + 1];
    const top = stack[stack.length - 1]!;
    if (top.k === 'line') {
      if (c === '\n') stack.pop();
      else blank(i);
      continue;
    }
    if (top.k === 'block') {
      if (c === '*' && n === '/') {
        blank(i);
        blank(i + 1);
        i += 1;
        stack.pop();
      } else blank(i);
      continue;
    }
    if (top.k === 'sq' || top.k === 'dq' || top.k === 'tpl') {
      const end = top.k === 'sq' ? "'" : top.k === 'dq' ? '"' : '`';
      if (!keepStrings) blank(i);
      if (c === '\\') {
        if (n !== undefined && !keepStrings) blank(i + 1);
        if (n !== undefined) i += 1;
        continue;
      }
      if (top.k === 'tpl' && c === '$' && n === '{') {
        if (!keepStrings) blank(i + 1);
        i += 1;
        stack.push({ k: 'expr', depth: 1 });
        continue;
      }
      if (c === end) stack.pop();
      continue;
    }
    if (top.k === 'expr') {
      if (c === '{') {
        top.depth += 1;
        continue;
      }
      if (c === '}') {
        top.depth -= 1;
        if (top.depth === 0) {
          if (!keepStrings) blank(i);
          stack.pop();
        }
        continue;
      }
    }
    if (c === '/' && n === '/') {
      blank(i);
      blank(i + 1);
      i += 1;
      stack.push({ k: 'line' });
      continue;
    }
    if (c === '/' && n === '*') {
      blank(i);
      blank(i + 1);
      i += 1;
      stack.push({ k: 'block' });
      continue;
    }
    if (c === "'") {
      if (!keepStrings) blank(i);
      stack.push({ k: 'sq' });
      continue;
    }
    if (c === '"') {
      if (!keepStrings) blank(i);
      stack.push({ k: 'dq' });
      continue;
    }
    if (c === '`') {
      if (!keepStrings) blank(i);
      stack.push({ k: 'tpl' });
    }
  }
  return out.join('');
}

function lineHits(line: string, lineNo: number, rules: Rule[], original: string): BanMatch[] {
  const found: { start: number; end: number; rule: string }[] = [];
  for (const rule of rules) {
    const re = new RegExp(rule.source, `g${rule.flags ?? ''}`);
    let match: RegExpExecArray | null;
    while ((match = re.exec(line))) {
      if (rule.keep && !rule.keep(match)) {
        if (match[0].length === 0) re.lastIndex += 1;
        continue;
      }
      found.push({ start: match.index, end: match.index + match[0].length, rule: rule.rule });
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const taken: BanMatch[] = [];
  let cursor = 0;
  for (const hit of found) {
    if (hit.start < cursor) continue;
    taken.push({ line: lineNo, rule: hit.rule, snippet: original.trim().slice(0, 180) });
    cursor = hit.end;
  }
  return taken;
}

function scanBanned(code: string): BanMatch[] {
  const lines = code.split('\n');
  const stripped = maskCode(code, false).split('\n');
  const withStrings = maskCode(code, true).split('\n');
  const matches: BanMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const original = lines[i] ?? '';
    matches.push(...lineHits(stripped[i] ?? '', lineNo, RULES, original));
    const text = (stripped[i] ?? '').trim();
    if (text && HAN.test(text) && !CODE_SYMBOL.test(text)) {
      matches.push({ line: lineNo, rule: '整行中文', snippet: original.trim().slice(0, 180) });
    }
    matches.push(...lineHits(withStrings[i] ?? '', lineNo, URL_RULES, original));
  }
  return matches;
}

function compileBody(code: string): SceneFn {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => SceneFn;
  return new AsyncFunction('root', 'anime', 'tl', 'ctx', wrapSceneCode(code));
}

function compileErrorOf(code: string): string | null {
  try {
    compileBody(code);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** 编译失败时指出用户代码里的行。「疑似」是因为引擎不给 AsyncFunction 的语法行号，按前缀重编译定位。 */
export function syntaxError(code: string): SyntaxLocation | null {
  const source = normalize(code);
  const full = compileErrorOf(source);
  if (full == null) return null;
  const lines = source.split('\n');
  let line = Math.max(1, lines.length);
  let fallback = line;
  let matched = false;
  for (let n = 1; n <= lines.length; n++) {
    const message = compileErrorOf(lines.slice(0, n).join('\n'));
    if (message != null) fallback = n;
    if (message === full) {
      line = n;
      matched = true;
      break;
    }
  }
  if (!matched) line = fallback;
  const snippet = snippetAt(lines, line);
  const quoted = snippet ? `（疑似这一行：${snippet}）` : '（疑似这一行）';
  return { line, snippet, message: `${full}${quoted}` };
}

function anonymousLine(err: unknown): number | undefined {
  const stack = err instanceof Error ? err.stack : undefined;
  if (!stack) return undefined;
  const match = /<anonymous>:(\d+):\d+/.exec(stack);
  if (!match?.[1]) return undefined;
  const line = Number(match[1]);
  return Number.isFinite(line) ? line : undefined;
}

let stackBias: number | undefined;

async function runtimeStackBias(ctx: object): Promise<number> {
  if (stackBias != null) return stackBias;
  const root = document.createElement('div');
  const tl = createTimeline({ autoplay: false });
  try {
    await compileBody('throw new Error("awb-gate-probe")')(root, animeApi, tl, ctx);
    stackBias = 2;
  } catch (e) {
    const reported = anonymousLine(e);
    stackBias = reported == null ? 2 : reported - USER_LINE_OFFSET - 1;
  } finally {
    settleTimeline(tl);
    root.remove();
  }
  return stackBias;
}

function userLineFromStack(err: unknown, bias: number, lineCount: number): number | undefined {
  const reported = anonymousLine(err);
  if (reported == null) return undefined;
  const line = reported - bias - USER_LINE_OFFSET;
  if (line < 1 || line > lineCount) return undefined;
  return line;
}

function durationLiteralLine(code: string): number | undefined {
  const lines = maskCode(code, false).split('\n');
  const re = /\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi;
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(lines[i] ?? ''))) {
      if (Number(match[0]) > SCENE_MAX_MS) return i + 1;
    }
  }
  return undefined;
}

function seconds(ms: number): string {
  const sec = ms / 1000;
  if (!Number.isFinite(sec)) return String(ms);
  return String(Math.round(sec * 1000) / 1000);
}

function settleTimeline(tl: Timeline) {
  const timer = tl as Timeline & { pause?: () => void; cancel?: () => void };
  timer.pause?.();
  timer.cancel?.();
}

function sceneContext(ctx: GateContext) {
  return {
    theme: {
      primary: '#58C4DD',
      secondary: '#83C167',
      accent: '#FC6255',
      text: '#FFFFFF',
      muted: '#888888',
      bg: '#000000',
    },
    sceneId: ctx.sceneId ?? 'scene',
    title: ctx.title ?? '',
    hold: Number.isFinite(ctx.hold) ? Math.max(0, ctx.hold ?? 0) : 0,
    enter: ctx.enter ?? 'fresh',
    width: ctx.width ?? STAGE_WIDTH,
    height: ctx.height ?? STAGE_HEIGHT,
  };
}

function bannedResult(matches: BanMatch[]): GateResult {
  const lines = matches
    .slice(0, 8)
    .map((match) => `第 ${match.line} 行 ${match.rule}：${match.snippet}`)
    .join('\n');
  return {
    ok: false,
    error: {
      code: 'BANNED_API',
      message: `命中禁用写法\n${lines}`,
      hint: '换写法',
      line: matches[0]?.line,
      snippet: matches[0]?.snippet,
      matches,
    },
  };
}

/**
 * 静态扫描 → 编译 → 建场（不播放）→ 时长。
 * 禁用写法在执行前返回，避免 `loop: true` 把时间线撑到 10⁹ 秒。
 */
export async function runScene(code: string, ctx: GateContext = {}): Promise<GateResult> {
  const source = normalize(code);
  if (!source.trim()) {
    return {
      ok: false,
      error: { code: 'COMPILE_ERROR', message: '代码是空的', hint: '改那一行', line: 1, snippet: '' },
    };
  }
  const matches = scanBanned(source);
  if (matches.length) return bannedResult(matches);

  const syntax = syntaxError(source);
  if (syntax) {
    return {
      ok: false,
      error: {
        code: 'COMPILE_ERROR',
        message: syntax.message,
        hint: '改那一行',
        line: syntax.line,
        snippet: syntax.snippet,
      },
    };
  }

  if (typeof document === 'undefined') {
    return {
      ok: false,
      error: { code: 'RUNTIME_ERROR', message: '没有 document，运行门无法建场', hint: '改' },
    };
  }

  const root = document.createElement('div');
  const tl = createTimeline({ autoplay: false });
  const sceneCtx = sceneContext(ctx);
  let durationMs = 0;
  let thrown: unknown;
  try {
    await compileBody(source)(root, animeApi, tl, sceneCtx);
    const holdMs = (Number.isFinite(ctx.hold) ? Math.max(0, ctx.hold ?? 0) : 0) * 1000;
    if (holdMs > 0) tl.add({ duration: holdMs });
    durationMs = Number(tl.duration) || 0;
  } catch (e) {
    thrown = e;
  } finally {
    settleTimeline(tl);
    root.remove();
  }
  if (thrown) {
    const bias = await runtimeStackBias(sceneCtx);
    const line = userLineFromStack(thrown, bias, source.split('\n').length);
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    const snippet = line ? snippetAt(source.split('\n'), line) : undefined;
    return {
      ok: false,
      error: {
        code: 'RUNTIME_ERROR',
        message,
        hint: '改',
        ...(line ? { line, snippet } : {}),
      },
    };
  }
  const otherMs = Number.isFinite(ctx.otherDurationMs) ? Math.max(0, ctx.otherDurationMs ?? 0) : 0;

  if (durationMs <= SCENE_MIN_MS || durationMs > SCENE_MAX_MS) {
    const line = durationLiteralLine(source);
    const why =
      durationMs <= SCENE_MIN_MS
        ? `本场时长 ${seconds(durationMs)}s，需要大于 ${seconds(SCENE_MIN_MS)}s`
        : `本场时长 ${seconds(durationMs)}s，超过 ${seconds(SCENE_MAX_MS)}s`;
    return {
      ok: false,
      durationMs,
      error: {
        code: 'DURATION_INVALID',
        message: why,
        hint: '查 loop、wait',
        ...(line ? { line, snippet: snippetAt(source.split('\n'), line) } : {}),
      },
    };
  }
  if (otherMs + durationMs > FILM_MAX_MS) {
    return {
      ok: false,
      durationMs,
      error: {
        code: 'DURATION_INVALID',
        message: `整片时长 ${seconds(otherMs + durationMs)}s，超过 ${seconds(FILM_MAX_MS)}s`,
        hint: '查 loop、wait',
      },
    };
  }
  return { ok: true, durationMs };
}
