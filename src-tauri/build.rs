fn main() {
    // 应用命令必须在这里登记，未登记的命令前端无法调用（PLAN §3.3）
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "secret_set",
            "secret_status",
            "secret_remove",
            "llm_chat",
            "llm_cancel",
            "selftest_report",
        ])),
    )
    .expect("failed to run tauri-build");
}
