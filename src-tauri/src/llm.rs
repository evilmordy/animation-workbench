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
        Self { code, message: message.into(), status: None }
    }

    fn from_status(status: u16, body: String) -> Self {
        let code = match status {
            401 | 403 => "auth",
            429 => "rate_limit",
            400..=499 => "bad_request",
            _ => "server",
        };
        Self { code, message: body.chars().take(500).collect(), status: Some(status) }
    }
}

impl From<reqwest::Error> for LlmError {
    fn from(e: reqwest::Error) -> Self {
        // without_url：错误文本里不出现请求地址；请求头（含 Authorization）本来就不会进错误信息
        let e = e.without_url();
        Self::new(if e.is_timeout() { "timeout" } else { "network" }, e.to_string())
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
        return Err(LlmError::new("invalid_url", "Base URL 里不能包含用户名或密码"));
    }
    match u.scheme() {
        "https" => Ok(u),
        "http" if local => Ok(u),
        _ => Err(LlmError::new("invalid_url", "只允许 https；http 仅限本机或局域网地址")),
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
            out.push(if data == "[DONE]" { SseEvent::Done } else { SseEvent::Data(data) });
        }
        out
    }
}

// ---------- 请求 ----------

#[derive(Deserialize)]
pub struct ChatReq {
    request_id: String,
    provider_id: String,
    model: String,
    messages: Vec<serde_json::Value>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    #[serde(default)]
    json_mode: bool,
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
}

#[derive(Default)]
pub struct LlmState {
    inflight: Mutex<HashMap<String, AbortHandle>>,
}

/// 429/5xx 时的等待时间：优先用 Retry-After（秒，最多 20s），否则 1s、2s
fn backoff(attempt: u32, retry_after: Option<&str>) -> Duration {
    let hinted = retry_after.and_then(|v| v.trim().parse::<u64>().ok()).map(|s| s.min(20));
    Duration::from_secs(hinted.unwrap_or(1 << attempt))
}

fn retryable(status: u16) -> bool {
    status == 429 || status >= 500
}

async fn send(req: &ChatReq, secret: &StoredSecret) -> Result<reqwest::Response, LlmError> {
    let base = check_base_url(&secret.base_url)?;
    let endpoint = format!("{}/chat/completions", base.as_str().trim_end_matches('/'));
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
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(90))
        .build()?;
    let mut attempt = 0;
    loop {
        let resp = client.post(&endpoint).bearer_auth(&secret.api_key).json(&body).send().await?;
        let status = resp.status().as_u16();
        if resp.status().is_success() {
            return Ok(resp);
        }
        if retryable(status) && attempt < MAX_RETRIES {
            let wait = backoff(attempt, resp.headers().get("retry-after").and_then(|v| v.to_str().ok()));
            tokio::time::sleep(wait).await;
            attempt += 1;
            continue;
        }
        return Err(LlmError::from_status(status, resp.text().await.unwrap_or_default()));
    }
}

async fn run_chat(req: ChatReq, secret: StoredSecret, on_event: Channel<LlmEvent>) -> Result<ChatResult, LlmError> {
    let resp = send(&req, &secret).await?;
    let mut parser = SseParser::default();
    let mut stream = resp.bytes_stream();
    let (mut text, mut usage, mut finish_reason) = (String::new(), None, None);
    'outer: while let Some(chunk) = stream.next().await {
        for ev in parser.feed(&chunk?) {
            let data = match ev {
                SseEvent::Done => break 'outer,
                SseEvent::Data(d) => d,
            };
            let v: serde_json::Value =
                serde_json::from_str(&data).map_err(|e| LlmError::new("server", format!("无法解析流数据: {e}")))?;
            if let Some(err) = v.get("error") {
                return Err(LlmError::new("server", err.to_string()));
            }
            if let Some(choice) = v["choices"].get(0) {
                if let Some(t) = choice["delta"]["content"].as_str().filter(|t| !t.is_empty()) {
                    text.push_str(t);
                    let _ = on_event.send(LlmEvent::Delta { text: t.to_string() });
                }
                if let Some(f) = choice["finish_reason"].as_str() {
                    finish_reason = Some(f.to_string());
                }
            }
            if let (Some(p), Some(c)) = (v["usage"]["prompt_tokens"].as_u64(), v["usage"]["completion_tokens"].as_u64()) {
                usage = Some((p, c));
                let _ = on_event.send(LlmEvent::Usage { prompt: p, completion: c });
            }
        }
    }
    let _ = on_event.send(LlmEvent::Done { finish_reason: finish_reason.clone() });
    Ok(ChatResult { text, usage, finish_reason })
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
        assert_eq!(events, vec![SseEvent::Data("{\"a\":\"你好\"}".into()), SseEvent::Done]);
    }

    #[test]
    fn sse_crlf_and_multiple_events_per_chunk() {
        let mut p = SseParser::default();
        let ev = p.feed(b"data: 1\r\n\r\ndata: 2\r\n\r\ndata: 3");
        assert_eq!(ev, vec![SseEvent::Data("1".into()), SseEvent::Data("2".into())]);
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
        assert_eq!(LlmError::from_status(422, String::new()).code, "bad_request");
        assert_eq!(LlmError::from_status(503, String::new()).code, "server");
        assert_eq!(LlmError::from_status(500, "x".repeat(900)).message.len(), 500);
    }

    #[test]
    fn retry_policy() {
        assert!(retryable(429) && retryable(500) && retryable(503));
        assert!(!retryable(400) && !retryable(401));
        assert_eq!(backoff(0, None), Duration::from_secs(1));
        assert_eq!(backoff(1, None), Duration::from_secs(2));
        assert_eq!(backoff(0, Some("5")), Duration::from_secs(5));
        assert_eq!(backoff(0, Some("3600")), Duration::from_secs(20));
        assert_eq!(backoff(1, Some("Wed, 21 Oct 2015 07:28:00 GMT")), Duration::from_secs(2));
    }
}
