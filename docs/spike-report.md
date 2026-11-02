# M0 技术验证报告

## T0.1 预览隔离验证

**结论**：Linux 已通过；Windows 和 macOS 尚未验证（本机只有 Linux）。D1 状态：Linux 通过，Win/macOS 待验证（挂起）。有一项已知风险 R1，见下文。

### 环境

| 项 | 版本 |
|----|------|
| 系统 | Linux 7.0.0，X11 |
| WebKitGTK | 2.52.6 |
| tauri / wry | 2.12.5 / 0.57.1 |
| Rust | 1.95.0 |

### 搭建方式（`spike/preview-isolation/`）

- `src-tauri/`：最小 Tauri 应用。用 `register_asynchronous_uri_scheme_protocol("awpreview")` 只提供 `index.html` 和 `probe.js`，响应头带 §3.4 的预览 CSP；主窗口 CSP 与 §3.4 一致；`build.rs` 用 `AppManifest::commands` 限定命令，capability 只给 `main` 窗口。
- `sec_canary` 命令：被调用时向 stderr 打印 `[CANARY] source=...`。宿主先用 `source=host-control` 调一次作为正对照，证明记录机制有效；之后出现任何其他 `source` 都算失败。
- `ui/`：宿主页，用 `<iframe sandbox="allow-scripts" src=convertFileSrc('index.html','awpreview')>` 加载探针，只接受 `event.source === iframe.contentWindow` 的消息，收齐结果后通过 `probe_report` 打印并退出。
- `preview/probe.js`：在 iframe 里依次执行全部探针，最后把 iframe 自身导航到测试服务器。
- `test_server.py`：监听 `127.0.0.1:8765`，打印收到的每个请求（返回 `Access-Control-Allow-Origin: *`，尽量让攻击成功）。
- 同一个应用设置 `AWB_SPIKE_PAGE=runtime.html` 时改跑 T0.2/T0.4：awpreview 额外提供 `spike/runtime/` 下的 `runtime.html`、`runtime.js`、`harness.js`（debug 构建从磁盘读取）。

复现：

```bash
cd spike/preview-isolation
python3 test_server.py &                       # 先 curl 一下确认服务器可达
cargo build --manifest-path src-tauri/Cargo.toml
./src-tauri/target/debug/awb-spike-preview     # 约 5 秒后自动退出
```

### Linux 结果

canary 日志里只有 `host-control`；测试服务器在探针期间收到 **0** 个请求。

| 探针 | iframe 内观察到的 | 结果 |
|------|------------------|------|
| `eval`（正对照，运行时需要） | 返回 2 | 按预期可用 |
| `self.origin` | `null`（不透明源） | — |
| `window.__TAURI_INTERNALS__` | `undefined` | 未注入 |
| `parent.__TAURI_INTERNALS__` | `SecurityError`（沙箱跨源） | 拦截 |
| `window.ipc.postMessage`（Windows 路径） | `undefined` | 不存在 |
| `window.webkit.messageHandlers.ipc.postMessage` | **可访问，消息已发出** | 被 invoke key 拦截，见下文 |
| `window.chrome.webview.postMessage` | `undefined` | 不存在 |
| `fetch ipc://localhost/sec_canary` | `TypeError: Load failed` | CSP 拦截 |
| `fetch http://ipc.localhost/sec_canary` | `TypeError: Load failed` | CSP 拦截 |
| `fetch` 到测试服务器 | `Load failed` | 拦截 |
| XHR | `onerror` | 拦截 |
| WebSocket | `SecurityError` | 拦截 |
| `new Image().src` | `error` | 拦截 |
| CSS `url()` | 无请求 | 拦截 |
| `navigator.sendBeacon` | 返回 `true`，但服务器没收到 | 拦截 |
| iframe 自导航到测试服务器 | 服务器没收到 | 拦截 |

### 已知风险 R1：Linux 上 `messageHandlers.ipc` 能被 iframe 拿到（平台特性）

| 项 | 内容 |
|----|------|
| 性质 | WebKitGTK / wry 的平台行为：script message handler 对所有框架可见，不是本项目的配置错误，应用侧关不掉 |
| 影响平台 | Linux（已实测）；macOS 的 WKWebView 用的是同一套机制，可能同样存在，待验证 |
| 当前防线 | 只有 Tauri 的 invoke 密钥（128 位随机数，只注入主框架） |
| 风险等级 | 中：现在拦得住，但只剩一道防线，密钥一旦泄露给 iframe，就能以本地来源调用所有 main 窗口的命令 |
| 缓解措施 | PLAN §3.4 硬性约束：主窗口永远不能把 Tauri 对象或 invoke 密钥转发给 iframe |
| 重新评估时机 | 升级 Tauri/wry/WebKitGTK 时，以及 macOS 验证时，重跑本探针 |

详细情况：WebKitGTK 的 `window.webkit.messageHandlers.ipc` 在 sandbox iframe 里也能拿到。iframe 发出的消息会进入 Tauri 的 `Webview::on_message`，并且请求 URL 记录的是顶层页面的 `tauri://localhost`，**也就是说 Tauri 会把它当作本地来源，capability 的窗口/来源检查拦不住它**。

真正拦住它的只有 `__TAURI_INVOKE_KEY__`：

- 第一轮探针缺少这个字段，消息在反序列化阶段就被丢弃。
- 第二轮发送格式完全正确的消息，只把 key 换成伪造值，Tauri 打印 `__TAURI_INVOKE_KEY__ expected … but received forged-by-iframe` 后拒绝，canary 没有执行。
- 这个 key 是 128 位随机数（`getrandom`），只通过 `for_main_frame_only: true` 的初始化脚本注入主框架，iframe 读不到。

影响：

1. 在 Linux 上，SEC-01 实际上靠的是"主框架 JS 闭包里的密钥不外泄"这一道防线，而不是"iframe 摸不到 IPC"。只要主窗口不把 `__TAURI_INTERNALS__` 或 invoke key 传给 iframe（例如不要把它们放进 `postMessage` 的数据里），防线就成立。
2. Tauri 在密钥不匹配时会把**正确的 key 打印到 stderr**。它对 iframe 不可见，但发布版要注意日志不能被不可信内容读到（目前没有这条路径）。
3. iframe 可以无限发这类消息，每条消息都会在 stderr 打一行日志。这是轻微的 DoS 或日志刷屏风险，MVP 可以接受。

处理：§3.4 的方案不变；"主窗口永远不向 iframe 转发 Tauri 对象或 invoke 密钥"已作为硬性约束写进 PLAN §3.4，T1.10 实现时必须遵守。

### 待办

- [ ] Windows（WebView2）：重点看 `window.chrome.webview.postMessage` 在子框架是否可见，以及 `http://awpreview.localhost` 形式的 URL 和 CSP。
- [ ] macOS（WKWebView）：重点看 `window.webkit.messageHandlers.ipc` 在子框架是否可见。
- [ ] 在两个平台都通过后，把 PLAN §7 的 D1 从"挂起"改为"通过"。
- 说明：`sec_canary` 和 `probe_report` 只存在于 spike，不会进入正式代码。

---

## T0.2 manim-web 运行时验证

**结论**：通过，D2 可以继续。锁定 `manim-web@0.40.1`（MIT）。有两个需要在 M1 处理的发现：体积大，以及 CDN 回退必须显式关闭。

代码在 `spike/runtime/`：`src/main.js` 是运行时入口，`vite.config.js` 打成单文件 IIFE，`check.mjs` 用 Playwright 测试，`harness/` 是测试页面。

```bash
cd spike/runtime && pnpm install && pnpm build
node check.mjs chromium                                              # Playwright，预览 CSP，拦截外部请求
AWB_SPIKE_PAGE=runtime.html ../preview-isolation/src-tauri/target/debug/awb-spike-preview   # 真实 WebKitGTK + awpreview
```

### 结果

| 验收项 | Chromium 156（Playwright，预览 CSP） | WebKitGTK 2.52.6（Tauri awpreview + sandbox iframe） |
|--------|------|------|
| 3 个场景对应 3 个 slide | ✅ 0–1.5 / 1.5–2.5 / 2.5–4.5 s | ✅ 相同 |
| seek 前后跳（3 次） | ✅ | ✅ |
| 中文 Text | ✅（截图确认） | ✅（截图确认） |
| MathTex ∑、∫、矩阵离线渲染 | ✅（截图确认） | ✅（截图确认） |
| 外部请求 / CDN 回退 | 0 个 | 无（`connect-src 'none'`，无错误日志） |
| `onLog` 的 warn/error | 0 条 | 0 条 |
| 首次构建 3 个场景（`sequence()`） | 141 ms | 279 ms |
| 重建 20 场景 × 8 动画（3 次） | 16 / 11 / 14 ms | 36 / 21 / 19 ms |

重建耗时远低于 500ms 的目标。注意 `sequence()` 只录制时间线、不真正逐帧渲染，所以它测的是"编辑后多久能拿到新的 `loaded`"，正好是 UX-03 关心的数字。

### 发现

1. **体积：`runtime.js` 12.8 MB（gzip 3.97 MB）**。manim-web 的入口把分子、地图、three、MathJax、lottie、jspdf 等全部重新导出，Vite 无法 tree-shake。影响：导出的单文件 HTML 也是 12.8 MB；预览首次加载在 Chromium 约 0.8 s，WebKitGTK debug 版约 3 s（含基准测试）。能用，但不理想。M1 先接受，后续可以考虑：对 manim-web 做 fork 只保留 2D 部分，或请上游拆分入口。
2. **CDN 回退必须显式关闭**。dist 里写死了 jsdelivr 地址：KaTeX CSS、MathJax 脚本、gif.js worker、three 字体、typst 字体。运行时入口必须先调用 `setKatexStylesheetUrl(null)` 和 `setMathJaxScriptUrl(null)`（T1.5 的必做项）。关闭后 MathTex 走打包进来的 MathJax npm 模块，离线渲染正常。gif.js 的 worker 只在导出 GIF 时用到，属于 P1。
3. **可选依赖 `pptxgenjs`**：manim-web 用动态 import 引用了它，Vite 构建时需要把它设为 `external`。它原本就有 try/catch，不影响运行。
4. `Player` 的 `width/height` 参数看起来没有生效（画面是 640×360），T1.5 需要确认画布尺寸怎么设置。
5. 包里没有 PLAN §0 第 6 条提到的 `llms.txt` 和 `skills/manim-web/SKILL.md`，API 以 `dist/*.d.ts` 为准。
6. 许可证：生产依赖里没有 GPL/AGPL。有 MPL-2.0 OR Apache-2.0（dompurify）、BlueOak-1.0.0、Unlicense 等，都可接受。

---

## T0.3 单文件导出验证

**结论**：Chromium（也代表 Edge）和 Firefox 通过；Safari 未验证（需要 macOS）。

`spike/runtime/export.mjs` 把 `runtime.js` 和启动脚本内联进一个 HTML（12.8 MB）。meta CSP 用 sha256 哈希放行这两个内联脚本，同时设 `connect-src 'none'`；内联前把 `</script` 转义。

| 浏览器（`file://`） | 能播放 | slides 正确 | 外部请求 | 错误 |
|------|------|------|------|------|
| Chromium 156（≈ Chrome / Edge） | ✅ | ✅ | 0 | 0 |
| Firefox（Playwright） | ✅（截图确认） | ✅ | 0 | 0 |
| Safari | 未测（需要 macOS） | | | |

补充（T1.1 时发现）：正式工程用的是 Vite 8（rolldown），它不能把 manim-web 打成 IIFE 单文件，所以正式运行时改成**单文件 ES 模块**。预览页用 `<script type="module" src>` 加载；导出 HTML 用内联的 `<script type="module">`，`file://` 下同样可用。另外 manim-web 内部给 Typst 用的 chunk 会单独输出成一个文件，本应用用不到 Typst，可以忽略。T4.2 导出时需要用 ES 模块格式重新验证一次。

---

## T0.4 视频导出能力矩阵

| 环境 | 安全上下文 | `VideoEncoder` | H.264 (mp4) | VP8 / VP9 (webm) | 备注 |
|------|------|------|------|------|------|
| Chromium 156，`file://` | 是 | 有 | ✅ | ✅ / ✅ | |
| Chromium 156，非安全的 `http://` 源 | 否 | **没有** | — | — | WebCodecs 只在安全上下文里提供 |
| WebKitGTK 2.52.6，awpreview sandbox iframe | 是 | 有（`typeof` = function） | 未测 | 未测 | 按 PLAN 要求没有调用 `isConfigSupported`/`configure`（webkit bug 320327） |
| WebView2（Windows） | | | | | 待测 |
| WKWebView（macOS） | | | | | 待测 |

结论：D3 维持 MVP 方案（在浏览器里导出）。另外，Windows 上 awpreview 的地址是 `http://awpreview.localhost`，`*.localhost` 按规范算安全上下文，理论上不受上表第二行影响，需要在 Windows 实测确认。

---

## T0.5 Rust LLM 代理验证

**结论**：Linux 通过。代码在 `spike/llm-proxy/`，命令签名按 §3.3 实现了一个子集（没有重试，重试留给 T3.1）。

```bash
cd spike/llm-proxy
python3 mock_llm.py &          # OpenAI 兼容 SSE mock，故意 7 字节一块，切断事件和 UTF-8
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml && ./src-tauri/target/debug/awb-spike-llm
```

| 验收项 | 结果 |
|------|------|
| SSE 解析：跨块切分、中文多字节被切断、CRLF、注释行、`[DONE]` | ✅ 单测 4 个全过 |
| 流式经 `ipc::Channel` 送到前端 | ✅ 3 个 Delta + Usage + Done，内容完整，耗时 366 ms |
| 取消 | ✅ `llm_cancel` 后 1 ms 内返回 `cancelled`；mock 服务器记录到客户端主动断开连接 |
| 错误码 | ✅ 429 → `rate_limit`；没有 Key → `no_key`；`http://api.openai.com` → `invalid_url` |
| Key 不进前端 | ✅ `secret_status` 只返回 `last4`；请求头里的 Key 由 Rust 加，mock 校验通过 |
| keyring（Secret Service / gnome-keyring） | ✅ 存、读、删都正常，`backend: "keychain"` |
| 没有 Secret Service | ✅ 把 D-Bus 指向不存在的地址后，自动退回 `backend: "memory"`，流式和取消照常 |

### 发现

1. **依赖版本和 PLAN 不一致**：reqwest 已到 0.13，TLS 特性叫 `rustls`（默认启用），PLAN §2 写的 `rustls-tls` 已经不存在。keyring 已到 4.x，默认的 `v1` 特性保留了 3.x 的 `Entry` API，Linux 下走 zbus 访问 Secret Service。建议更新 §2 白名单的写法。
2. keyring 是同步 API，要放在 `spawn_blocking` 里调用，否则会阻塞 IPC。
3. 取消的实现方式：`futures_util::future::Abortable` 包住整个请求 future，中止时 future 被丢弃，HTTP 连接随之关闭，不需要额外的依赖。
4. 留给 T3.1 的小问题：Key 不存在时，`secret_status` 无论钥匙串是否可用都返回 `backend: "keychain"`，应返回实际状态。
5. Windows 和 macOS 的 keyring 未验证。

---

## T0.6 结构化输出可靠性

**跳过**。原因：本机没有任何云端 API Key（DeepSeek、OpenAI 等环境变量都没设置）。另外，有意义的通过率需要 T1.2/T1.3 的真实校验器。

本机有 Ollama（`qwen3.5:9b-16k`），可以在 T3.8 评测脚本里作为"本地模型"一列一起测。D4 的判断推迟到 T3.8。
