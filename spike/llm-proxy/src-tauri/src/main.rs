use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::Duration;

use futures_util::future::{AbortHandle, Abortable};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

const SERVICE: &str = "dev.awb.spike.llm";

// ---------- SSE ----------

#[derive(Debug, PartialEq)]
enum SseEvent {
    Data(String),
    Done,
}

/// 按字节缓冲，只在完整事件（空行结尾）处解码，避免 UTF-8 字符被网络分块切断。
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

// ---------- URL 规则 ----------

fn check_base_url(raw: &str) -> Result<url::Url, LlmError> {
    let u = url::Url::parse(raw).map_err(|e| LlmError::new("invalid_url", e.to_string()))?;
    let local = match u.host() {
        Some(url::Host::Domain(d)) => d == "localhost",
        Some(url::Host::Ipv4(ip)) => ip.is_loopback() || ip.is_private(),
        Some(url::Host::Ipv6(ip)) => IpAddr::V6(ip).is_loopback(),
        None => false,
    };
    match u.scheme() {
        "https" => Ok(u),
        "http" if local => Ok(u),
        _ => Err(LlmError::new("invalid_url", "只允许 https；http 仅限本机或局域网地址")),
    }
}

// ---------- 错误 ----------

#[derive(Debug, Serialize)]
struct LlmError {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
}

impl LlmError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
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
        // without_url：错误文本里不带请求地址
        let e = e.without_url();
        let code = if e.is_timeout() { "timeout" } else { "network" };
        Self::new(code, e.to_string())
    }
}

// ---------- 密钥 ----------

#[derive(Serialize, Deserialize, Clone)]
struct StoredSecret {
    base_url: String,
    api_key: String,
}

#[derive(Default)]
struct AppState {
    memory: Mutex<HashMap<String, StoredSecret>>,
    inflight: Mutex<HashMap<String, AbortHandle>>,
}

fn keyring_entry(provider_id: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(SERVICE, provider_id).ok()
}

fn load_secret(state: &AppState, provider_id: &str) -> Result<(StoredSecret, &'static str), LlmError> {
    if let Some(s) = state.memory.lock().unwrap().get(provider_id) {
        return Ok((s.clone(), "memory"));
    }
    let entry = keyring_entry(provider_id).ok_or_else(|| LlmError::new("no_key", "未配置 Key"))?;
    let json = match entry.get_password() {
        Ok(j) => j,
        Err(keyring::Error::NoEntry) => return Err(LlmError::new("no_key", "未配置 Key")),
        Err(e) => return Err(LlmError::new("keyring", e.to_string())),
    };
    let s = serde_json::from_str(&json).map_err(|e| LlmError::new("keyring", e.to_string()))?;
    Ok((s, "keychain"))
}

#[tauri::command]
async fn secret_set(
    provider_id: String,
    base_url: String,
    api_key: String,
    state: State<'_, AppState>,
) -> Result<&'static str, LlmError> {
    check_base_url(&base_url)?;
    let secret = StoredSecret { base_url, api_key };
    let json = serde_json::to_string(&secret).unwrap();
    let pid = provider_id.clone();
    let stored = tauri::async_runtime::spawn_blocking(move || {
        keyring_entry(&pid).map(|e| e.set_password(&json)).is_some_and(|r| r.is_ok())
    })
    .await
    .unwrap_or(false);
    let mut mem = state.memory.lock().unwrap();
    if stored {
        mem.remove(&provider_id);
        Ok("keychain")
    } else {
        mem.insert(provider_id, secret);
        Ok("memory")
    }
}

#[derive(Serialize)]
struct SecretStatus {
    exists: bool,
    base_url: Option<String>,
    last4: Option<String>,
    backend: &'static str,
}

#[tauri::command]
async fn secret_status(provider_id: String, state: State<'_, AppState>) -> Result<SecretStatus, LlmError> {
    match load_secret(&state, &provider_id) {
        Ok((s, backend)) => {
            let last4: String = s.api_key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
            Ok(SecretStatus { exists: true, base_url: Some(s.base_url), last4: Some(last4), backend })
        }
        Err(e) if e.code == "no_key" => Ok(SecretStatus { exists: false, base_url: None, last4: None, backend: "keychain" }),
        Err(e) => Err(e),
    }
}

#[tauri::command]
async fn secret_remove(provider_id: String, state: State<'_, AppState>) -> Result<(), LlmError> {
    state.memory.lock().unwrap().remove(&provider_id);
    if let Some(e) = keyring_entry(&provider_id) {
        match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(LlmError::new("keyring", e.to_string())),
        }
    }
    Ok(())
}

// ---------- LLM ----------

#[derive(Deserialize)]
struct ChatReq {
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
enum LlmEvent {
    Delta { text: String },
    Usage { prompt: u64, completion: u64 },
    Done { finish_reason: Option<String> },
}

#[derive(Serialize)]
struct ChatResult {
    text: String,
    usage: Option<(u64, u64)>,
    finish_reason: Option<String>,
}

async fn run_chat(req: ChatReq, secret: StoredSecret, on_event: Channel<LlmEvent>) -> Result<ChatResult, LlmError> {
    let base = check_base_url(&secret.base_url)?;
    let endpoint = format!("{}/chat/completions", base.as_str().trim_end_matches('/'));
    let mut body = serde_json::json!({
        "model": req.model, "messages": req.messages, "stream": true,
        "stream_options": { "include_usage": true },
    });
    if let Some(t) = req.temperature { body["temperature"] = t.into(); }
    if let Some(m) = req.max_tokens { body["max_tokens"] = m.into(); }
    if req.json_mode { body["response_format"] = serde_json::json!({ "type": "json_object" }); }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .build()?;
    let resp = client.post(endpoint).bearer_auth(&secret.api_key).json(&body).send().await?;
    let status = resp.status();
    if !status.is_success() {
        return Err(LlmError::from_status(status.as_u16(), resp.text().await.unwrap_or_default()));
    }

    let mut parser = SseParser::default();
    let mut stream = resp.bytes_stream();
    let (mut text, mut usage, mut finish_reason) = (String::new(), None, None);
    'outer: while let Some(chunk) = stream.next().await {
        for ev in parser.feed(&chunk?) {
            let data = match ev {
                SseEvent::Done => break 'outer,
                SseEvent::Data(d) => d,
            };
            let v: serde_json::Value = serde_json::from_str(&data)
                .map_err(|e| LlmError::new("server", format!("无法解析流数据: {e}")))?;
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
async fn llm_chat(req: ChatReq, on_event: Channel<LlmEvent>, state: State<'_, AppState>) -> Result<ChatResult, LlmError> {
    let (secret, _) = load_secret(&state, &req.provider_id)?;
    let id = req.request_id.clone();
    let (handle, reg) = AbortHandle::new_pair();
    state.inflight.lock().unwrap().insert(id.clone(), handle);
    let res = Abortable::new(run_chat(req, secret, on_event), reg).await;
    state.inflight.lock().unwrap().remove(&id);
    res.unwrap_or_else(|_| Err(LlmError::new("cancelled", "已取消")))
}

#[tauri::command]
fn llm_cancel(request_id: String, state: State<'_, AppState>) {
    if let Some(h) = state.inflight.lock().unwrap().remove(&request_id) {
        h.abort();
    }
}

#[tauri::command]
fn probe_report(report: String, app: tauri::AppHandle) {
    println!("[REPORT] {report}");
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            secret_set, secret_status, secret_remove, llm_chat, llm_cancel, probe_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_split_across_chunks_and_utf8() {
        let mut p = SseParser::default();
        let full = "data: {\"a\":\"你好\"}\n\n: comment\n\ndata: [DONE]\n\n".as_bytes();
        let mut events = Vec::new();
        // 逐字节喂入，必然切断多字节字符和事件边界
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
        for ok in ["https://api.deepseek.com", "http://localhost:11434/v1", "http://127.0.0.1:8080", "http://[::1]:1", "http://192.168.1.5/v1", "http://10.0.0.2"] {
            assert!(check_base_url(ok).is_ok(), "{ok}");
        }
        for bad in ["http://api.openai.com/v1", "http://8.8.8.8", "ftp://localhost", "file:///etc/passwd", "not a url"] {
            assert!(check_base_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn status_mapping() {
        assert_eq!(LlmError::from_status(401, String::new()).code, "auth");
        assert_eq!(LlmError::from_status(429, String::new()).code, "rate_limit");
        assert_eq!(LlmError::from_status(422, String::new()).code, "bad_request");
        assert_eq!(LlmError::from_status(503, String::new()).code, "server");
    }
}
