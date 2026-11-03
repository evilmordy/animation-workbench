import type { ChatReq, ChatResult, LlmError, LlmEvent, Platform, SecretStatus, ToolCall } from './types';

/** 浏览器开发/测试用的平台实现：内存文件系统（浏览器里持久化到 localStorage）+ 可替换的假 LLM */

type Entry = string | Uint8Array;
const LS_KEY = 'awb-mock-fs';
const files = new Map<string, Entry>();
const dirs = new Set<string>(['/']);
const settings = new Map<string, unknown>();
const secrets = new Map<string, { baseUrl: string; apiKey: string }>();
const inflight = new Map<string, () => void>();
const hasLS = typeof localStorage !== 'undefined';

function persist() {
  if (!hasLS) return;
  // 只持久化小的文本文件（导出的 HTML 有十几 MB，会超出 localStorage 配额）
  const text = [...files].filter(([, v]) => typeof v === 'string' && v.length < 1_000_000);
  localStorage.setItem(LS_KEY, JSON.stringify({ files: text, dirs: [...dirs], settings: [...settings] }));
}
if (hasLS) {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null');
    saved?.files?.forEach(([k, v]: [string, string]) => files.set(k, v));
    saved?.dirs?.forEach((d: string) => dirs.add(d));
    saved?.settings?.forEach(([k, v]: [string, unknown]) => settings.set(k, v));
  } catch {
    localStorage.removeItem(LS_KEY);
  }
}

const norm = (p: string) => '/' + p.split('/').filter(Boolean).join('/');
const parent = (p: string) => norm(p).split('/').slice(0, -1).join('/') || '/';
const notFound = (p: string) => new Error(`文件不存在：${p}`);

function ensureDir(p: string) {
  for (let d = norm(p); d !== '/'; d = parent(d)) dirs.add(d);
}

function write(path: string, data: Entry) {
  const p = norm(path);
  if (!dirs.has(parent(p))) throw new Error(`目录不存在：${parent(p)}`);
  files.set(p, data);
  persist();
}

export interface MockLlmResult {
  text: string;
  toolCalls?: ToolCall[];
  finishReason?: string | null;
}

/** 返回字符串时和以前一样：finish_reason 为 stop，没有 tool_calls。 */
export type MockLlm = (
  req: ChatReq,
  emit: (text: string) => Promise<void>,
) => Promise<string | MockLlmResult>;

let mockLlm: MockLlm = async () => {
  throw { code: 'no_key', message: '浏览器模式没有配置假 LLM' } satisfies LlmError;
};
/** 测试或 AI 模块注入假 LLM 的回答 */
export const setMockLlm = (fn: MockLlm) => (mockLlm = fn);

let projectCounter = 0;
/** 测试可预设对话框的返回值 */
export const mockDialogs = {
  nextDirectory: null as string | null,
  nextFile: null as string | null,
  confirm: true,
};

export const mockPlatform: Platform = {
  kind: 'mock',
  join: async (...parts) => norm(parts.join('/')),
  appDataDir: async () => '/appdata',
  exists: async (p) => files.has(norm(p)) || dirs.has(norm(p)),
  async mkdir(p) {
    ensureDir(p);
    persist();
  },
  async readDir(p) {
    const base = norm(p);
    const prefix = base === '/' ? '/' : base + '/';
    const names = new Set<string>();
    for (const k of [...files.keys(), ...dirs]) {
      if (k.startsWith(prefix) && k !== base) names.add(k.slice(prefix.length).split('/')[0]!);
    }
    return [...names];
  },
  async readText(p) {
    const v = files.get(norm(p));
    if (v === undefined) throw notFound(p);
    return typeof v === 'string' ? v : new TextDecoder().decode(v);
  },
  async readBinary(p) {
    const v = files.get(norm(p));
    if (v === undefined) throw notFound(p);
    return typeof v === 'string' ? new TextEncoder().encode(v) : v;
  },
  async writeTextAtomic(p, text) {
    write(p, text);
  },
  async writeBinary(p, data) {
    write(p, data);
  },
  async remove(p) {
    const base = norm(p);
    for (const k of [...files.keys()]) if (k === base || k.startsWith(base + '/')) files.delete(k);
    for (const d of [...dirs]) if (d === base || d.startsWith(base + '/')) dirs.delete(d);
    persist();
  },

  async pickDirectory() {
    const p = mockDialogs.nextDirectory ?? `/projects/动画项目${++projectCounter}`;
    mockDialogs.nextDirectory = null;
    ensureDir(p);
    return p;
  },
  async pickFile() {
    const p = mockDialogs.nextFile;
    mockDialogs.nextFile = null;
    return p;
  },
  confirm: async () => mockDialogs.confirm,
  async openExternal(p) {
    console.info('[mock] 打开', p);
  },
  async revealInDir(p) {
    console.info('[mock] 在文件夹中显示', p);
  },

  storeGet: async <T>(key: string) => settings.get(key) as T | undefined,
  async storeSet(key, value) {
    settings.set(key, value);
    persist();
  },

  previewSrc: () => '/__awpreview/index.html',

  async secretSet(providerId, baseUrl, apiKey) {
    secrets.set(providerId, { baseUrl, apiKey });
    return 'memory';
  },
  async secretStatus(providerId): Promise<SecretStatus> {
    const s = secrets.get(providerId);
    return {
      exists: !!s,
      base_url: s?.baseUrl ?? null,
      last4: s?.apiKey.slice(-4) ?? null,
      backend: 'memory',
    };
  },
  async secretRemove(providerId) {
    secrets.delete(providerId);
  },
  async llmChat(req: ChatReq, onEvent: (e: LlmEvent) => void): Promise<ChatResult> {
    let cancelled = false;
    inflight.set(req.request_id, () => (cancelled = true));
    const emit = async (text: string) => {
      await new Promise((r) => setTimeout(r, 5));
      if (cancelled) throw { code: 'cancelled', message: '已取消' } satisfies LlmError;
      onEvent({ type: 'Delta', text });
    };
    try {
      const raw = await mockLlm(req, emit);
      const text = typeof raw === 'string' ? raw : raw.text;
      const toolCalls = typeof raw === 'string' ? undefined : raw.toolCalls;
      const finish =
        typeof raw === 'string'
          ? 'stop'
          : raw.finishReason !== undefined
            ? raw.finishReason
            : toolCalls?.length
              ? 'tool_calls'
              : 'stop';
      const usage: [number, number] = [
        Math.ceil(JSON.stringify(req.messages).length / 4),
        Math.ceil(text.length / 4),
      ];
      onEvent({ type: 'Usage', prompt: usage[0], completion: usage[1] });
      onEvent({ type: 'Done', finish_reason: finish });
      return { text, usage, finish_reason: finish, ...(toolCalls?.length ? { tool_calls: toolCalls } : {}) };
    } finally {
      inflight.delete(req.request_id);
    }
  },
  async llmCancel(requestId) {
    inflight.get(requestId)?.();
  },
  async selftestReport(report) {
    console.info('[selftest]', report);
  },
};

/** 仅测试用：清空内存文件系统 */
export function resetMockFs() {
  files.clear();
  dirs.clear();
  dirs.add('/');
  settings.clear();
  secrets.clear();
  persist();
}
