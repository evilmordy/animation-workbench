import { mockPlatform } from './mock';
import { tauriPlatform } from './tauri';
import type { Platform } from './types';

export * from './types';

/** 在 Tauri 窗口里用真实平台，在浏览器（pnpm dev / e2e）里用 mock */
export const platform: Platform =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? tauriPlatform : mockPlatform;
