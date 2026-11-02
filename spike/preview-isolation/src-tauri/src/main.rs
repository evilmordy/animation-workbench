use tauri::http::{header, Response, StatusCode};

const PREVIEW_CSP: &str = "default-src 'none'; script-src awpreview: http://awpreview.localhost 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";

/// 探针目标：除宿主的对照调用（source=host-control）外，任何调用都说明隔离失败。
#[tauri::command]
fn sec_canary(source: Option<String>, webview: tauri::Webview) {
    eprintln!("[CANARY] source={source:?} webview_url={:?}", webview.url());
}

#[tauri::command]
fn probe_report(report: String, app: tauri::AppHandle) {
    println!("[REPORT] {report}");
    app.exit(0);
}

fn preview_asset(path: &str) -> Option<(Vec<u8>, &'static str)> {
    // T0.2 的运行时直接从 spike/runtime 读，改完重新 pnpm build 即可
    let runtime_file = |rel: &str| std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../runtime/").to_owned() + rel).ok();
    match path {
        "/index.html" => Some((include_bytes!("../../preview/index.html").to_vec(), "text/html; charset=utf-8")),
        "/probe.js" => Some((include_bytes!("../../preview/probe.js").to_vec(), "text/javascript; charset=utf-8")),
        "/runtime.html" => Some((runtime_file("harness/index.html")?, "text/html; charset=utf-8")),
        "/runtime.js" => Some((runtime_file("dist-runtime/runtime.js")?, "text/javascript; charset=utf-8")),
        "/harness.js" => Some((runtime_file("harness/harness.js")?, "text/javascript; charset=utf-8")),
        _ => None,
    }
}

fn main() {
    // AWB_SPIKE_PAGE=runtime.html 时跑 T0.2/T0.4，默认跑 T0.1 探针
    let page = std::env::var("AWB_SPIKE_PAGE").unwrap_or_else(|_| "index.html".into());
    tauri::Builder::default()
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App(page.clone().into()))
                .title("AWB spike")
                .inner_size(1000.0, 700.0)
                .build()?;
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("awpreview", |_ctx, req, responder| {
            eprintln!("[AWPREVIEW] {}", req.uri());
            let res = match preview_asset(req.uri().path()) {
                Some((body, mime)) => Response::builder()
                    .header(header::CONTENT_TYPE, mime)
                    .header("Content-Security-Policy", PREVIEW_CSP)
                    .body(body),
                None => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()),
            };
            responder.respond(res.expect("valid response"));
        })
        .invoke_handler(tauri::generate_handler![sec_canary, probe_report])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
