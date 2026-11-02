/** AI 服务商预设（PLAN §3.5）：统一走 OpenAI 兼容的 Chat Completions。模型名只是可修改的默认值 */

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  /** 是否支持 response_format: json_object */
  jsonMode: boolean;
  keyUrl?: string;
  note?: string;
}

export const PROVIDERS: Provider[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    jsonMode: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: '默认推荐，性价比高',
  },
  {
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    jsonMode: true,
    keyUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    jsonMode: true,
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    jsonMode: true,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    jsonMode: true,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    jsonMode: false,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    note: '走 OpenAI SDK 兼容层，不支持 JSON 模式',
  },
  {
    id: 'ollama',
    name: 'Ollama（本机）',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    jsonMode: true,
    note: '本机模型，Key 随便填一个即可（如 ollama）',
  },
  { id: 'custom', name: '自定义（OpenAI 兼容）', baseUrl: '', defaultModel: '', jsonMode: false },
];

export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]!;
