//! awpreview:// 自定义协议（PLAN §3.4）：只提供预览页和运行时两个文件，响应头带严格 CSP。

use tauri::http::{header, Response, StatusCode};

pub const SCHEME: &str = "awpreview";

pub const PREVIEW_CSP: &str = "default-src 'none'; script-src awpreview: http://awpreview.localhost 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";

#[cfg(not(debug_assertions))]
fn asset(name: &str) -> Option<Vec<u8>> {
    match name {
        "index.html" => Some(include_bytes!("../../dist-runtime/index.html").to_vec()),
        "runtime.js" => Some(include_bytes!("../../dist-runtime/runtime.js").to_vec()),
        _ => None,
    }
}

/// debug 构建直接读 dist-runtime/，改完运行时只需 pnpm build:runtime 再刷新预览
#[cfg(debug_assertions)]
fn asset(name: &str) -> Option<Vec<u8>> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist-runtime");
    std::fs::read(dir.join(name)).ok()
}

fn mime(name: &str) -> &'static str {
    if name.ends_with(".html") {
        "text/html; charset=utf-8"
    } else {
        "text/javascript; charset=utf-8"
    }
}

/// 白名单之外（包括路径穿越）一律 404
pub fn respond(path: &str) -> Response<Vec<u8>> {
    let name = path.trim_start_matches('/');
    let body = match name {
        "index.html" | "runtime.js" => asset(name),
        _ => None,
    };
    match body {
        Some(body) => Response::builder()
            .header(header::CONTENT_TYPE, mime(name))
            .header("Content-Security-Policy", PREVIEW_CSP)
            .header("X-Content-Type-Options", "nosniff")
            // sandbox iframe 的源是 null，加载 ES 模块脚本需要 CORS；内容是公开的静态文件
            .header("Access-Control-Allow-Origin", "*")
            .body(body),
        None => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()),
    }
    .expect("valid response")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_whitelist_with_csp() {
        for p in ["/index.html", "/runtime.js"] {
            let r = respond(p);
            assert_eq!(r.status(), StatusCode::OK, "{p}（需要先 pnpm build:runtime）");
            assert_eq!(r.headers()["Content-Security-Policy"], PREVIEW_CSP);
        }
    }

    #[test]
    fn rejects_everything_else() {
        for p in ["/", "/esm-B2OacygB.js", "/../package.json", "/%2e%2e/Cargo.toml", "/index.html/..", "/RUNTIME.JS"] {
            assert_eq!(respond(p).status(), StatusCode::NOT_FOUND, "{p}");
        }
    }
}
