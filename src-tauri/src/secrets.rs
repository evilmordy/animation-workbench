//! API Key 存在系统钥匙串里，并和 Base URL 绑定（PLAN §3.3、SEC-03、SEC-05）。
//! 没有可用钥匙串时退回进程内存，只在本次运行有效。

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::llm::{check_base_url, LlmError};

const SERVICE: &str = "dev.animationworkbench.app";

#[derive(Serialize, Deserialize, Clone)]
pub struct StoredSecret {
    pub base_url: String,
    pub api_key: String,
}

#[derive(Default)]
pub struct SecretState {
    memory: Mutex<HashMap<String, StoredSecret>>,
}

fn keyring_available() -> bool {
    keyring::Entry::store_status().is_ok()
}

fn entry(provider_id: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(SERVICE, provider_id).ok()
}

pub fn load(state: &SecretState, provider_id: &str) -> Result<(StoredSecret, &'static str), LlmError> {
    if let Some(s) = state.memory.lock().unwrap().get(provider_id) {
        return Ok((s.clone(), "memory"));
    }
    let e = entry(provider_id).ok_or_else(|| LlmError::new("no_key", "未配置 Key"))?;
    let json = match e.get_password() {
        Ok(j) => j,
        Err(keyring::Error::NoEntry) => return Err(LlmError::new("no_key", "未配置 Key")),
        Err(e) => return Err(LlmError::new("keyring", e.to_string())),
    };
    let s = serde_json::from_str(&json).map_err(|e| LlmError::new("keyring", e.to_string()))?;
    Ok((s, "keychain"))
}

#[tauri::command]
pub async fn secret_set(
    provider_id: String,
    base_url: String,
    api_key: String,
    state: State<'_, SecretState>,
) -> Result<&'static str, LlmError> {
    check_base_url(&base_url)?;
    if api_key.trim().is_empty() {
        return Err(LlmError::new("bad_request", "Key 不能为空"));
    }
    let secret = StoredSecret { base_url, api_key: api_key.trim().to_string() };
    let json = serde_json::to_string(&secret).expect("serializable");
    let pid = provider_id.clone();
    // 钥匙串是同步 API（Linux 上走 D-Bus），放到阻塞线程池里，避免卡住 IPC
    let stored = tauri::async_runtime::spawn_blocking(move || entry(&pid).is_some_and(|e| e.set_password(&json).is_ok()))
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
pub struct SecretStatus {
    exists: bool,
    base_url: Option<String>,
    last4: Option<String>,
    backend: &'static str,
}

#[tauri::command]
pub async fn secret_status(provider_id: String, state: State<'_, SecretState>) -> Result<SecretStatus, LlmError> {
    let fallback = if keyring_available() { "keychain" } else { "memory" };
    match load(&state, &provider_id) {
        Ok((s, backend)) => {
            let chars: Vec<char> = s.api_key.chars().collect();
            let last4: String = chars[chars.len().saturating_sub(4)..].iter().collect();
            Ok(SecretStatus { exists: true, base_url: Some(s.base_url), last4: Some(last4), backend })
        }
        Err(e) if e.code == "no_key" || e.code == "keyring" => {
            Ok(SecretStatus { exists: false, base_url: None, last4: None, backend: fallback })
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn secret_remove(provider_id: String, state: State<'_, SecretState>) -> Result<(), LlmError> {
    state.memory.lock().unwrap().remove(&provider_id);
    if let Some(e) = entry(&provider_id) {
        match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) | Err(keyring::Error::NoDefaultStore) => {}
            Err(e) => return Err(LlmError::new("keyring", e.to_string())),
        }
    }
    Ok(())
}
