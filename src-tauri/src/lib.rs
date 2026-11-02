mod llm;
mod preview_protocol;
mod secrets;

/// 仅 debug 构建：AWB_SELFTEST=1 时前端自动跑一遍真实环境自检，并通过它打印结果后退出
#[cfg(debug_assertions)]
#[tauri::command]
fn selftest_report(report: String, app: tauri::AppHandle) {
    println!("[SELFTEST] {report}");
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        // 必须在 fs 之后注册：记住用户通过对话框授权过的项目目录
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .manage(secrets::SecretState::default())
        .manage(llm::LlmState::default())
        .register_asynchronous_uri_scheme_protocol(preview_protocol::SCHEME, |_ctx, req, responder| {
            responder.respond(preview_protocol::respond(req.uri().path()));
        });

    #[cfg(debug_assertions)]
    let builder = builder
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) && std::env::var_os("AWB_SELFTEST").is_some() {
                let _ = webview.eval("window.__AWB_SELFTEST__ = true; window.dispatchEvent(new Event('awb-selftest'));");
            }
        })
        .invoke_handler(tauri::generate_handler![
            secrets::secret_set,
            secrets::secret_status,
            secrets::secret_remove,
            llm::llm_chat,
            llm::llm_cancel,
            selftest_report
        ]);

    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        secrets::secret_set,
        secrets::secret_status,
        secrets::secret_remove,
        llm::llm_chat,
        llm::llm_cancel
    ]);

    builder.run(tauri::generate_context!()).expect("error while running tauri application");
}
