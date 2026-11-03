/** 平台抽象：应用其他部分只通过它访问文件、对话框、密钥和 LLM（PLAN §0.3、§3.3） */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** OpenAI 兼容的 content part。image_url 可以是 data:image/png;base64 URL。 */
export type ContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: string } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** OpenAI 兼容的 function 工具定义。 */
export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type ToolChoice = 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };

export interface PartsMessage {
  role: 'system' | 'user' | 'assistant';
  content: ContentPart[];
}

export interface AssistantToolMessage {
  role: 'assistant';
  content: string | null;
  tool_calls: ToolCall[];
}

export interface ToolResultMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

/** 传给模型的消息。纯文本的 ChatMessage 是其中一种，旧调用只产生那种。 */
export type LlmMessage = ChatMessage | PartsMessage | AssistantToolMessage | ToolResultMessage;

export function messageText(content: string | ContentPart[] | null | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
}

export interface ChatReq {
  request_id: string;
  provider_id: string;
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  max_tokens?: number;
  /**
   * 为 true 时上游带 response_format: json_object。
   * 不传时 Rust 视为 false，不会强制 JSON。旧调用方仍然显式传入，默认行为不变。
   */
  json_mode?: boolean;
  /** 缺省或空数组时不要传。Rust 会省略，上游请求体与旧版一致。 */
  tools?: ToolDef[];
  tool_choice?: ToolChoice;
}

export type LlmEvent =
  | { type: 'Delta'; text: string }
  | { type: 'Usage'; prompt: number; completion: number }
  | { type: 'Done'; finish_reason: string | null };

export interface ChatResult {
  text: string;
  usage: [number, number] | null;
  finish_reason: string | null;
  /** 没有工具调用时 Rust 不序列化这个字段。 */
  tool_calls?: ToolCall[];
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
  /** 仅 debug 构建的真实环境自检：打印结果并退出应用 */
  selftestReport(report: string): Promise<void>;
}
