/** 错误文案表（UX-06）：每条说明"发生了什么"和"接下来怎么做" */

export interface ErrorText {
  what: string;
  next: string;
}

export const LLM_ERRORS: Record<string, ErrorText> = {
  auth: { what: 'AI 服务拒绝了 API Key', next: '在设置里重新填写 Key，并确认它属于所选的服务商' },
  rate_limit: { what: 'AI 服务请求太频繁或额度用完', next: '稍等一分钟再试，或在设置里把并发数调低' },
  network: { what: '连不上 AI 服务', next: '检查网络和 Base URL；使用代理时确认代理已开启' },
  timeout: { what: 'AI 服务长时间没有响应', next: '稍后重试，或换一个响应更快的模型' },
  cancelled: { what: '已取消', next: '' },
  bad_request: { what: 'AI 服务不接受这次请求', next: '检查模型名是否正确；如果开启了 JSON 模式，试试关闭' },
  server: { what: 'AI 服务内部出错', next: '稍后重试，或换一个服务商' },
  no_key: { what: '还没有配置 API Key', next: '打开设置填写 Key，或者改用"手动模式"，复制提示词到网页版 AI' },
  keyring: { what: '系统钥匙串不可用', next: 'Key 只在本次运行期间有效；Linux 上可安装并启动 gnome-keyring' },
  invalid_url: { what: 'Base URL 不合法', next: '只允许 https 地址；本机或局域网（如 Ollama）可以用 http' },
};

export function describeError(e: unknown): ErrorText {
  if (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof e.code === 'string' &&
    LLM_ERRORS[e.code]
  ) {
    const base = LLM_ERRORS[e.code]!;
    const detail =
      'message' in e && typeof e.message === 'string' && e.message ? `（${e.message.slice(0, 160)}）` : '';
    return { what: base.what + detail, next: base.next };
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/forbidden path|not allowed|scope/i.test(msg))
    return { what: '应用没有权限访问这个位置', next: '请通过"打开项目"重新选择文件夹授权' };
  if (/No such file|not found|文件不存在|os error 2/i.test(msg))
    return { what: `找不到文件或文件夹：${msg}`, next: '它可能被移动或删除了，请重新选择' };
  return { what: msg, next: '' };
}
