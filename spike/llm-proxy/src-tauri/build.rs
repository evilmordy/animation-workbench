fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "secret_set", "secret_status", "secret_remove", "llm_chat", "llm_cancel", "probe_report",
        ]),
    ))
    .expect("failed to run tauri-build");
}
