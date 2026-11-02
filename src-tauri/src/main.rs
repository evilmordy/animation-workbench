// release 版在 Windows 上不弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK 的 DMA-BUF 渲染器在部分 NVIDIA 驱动下会白屏；用户没有显式设置时默认关闭
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    animation_workbench_lib::run()
}
