/** 平台抽象：应用其他部分只通过它访问文件、对话框、密钥和 LLM（PLAN §0.3、§3.3） */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatReq {
  request_id: string;
  provider_id: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  json_mode: boolean;
}

export type LlmEvent =
  | { type: 'Delta'; text: string }
  | { type: 'Usage'; prompt: number; completion: number }
  | { type: 'Done'; finish_reason: string | null };

export interface ChatResult {
  text: string;
  usage: [number, number] | null;
  finish_reason: string | null;
}

export type LlmErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'bad_request'
  | 'server'
  | 'no_key'
  | 'keyring'
  | 'invalid_url';

export interface LlmError {
  code: LlmErrorCode;
  message: string;
  status?: number;
}

export const isLlmError = (e: unknown): e is LlmError =>
  typeof e === 'object' && e !== null && 'code' in e && 'message' in e;

export interface SecretStatus {
  exists: boolean;
  base_url: string | null;
  last4: string | null;
  backend: 'keychain' | 'memory';
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface Platform {
  kind: 'tauri' | 'mock';
  // 文件
  join(...parts: string[]): Promise<string>;
  appDataDir(): Promise<string>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  /** 先写临时文件再 rename，避免写到一半崩溃留下损坏的文件 */
  writeTextAtomic(path: string, text: string): Promise<void>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  // 对话框
  pickDirectory(title: string): Promise<string | null>;
  pickFile(title: string, filters: FileFilter[]): Promise<string | null>;
  confirm(message: string, title?: string): Promise<boolean>;
  openExternal(path: string): Promise<void>;
  revealInDir(path: string): Promise<void>;
  // 设置（应用级 key-value）
  storeGet<T>(key: string): Promise<T | undefined>;
  storeSet(key: string, value: unknown): Promise<void>;
  // 预览 iframe 地址
  previewSrc(): string;
  // 密钥与 LLM（只在 Rust 里用到 Key）
  secretSet(providerId: string, baseUrl: string, apiKey: string): Promise<'keychain' | 'memory'>;
  secretStatus(providerId: string): Promise<SecretStatus>;
  secretRemove(providerId: string): Promise<void>;
  llmChat(req: ChatReq, onEvent: (e: LlmEvent) => void): Promise<ChatResult>;
  llmCancel(requestId: string): Promise<void>;
}
