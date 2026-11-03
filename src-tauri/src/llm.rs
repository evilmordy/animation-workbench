//! LLM 代理（PLAN §3.3）：前端不接触 Key，也不能指定请求地址；Base URL 从钥匙串条目里读。

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::Duration;

use futures_util::future::{AbortHandle, Abortable};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

use crate::secrets::{self, SecretState, StoredSecret};

const MAX_RETRIES: u32 = 2;

// ---------- 错误 ----------

#[derive(Debug, Serialize)]
pub struct LlmError {
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

impl LlmError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            status: None,
        }
    }

    fn from_status(status: u16, body: String) -> Self {
        let code = match status {
            401 | 403 => "auth",
            429 => "rate_limit",
            400..=499 => "bad_request",
            _ => "server",
        };
        Self {
            code,
            message: body.chars().take(500).collect(),
            status: Some(status),
        }
    }
}

impl From<reqwest::Error> for LlmError {
    fn from(e: reqwest::Error) -> Self {
        // without_url：错误文本里不出现请求地址；请求头（含 Authorization）本来就不会进错误信息
        let e = e.without_url();
        Self::new(
            if e.is_timeout() { "timeout" } else { "network" },
            e.to_string(),
        )
    }
}

// ---------- URL 规则（SEC-05） ----------

/// 只允许 https；http 仅限本机和局域网私有地址（Ollama 等）
pub fn check_base_url(raw: &str) -> Result<url::Url, LlmError> {
    let u = url::Url::parse(raw.trim()).map_err(|e| LlmError::new("invalid_url", e.to_string()))?;
    let local = match u.host() {
        Some(url::Host::Domain(d)) => d == "localhost",
        Some(url::Host::Ipv4(ip)) => ip.is_loopback() || ip.is_private(),
        Some(url::Host::Ipv6(ip)) => IpAddr::V6(ip).is_loopback(),
        None => false,
    };
    if !u.username().is_empty() || u.password().is_some() {
        return Err(LlmError::new(
            "invalid_url",
            "Base URL 里不能包含用户名或密码",
        ));
    }
    match u.scheme() {
        "https" => Ok(u),
        "http" if local => Ok(u),
        _ => Err(LlmError::new(
            "invalid_url",
            "只允许 https；http 仅限本机或局域网地址",
        )),
    }
}

// ---------- SSE ----------

#[derive(Debug, PartialEq)]
enum SseEvent {
    Data(String),
    Done,
}

/// 按字节缓冲，只在完整事件（空行结尾）处解码，避免 UTF-8 字符被网络分块切断
#[derive(Default)]
struct SseParser {
    buf: Vec<u8>,
}

impl SseParser {
    fn feed(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
        self.buf.extend(chunk.iter().filter(|&&b| b != b'\r'));
        let mut out = Vec::new();
        while let Some(pos) = self.buf.windows(2).position(|w| w == b"\n\n") {
            let raw: Vec<u8> = self.buf.drain(..pos + 2).collect();
            let text = String::from_utf8_lossy(&raw);
            let data: Vec<&str> = text
                .lines()
                .filter_map(|l| l.strip_prefix("data:"))
                .map(|d| d.strip_prefix(' ').unwrap_or(d))
                .collect();
            if data.is_empty() {
                continue;
            }
            let data = data.join("\n");
            out.push(if data == "[DONE]" {
                SseEvent::Done
            } else {
                SseEvent::Data(data)
            });
        }
        out
    }
}

// ---------- 请求 ----------

/// 消息 content：旧调用是字符串。数组是 text / image_url 片段，null 保留给带 tool_calls 的 assistant。
#[derive(Debug, Clone, PartialEq)]
pub enum MessageContent {
    Text(String),
    Parts(Vec<ContentPart>),
    Null,
}

impl Default for MessageContent {
    fn default() -> Self {
        Self::Null
    }
}

impl Serialize for MessageContent {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Text(text) => serializer.serialize_str(text),
            Self::Parts(parts) => parts.serialize(serializer),
            Self::Null => serializer.serialize_none(),
        }
    }
}

impl<'de> Deserialize<'de> for MessageContent {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        match value {
            serde_json::Value::Null => Ok(Self::Null),
            serde_json::Value::String(text) => Ok(Self::Text(text)),
            serde_json::Value::Array(items) => {
                serde_json::from_value(serde_json::Value::Array(items))
                    .map(Self::Parts)
                    .map_err(serde::de::Error::custom)
            }
            other => Err(serde::de::Error::custom(format!(
                "content 只能是字符串、数组或 null，收到 {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: ImageUrl },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImageUrl {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type", default = "function_kind")]
    pub kind: String,
    pub function: FunctionCall,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

fn function_kind() -> String {
    "function".to_string()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolDef {
    #[serde(rename = "type")]
    pub kind: String,
    pub function: FunctionDef,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FunctionDef {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameters: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FunctionName {
    pub name: String,
}

/// "auto" / "none" / "required"，或指定函数名。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ToolChoice {
    Mode(String),
    Function {
        #[serde(rename = "type")]
        kind: String,
        function: FunctionName,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    /// 缺省当成 null。旧消息都带字符串 content，序列化回去不会多出键。
    #[serde(default)]
    pub content: MessageContent,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChatReq {
    request_id: String,
    provider_id: String,
    model: String,
    messages: Vec<ChatMessage>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    #[serde(default)]
    json_mode: bool,
    /// 空数组不进上游请求体。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tools: Vec<ToolDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tool_choice: Option<ToolChoice>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type")]
pub enum LlmEvent {
    Delta { text: String },
    Usage { prompt: u64, completion: u64 },
    Done { finish_reason: Option<String> },
}

#[derive(Serialize)]
pub struct ChatResult {
    text: String,
    usage: Option<(u64, u64)>,
    finish_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tool_calls: Vec<ToolCall>,
}

/// 上游请求体。可选字段只在非空时追加到末尾，旧请求的键、顺序和值保持不变。
fn chat_body(req: &ChatReq) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": req.model, "messages": req.messages, "stream": true,
        "stream_options": { "include_usage": true },
    });
    if let Some(t) = req.temperature {
        body["temperature"] = t.into();
    }
    if let Some(m) = req.max_tokens {
        body["max_tokens"] = m.into();
    }
    if req.json_mode {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }
    if !req.tools.is_empty() {
        body["tools"] = serde_json::to_value(&req.tools).expect("tools 可序列化");
    }
    if let Some(choice) = &req.tool_choice {
        body["tool_choice"] = serde_json::to_value(choice).expect("tool_choice 可序列化");
    }
    body
}

const MAX_TOOL_CALLS: usize = 16;

#[derive(Default)]
struct ToolBuf {
    id: String,
    kind: String,
    name: String,
    arguments: String,
}

#[derive(Default)]
struct Accum {
    text: String,
    usage: Option<(u64, u64)>,
    finish_reason: Option<String>,
    tools: Vec<ToolBuf>,
}

#[derive(Debug)]
struct FeedEffect {
    delta: Option<String>,
    usage: Option<(u64, u64)>,
}

impl Accum {
    fn tool_calls(&self) -> Vec<ToolCall> {
        self.tools
            .iter()
            .filter(|b| !b.id.is_empty() || !b.name.is_empty() || !b.arguments.is_empty())
            .map(|b| ToolCall {
                id: b.id.clone(),
                kind: if b.kind.is_empty() {
                    function_kind()
                } else {
                    b.kind.clone()
                },
                function: FunctionCall {
                    name: b.name.clone(),
                    arguments: b.arguments.clone(),
                },
            })
            .collect()
    }
}

fn absorb_tool_deltas(tools: &mut Vec<ToolBuf>, deltas: &[serde_json::Value]) {
    for d in deltas {
        let index = d.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        if index >= MAX_TOOL_CALLS {
            continue;
        }
        if tools.len() <= index {
            tools.resize_with(index + 1, ToolBuf::default);
        }
        let slot = &mut tools[index];
        if let Some(id) = d
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            if slot.id.is_empty() {
                slot.id = id.to_string();
            }
        }
        if let Some(kind) = d
            .get("type")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            if slot.kind.is_empty() {
                slot.kind = kind.to_string();
            }
        }
        if let Some(name) = d
            .pointer("/function/name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            slot.name.push_str(name);
        }
        if let Some(args) = d.pointer("/function/arguments") {
            match args {
                serde_json::Value::String(s) => slot.arguments.push_str(s),
                other if !other.is_null() && slot.arguments.is_empty() => {
                    if let Ok(s) = serde_json::to_string(other) {
                        slot.arguments = s;
                    }
                }
                _ => {}
            }
        }
    }
}

fn feed_payload(acc: &mut Accum, data: &str) -> Result<FeedEffect, LlmError> {
    let v: serde_json::Value = serde_json::from_str(data)
        .map_err(|e| LlmError::new("server", format!("无法解析流数据: {e}")))?;
    if let Some(err) = v.get("error") {
        return Err(LlmError::new("server", err.to_string()));
    }
    let mut delta = None;
    if let Some(choice) = v.get("choices").and_then(|c| c.get(0)) {
        if let Some(t) = choice
            .pointer("/delta/content")
            .and_then(|c| c.as_str())
            .filter(|t| !t.is_empty())
        {
            acc.text.push_str(t);
            delta = Some(t.to_string());
        }
        if let Some(calls) = choice
            .pointer("/delta/tool_calls")
            .and_then(|c| c.as_array())
        {
            absorb_tool_deltas(&mut acc.tools, calls);
        }
        if let Some(f) = choice.get("finish_reason").and_then(|f| f.as_str()) {
            acc.finish_reason = Some(f.to_string());
        }
    }
    let usage = match (
        v.pointer("/usage/prompt_tokens").and_then(|x| x.as_u64()),
        v.pointer("/usage/completion_tokens")
            .and_then(|x| x.as_u64()),
    ) {
        (Some(p), Some(c)) => {
            acc.usage = Some((p, c));
            Some((p, c))
        }
        _ => None,
    };
    Ok(FeedEffect { delta, usage })
}

#[derive(Default)]
pub struct LlmState {
    inflight: Mutex<HashMap<String, AbortHandle>>,
}

/// 429/5xx 时的等待时间：优先用 Retry-After（秒，最多 20s），否则 1s、2s
fn backoff(attempt: u32, retry_after: Option<&str>) -> Duration {
    let hinted = retry_after
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map(|s| s.min(20));
    Duration::from_secs(hinted.unwrap_or(1 << attempt))
}

fn retryable(status: u16) -> bool {
    status == 429 || status >= 500
}

async fn send(req: &ChatReq, secret: &StoredSecret) -> Result<reqwest::Response, LlmError> {
    let base = check_base_url(&secret.base_url)?;
    let endpoint = format!("{}/chat/completions", base.as_str().trim_end_matches('/'));
    let body = chat_body(req);
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(90))
        .build()?;
    let mut attempt = 0;
    loop {
        let resp = client
            .post(&endpoint)
            .bearer_auth(&secret.api_key)
            .json(&body)
            .send()
            .await?;
        let status = resp.status().as_u16();
        if resp.status().is_success() {
            return Ok(resp);
        }
        if retryable(status) && attempt < MAX_RETRIES {
            let wait = backoff(
                attempt,
                resp.headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok()),
            );
            tokio::time::sleep(wait).await;
            attempt += 1;
            continue;
        }
        return Err(LlmError::from_status(
            status,
            resp.text().await.unwrap_or_default(),
        ));
    }
}

async fn run_chat(
    req: ChatReq,
    secret: StoredSecret,
    on_event: Channel<LlmEvent>,
) -> Result<ChatResult, LlmError> {
    let resp = send(&req, &secret).await?;
    let mut parser = SseParser::default();
    let mut stream = resp.bytes_stream();
    let mut acc = Accum::default();
    'outer: while let Some(chunk) = stream.next().await {
        for ev in parser.feed(&chunk?) {
            let data = match ev {
                SseEvent::Done => break 'outer,
                SseEvent::Data(d) => d,
            };
            let effect = feed_payload(&mut acc, &data)?;
            if let Some(t) = effect.delta {
                let _ = on_event.send(LlmEvent::Delta { text: t });
            }
            if let Some((p, c)) = effect.usage {
                let _ = on_event.send(LlmEvent::Usage {
                    prompt: p,
                    completion: c,
                });
            }
        }
    }
    let tool_calls = acc.tool_calls();
    let _ = on_event.send(LlmEvent::Done {
        finish_reason: acc.finish_reason.clone(),
    });
    Ok(ChatResult {
        text: acc.text,
        usage: acc.usage,
        finish_reason: acc.finish_reason,
        tool_calls,
    })
}

#[tauri::command]
pub async fn llm_chat(
    req: ChatReq,
    on_event: Channel<LlmEvent>,
    secrets: State<'_, SecretState>,
    state: State<'_, LlmState>,
) -> Result<ChatResult, LlmError> {
    let (secret, _) = secrets::load(&secrets, &req.provider_id)?;
    let id = req.request_id.clone();
    let (handle, reg) = AbortHandle::new_pair();
    state.inflight.lock().unwrap().insert(id.clone(), handle);
    // 取消时整个 future 被丢弃，HTTP 连接随之关闭
    let res = Abortable::new(run_chat(req, secret, on_event), reg).await;
    state.inflight.lock().unwrap().remove(&id);
    res.unwrap_or_else(|_| Err(LlmError::new("cancelled", "已取消")))
}

#[tauri::command]
pub fn llm_cancel(request_id: String, state: State<'_, LlmState>) {
    if let Some(h) = state.inflight.lock().unwrap().remove(&request_id) {
        h.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_split_across_chunks_and_utf8() {
        let mut p = SseParser::default();
        let full = "data: {\"a\":\"你好\"}\n\n: comment\n\ndata: [DONE]\n\n".as_bytes();
        let mut events = Vec::new();
        for b in full {
            events.extend(p.feed(std::slice::from_ref(b)));
        }
        assert_eq!(
            events,
            vec![SseEvent::Data("{\"a\":\"你好\"}".into()), SseEvent::Done]
        );
    }

    #[test]
    fn sse_crlf_and_multiple_events_per_chunk() {
        let mut p = SseParser::default();
        let ev = p.feed(b"data: 1\r\n\r\ndata: 2\r\n\r\ndata: 3");
        assert_eq!(
            ev,
            vec![SseEvent::Data("1".into()), SseEvent::Data("2".into())]
        );
        assert_eq!(p.feed(b"\n\n"), vec![SseEvent::Data("3".into())]);
    }

    #[test]
    fn url_rules() {
        for ok in [
            "https://api.deepseek.com",
            "http://localhost:11434/v1",
            "http://127.0.0.1:8080",
            "http://[::1]:1",
            "http://192.168.1.5/v1",
            "http://10.0.0.2",
            "http://172.20.0.1",
        ] {
            assert!(check_base_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "http://api.openai.com/v1",
            "http://8.8.8.8",
            "http://172.32.0.1",
            "ftp://localhost",
            "file:///etc/passwd",
            "https://user:pw@api.example.com",
            "not a url",
        ] {
            assert!(check_base_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn status_mapping() {
        assert_eq!(LlmError::from_status(401, String::new()).code, "auth");
        assert_eq!(LlmError::from_status(403, String::new()).code, "auth");
        assert_eq!(LlmError::from_status(429, String::new()).code, "rate_limit");
        assert_eq!(
            LlmError::from_status(422, String::new()).code,
            "bad_request"
        );
        assert_eq!(LlmError::from_status(503, String::new()).code, "server");
        assert_eq!(
            LlmError::from_status(500, "x".repeat(900)).message.len(),
            500
        );
    }

    #[test]
    fn retry_policy() {
        assert!(retryable(429) && retryable(500) && retryable(503));
        assert!(!retryable(400) && !retryable(401));
        assert_eq!(backoff(0, None), Duration::from_secs(1));
        assert_eq!(backoff(1, None), Duration::from_secs(2));
        assert_eq!(backoff(0, Some("5")), Duration::from_secs(5));
        assert_eq!(backoff(0, Some("3600")), Duration::from_secs(20));
        assert_eq!(
            backoff(1, Some("Wed, 21 Oct 2015 07:28:00 GMT")),
            Duration::from_secs(2)
        );
    }

    /// 改类型之前，send() 就是这样拼 body 的。messages 用原始 JSON Value，不经过新结构体。
    fn legacy_body(raw: &serde_json::Value) -> serde_json::Value {
        let mut body = serde_json::json!({
            "model": raw["model"],
            "messages": raw["messages"],
            "stream": true,
            "stream_options": { "include_usage": true },
        });
        if let Some(t) = raw.get("temperature").and_then(|v| v.as_f64()) {
            body["temperature"] = t.into();
        }
        if let Some(m) = raw.get("max_tokens").and_then(|v| v.as_u64()) {
            body["max_tokens"] = m.into();
        }
        if raw
            .get("json_mode")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            body["response_format"] = serde_json::json!({ "type": "json_object" });
        }
        body
    }

    fn assert_legacy_body(raw: &str) {
        let value: serde_json::Value = serde_json::from_str(raw).unwrap();
        let req: ChatReq = serde_json::from_str(raw).unwrap();
        let body = chat_body(&req);
        assert_eq!(
            serde_json::to_string(&body).unwrap(),
            serde_json::to_string(&legacy_body(&value)).unwrap()
        );
        assert!(body.get("tools").is_none());
        assert!(body.get("tool_choice").is_none());
    }

    #[test]
    fn old_request_json_is_unchanged() {
        assert_legacy_body(
            r#"{"request_id":"r1","provider_id":"deepseek","model":"deepseek-chat","messages":[{"role":"system","content":"规则"},{"role":"user","content":"画一个圆"}],"temperature":0.3,"json_mode":true}"#,
        );
        let with_json = chat_body(
            &serde_json::from_str(
                r#"{"request_id":"r1","provider_id":"deepseek","model":"deepseek-chat","messages":[{"role":"system","content":"规则"},{"role":"user","content":"画一个圆"}],"temperature":0.3,"json_mode":true}"#,
            )
            .unwrap(),
        );
        // serde_json 默认按键名排序。这就是改动前 json! 拼出来的字节。
        assert_eq!(
            serde_json::to_string(&with_json).unwrap(),
            r#"{"messages":[{"content":"规则","role":"system"},{"content":"画一个圆","role":"user"}],"model":"deepseek-chat","response_format":{"type":"json_object"},"stream":true,"stream_options":{"include_usage":true},"temperature":0.3}"#
        );

        assert_legacy_body(
            r#"{"request_id":"r2","provider_id":"ollama","model":"m","messages":[{"role":"user","content":"hi"}],"max_tokens":128,"json_mode":false}"#,
        );
        let no_json = chat_body(
            &serde_json::from_str(
                r#"{"request_id":"r2","provider_id":"ollama","model":"m","messages":[{"role":"user","content":"hi"}],"max_tokens":128,"json_mode":false}"#,
            )
            .unwrap(),
        );
        assert_eq!(
            serde_json::to_string(&no_json).unwrap(),
            r#"{"max_tokens":128,"messages":[{"content":"hi","role":"user"}],"model":"m","stream":true,"stream_options":{"include_usage":true}}"#
        );
        assert!(no_json.get("response_format").is_none());

        // 缺省 json_mode / tools / tool_choice：和没这些字段时一样
        assert_legacy_body(r#"{"request_id":"r3","provider_id":"p","model":"m","messages":[]}"#);
        let bare = chat_body(
            &serde_json::from_str(
                r#"{"request_id":"r3","provider_id":"p","model":"m","messages":[]}"#,
            )
            .unwrap(),
        );
        assert_eq!(
            serde_json::to_string(&bare).unwrap(),
            r#"{"messages":[],"model":"m","stream":true,"stream_options":{"include_usage":true}}"#
        );

        // 显式空 tools 也不写进 body
        assert_legacy_body(
            r#"{"request_id":"r4","provider_id":"p","model":"m","messages":[{"role":"user","content":"hi"}],"tools":[],"tool_choice":null}"#,
        );
    }

    #[test]
    fn new_request_carries_tools_images_and_tool_messages() {
        let raw = r#"{
            "request_id": "r",
            "provider_id": "p",
            "model": "vision",
            "json_mode": false,
            "tool_choice": "auto",
            "tools": [{
                "type": "function",
                "function": {
                    "name": "echo",
                    "description": "回声",
                    "parameters": {"type": "object", "properties": {"text": {"type": "string"}}}
                }
            }],
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "看图"},
                        {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBORw0KGgo="}}
                    ]
                },
                {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "echo", "arguments": "{\"text\":\"hi\"}"}
                    }]
                },
                {"role": "tool", "tool_call_id": "call_1", "content": "hi"}
            ]
        }"#;
        let req: ChatReq = serde_json::from_str(raw).unwrap();
        let body = chat_body(&req);
        assert!(
            body.get("response_format").is_none(),
            "agent 路径不强制 json_object"
        );
        assert_eq!(body["tool_choice"], "auto");
        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(body["tools"][0]["function"]["name"], "echo");
        assert_eq!(body["tools"][0]["function"]["parameters"]["type"], "object");
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages[0]["content"][0]["type"], "text");
        assert_eq!(messages[0]["content"][1]["type"], "image_url");
        assert_eq!(
            messages[0]["content"][1]["image_url"]["url"],
            "data:image/png;base64,iVBORw0KGgo="
        );
        assert!(messages[0].get("tool_calls").is_none());
        assert!(messages[1]["content"].is_null());
        assert_eq!(messages[1]["tool_calls"][0]["id"], "call_1");
        assert_eq!(messages[1]["tool_calls"][0]["type"], "function");
        assert_eq!(
            messages[1]["tool_calls"][0]["function"]["arguments"],
            r#"{"text":"hi"}"#
        );
        assert_eq!(messages[2]["role"], "tool");
        assert_eq!(messages[2]["tool_call_id"], "call_1");
        assert_eq!(messages[2]["content"], "hi");
        assert!(messages[2].get("tool_calls").is_none());

        let named: ChatReq = serde_json::from_str(
            r#"{"request_id":"r","provider_id":"p","model":"m","messages":[],"tool_choice":{"type":"function","function":{"name":"echo"}}}"#,
        )
        .unwrap();
        assert_eq!(chat_body(&named)["tool_choice"]["function"]["name"], "echo");
    }

    #[test]
    fn text_stream_parsing_unchanged() {
        let mut acc = Accum::default();
        let effect = feed_payload(&mut acc, r#"{"choices":[{"delta":{"content":"你"}}]}"#).unwrap();
        assert_eq!(effect.delta.as_deref(), Some("你"));
        let empty = feed_payload(&mut acc, r#"{"choices":[{"delta":{"content":""}}]}"#).unwrap();
        assert!(empty.delta.is_none());
        let done = feed_payload(
            &mut acc,
            r#"{"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}"#,
        )
        .unwrap();
        assert_eq!(done.usage, Some((3, 1)));
        assert_eq!(acc.text, "你好");
        assert_eq!(acc.finish_reason.as_deref(), Some("stop"));
        assert!(acc.tool_calls().is_empty());
        let err =
            feed_payload(&mut Accum::default(), r#"{"error":{"message":"nope"}}"#).unwrap_err();
        assert_eq!(err.code, "server");
    }

    #[test]
    fn tool_call_deltas_are_concatenated() {
        let mut acc = Accum::default();
        for chunk in [
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"echo","arguments":""}},{"index":1,"id":"call_2","type":"function","function":{"name":"ec","arguments":""}}]}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"text\":"}},{"index":1,"function":{"name":"ho","arguments":"{\"text\":\"b"}}]}}]}"#,
            r#"{"choices":[{"delta":{"content":null,"tool_calls":[{"index":0,"function":{"arguments":"\"hi\"}"}},{"index":1,"function":{"arguments":"\"}"}}]},"finish_reason":null}]}"#,
            r#"{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#,
        ] {
            feed_payload(&mut acc, chunk).unwrap();
        }
        let calls = acc.tool_calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].id, "call_1");
        assert_eq!(calls[0].kind, "function");
        assert_eq!(calls[0].function.name, "echo");
        assert_eq!(calls[0].function.arguments, r#"{"text":"hi"}"#);
        assert_eq!(calls[1].id, "call_2");
        assert_eq!(calls[1].function.name, "echo");
        assert_eq!(calls[1].function.arguments, r#"{"text":"b"}"#);
        assert_eq!(acc.finish_reason.as_deref(), Some("tool_calls"));
        assert!(acc.text.is_empty());
        let json = serde_json::to_string(&calls).unwrap();
        assert!(json.contains(r#""type":"function""#));
        assert!(!json.contains("kind"));

        // 没有工具调用时，响应里不出现 tool_calls
        let bare = serde_json::to_value(ChatResult {
            text: "x".into(),
            usage: None,
            finish_reason: Some("stop".into()),
            tool_calls: vec![],
        })
        .unwrap();
        assert!(bare.get("tool_calls").is_none());
        assert_eq!(bare["text"], "x");
        assert_eq!(bare["finish_reason"], "stop");
    }
}
