import { Channel, convertFileSrc, invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { ask, open } from '@tauri-apps/plugin-dialog';
import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { load, type Store } from '@tauri-apps/plugin-store';
import type { LlmEvent, Platform } from './types';

let store: Promise<Store> | null = null;
const settings = () => (store ??= load('settings.json', { defaults: {}, autoSave: 200 }));

export const tauriPlatform: Platform = {
  kind: 'tauri',
  join: (...parts) => join(...parts),
  appDataDir,
  exists: (p) => exists(p),
  mkdir: (p) => mkdir(p, { recursive: true }),
  readDir: async (p) => (await readDir(p)).map((e) => e.name),
  readText: (p) => readTextFile(p),
  readBinary: (p) => readFile(p),
  async writeTextAtomic(path, text) {
    const tmp = `${path}.tmp`;
    await writeTextFile(tmp, text);
    await rename(tmp, path);
  },
  writeBinary: (p, data) => writeFile(p, data),
  remove: (p) => remove(p, { recursive: true }),

  async pickDirectory(title) {
    // recursive: true 会把所选目录整体加入 fs 作用域，persisted-scope 负责跨会话记住
    const r = await open({ directory: true, recursive: true, title });
    return typeof r === 'string' ? r : null;
  },
  async pickFile(title, filters) {
    const r = await open({ multiple: false, title, filters });
    return typeof r === 'string' ? r : null;
  },
  confirm: (message, title) => ask(message, { title: title ?? 'Animation Workbench', kind: 'warning' }),
  openExternal: (p) => openPath(p),
  revealInDir: (p) => revealItemInDir(p),

  async storeGet<T>(key: string) {
    return (await settings()).get<T>(key);
  },
  async storeSet(key, value) {
    await (await settings()).set(key, value);
  },

  previewSrc: () => convertFileSrc('index.html', 'awpreview'),

  secretSet: (providerId, baseUrl, apiKey) => invoke('secret_set', { providerId, baseUrl, apiKey }),
  secretStatus: (providerId) => invoke('secret_status', { providerId }),
  secretRemove: (providerId) => invoke('secret_remove', { providerId }),
  llmChat(req, onEvent) {
    const ch = new Channel<LlmEvent>();
    ch.onmessage = onEvent;
    return invoke('llm_chat', { req, onEvent: ch });
  },
  llmCancel: (requestId) => invoke('llm_cancel', { requestId }),
};
