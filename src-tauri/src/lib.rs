mod preview_protocol;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        // 必须在 fs 之后注册：记住用户通过对话框授权过的项目目录
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol(preview_protocol::SCHEME, |_ctx, req, responder| {
            responder.respond(preview_protocol::respond(req.uri().path()));
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
