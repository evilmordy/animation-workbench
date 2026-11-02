# Animation Workbench 实施计划（PLAN.md）

> 输入：`Animation_Workbench_软件设计方案.md`（v1.0，保持不变）。
> 本文件 = **设计修订（§1）+ 冻结契约（§3）+ 可执行任务（§4）+ 安全/体验验收（§5–§6）**。
> 读者是执行任务的 Agent：先读 §0–§3，再领取 §4 中依赖已满足的任务。

---

## 0. 执行规则（所有 Agent 必读）

1. **只做任务范围内的事**。P1/P2 功能不提前实现；发现需要额外改动时，在汇报里写明，不要顺手做。
2. **§3 是冻结契约**。要改 schema、iframe 协议或 Rust 命令签名，必须单独开"契约变更"任务，同时更新本文件和 `tests/fixtures/`。
3. **边界**：只有 `src/platform/` 可以 import `@tauri-apps/*`；只有 `src/runtime/` 可以 import `manim-web`；`src/shared/` 必须是纯 TS（无 DOM、无 Tauri）。
4. **禁止**：用 `v-html`/`innerHTML` 渲染 AI 输出或导入的素材；运行时从 CDN 加载任何东西；使用 GSAP（它的免费许可证禁止用于可视化动画构建工具）；把 API Key 传给前端或写进任何文件；引入 §2 白名单以外的依赖（确实需要时在汇报里写理由）。
5. **完成标准（DoD）**：`pnpm typecheck && pnpm lint && pnpm test` 全绿，有 Rust 改动时 `cargo test` 也要绿；新逻辑有单测；任务的验收项逐条勾选；行为变化时同步更新文档。
6. **manim-web 的 API 以实际安装版本为准**：`node_modules/manim-web/dist/*.d.ts`，以及仓库里的 `llms.txt`、`skills/manim-web/SKILL.md`。版本在 T0.2 锁定后，不要擅自升级。
7. **单位**：时间一律用秒（number）。坐标用 manim 单位：画面 14×8，原点在中心，x∈[-7,7]，y∈[-4,4]。
8. 每个任务结束时按 §9 模板汇报。

---

## 1. 设计修订（相对 v1.0）

| # | v1.0 | 修订后 | 原因 |
|---|------|--------|------|
| 1 | AI 根据分镜生成整段 HTML 代码 | **分镜就是声明式 DSL**，由内置运行时（manim-web）直接解释执行；AI 只负责产出和修改分镜 JSON。DSL 表达不了的效果，用"代码场景"（P1）兜底 | 结果可控；编辑后预览不消耗 token；可以拖动进度；代码不会和分镜对不上 |
| 2 | 分镜和代码双向同步 | 取消"代码反解析成分镜"。DSL 场景没有代码副本；代码场景里的代码就是这个场景的唯一依据，标题、时长等元信息仍可编辑 | 任意 JS 无法可靠地解析回分镜 |
| 3 | 一次生成完整分镜 | **大纲 → 用户审阅 → 逐场景细化**（流式返回，可并发，单个场景失败可单独重试） | 避免长 JSON 被截断；先审再花钱；局部重生成天然支持 |
| 4 | 前端直接调用 AI | **由 Rust 发请求**；Key 存系统钥匙串，并和 Base URL 绑定，永不进入前端 | 避开 CORS；即使前端被注入恶意代码，也拿不到 Key、改不了请求目标 |
| 5 | 没有考虑无 API 预算的情况 | **手动模式**：复制提示词 → 粘贴到 ChatGPT/Claude/DeepSeek 网页版 → 把结果粘回来，走同一套校验；另支持本地 Ollama | 直接回应痛点 3："有订阅，但嫌 API 按量付费贵" |
| 6 | 运行时从 CDN 引入 | 通过 npm 打包运行时并锁定版本；导出的 HTML 内联运行时 | 离线可用；没有 CDN 供应链风险；预览和导出用同一份运行时 |
| 7 | 没有讨论安全 | 预览运行在 `sandbox` iframe 里（使用独立的自定义协议源，CSP 禁止一切网络），iframe 访问不到 IPC | AI 输出和导入的素材都不可信 |
| 8 | 中间放时间线，底部放预览 | **中间放大预览，底部放时间线**，左侧是项目/素材/AI，右侧是检查器 | 和剪辑软件的惯例一致，用户上手成本低 |
| 9 | Naive UI 或 Element Plus 待定；用 Monaco | 定为 Naive UI（内置暗色主题）；改用 CodeMirror 6（更轻，只在专家模式下用） | 选型收敛，安装包更小 |
| 10 | 视频导出写的是"可以的话" | MVP：在系统浏览器里打开导出的 HTML，用 Player 自带的导出按钮。P1 再做应用内 WebCodecs 导出 | 各平台 WebView 支持程度不一，WebKitGTK 2.52.3 调用编码器会崩溃（webkit bug 320327） |
| 11 | 版本历史放到后续版本 | MVP 就做**撤销/重做 + 自动快照** | AI 的每次修改都必须能回退，防止丢数据 |
| 12 | 设置交互点 | MVP 只做导出 HTML 的"幻灯片模式"（在场景边界暂停）；元素级交互放到 P2 | 先保证核心闭环 |

**MVP 不做**：配音和音频同步、多人协作、云同步、移动端、把代码反解析成分镜、OCR。

---

## 2. 技术栈与目录

**白名单依赖**
- 前端：vue 3、pinia、naive-ui、vue-draggable-plus、zod v4（用于类型、校验，并通过 `z.toJSONSchema` 生成提示词里的 schema）、pdfjs-dist、@codemirror/*（basic-setup、lang-json、lang-javascript）、manim-web（**锁定 0.40.1**）、@tauri-apps/api，以及 plugin-fs、plugin-dialog、plugin-store、plugin-opener；plugin-persisted-scope 只有 Rust 端，没有 npm 包。
- 开发：typescript（**~6.0**，typescript-eslint 尚不支持 7.x）、vue-tsc、vite、@vitejs/plugin-vue、vitest、happy-dom、@playwright/test、@axe-core/playwright、eslint（含 eslint-plugin-vue、typescript-eslint）、prettier、@tauri-apps/cli、@types/node。
- Rust：tauri 2、tauri-build、serde、serde_json、tokio、reqwest 0.13（rustls、stream、json；rustls 已是默认 TLS，旧名 `rustls-tls` 不再存在）、futures-util、keyring 4（默认 `v1` 特性）、url、thiserror。

```
animation-workbench/
├── vite.config.ts              # 主应用
├── vite.runtime.config.ts      # 运行时库构建 → dist-runtime/runtime.js（单文件）
├── src/
│   ├── shared/   schema.ts registry.ts validate.ts timing.ts ops.ts protocol.ts id.ts
│   ├── runtime/  index.ts interpret.ts builders.ts      # 唯一允许使用 manim-web 的地方
│   ├── platform/ index.ts tauri.ts mock.ts              # 唯一允许使用 Tauri 的地方
│   ├── stores/   project.ts settings.ts ai.ts
│   ├── ai/       client.ts extract.ts providers.ts prompts/*.md
│   └── features/ timeline/ inspector/ preview/ input/ export/ settings/ welcome/
├── src-tauri/src/ lib.rs llm.rs secrets.rs preview_protocol.rs
├── samples/pythagoras/         # 内置示例项目
└── tests/ fixtures/ runtime/ e2e/
```

**命令**：`pnpm dev`（浏览器 + mock 平台）· `pnpm tauri dev` · `pnpm build:runtime` · `pnpm test` · `pnpm test:e2e` · `pnpm typecheck` · `pnpm lint` · `pnpm tauri build`

**用户项目目录**
```
MyAnimation/
├── project.json     # 名称、schemaVersion、AI 设置、素材列表、生成参数（目标时长/复杂度/内容类型）
├── storyboard.json  # 唯一依据（SSOT）
├── inputs/          # 导入素材的副本，以及提取出的文本
├── assets/          # 图片/SVG（P1）
├── versions/        # 自动快照 storyboard-YYYYMMDD-HHmmss-<原因>.json，保留 50 份
├── exports/         # 导出的 HTML/视频
└── .awb/            # ai-log.jsonl 和缓存，可以删除
```

---

## 3. 冻结契约

### 3.1 分镜 Schema v1（`src/shared/schema.ts` 用 zod 实现）

```ts
type Vec2 = [number, number];
type Color = string;            // "#RRGGBB" 或调色板令牌 "$primary|$secondary|$accent|$text|$muted"
type Dir = "UP"|"DOWN"|"LEFT"|"RIGHT"|"UL"|"UR"|"DL"|"DR";

interface Storyboard {
  schemaVersion: 1;
  meta: { title: string; mode: "2d"|"3d"; aspect: "16:9"|"9:16"|"1:1";
          background: Color; stylePreset: "3b1b"|"clean"|"custom"; palette?: Record<string,string> };
  scenes: Scene[];
}
interface Scene {
  id: string; title: string; description: string; notes?: string;  // notes 存讲稿/旁白
  kind: "dsl"|"code";           // MVP 只实现 dsl；code 是 P1
  enter: "fresh"|"keep";        // fresh：先用 0.5s 淡出上个场景的所有元素；keep：继承上个场景在场的元素，并可以引用
  hold: number;                 // 场景末尾停留的秒数
  locked?: boolean;             // AI 批量修改时跳过
  elements: Element[]; steps: Step[];
  code?: string;                // 仅 kind=code（P1）
}
interface Element {
  id: string; type: ElementType; props: Record<string, unknown>;   // props 由注册表校验
  place?: { at?: Vec2; nextTo?: { id: string; dir: Dir; buff?: number }; toEdge?: Dir };
  style?: { color?: Color; fill?: Color; fillOpacity?: number; strokeWidth?: number;
            scale?: number; rotate?: number /*度*/; z?: number };
}
type Step =
  | { id: string; kind: "play"; anims: Anim[]; duration: number;
      rate?: "smooth"|"linear"|"easeInOut"|"rushInto"|"thereAndBack"; lag?: number /*0..1，对应 LaggedStart*/ }
  | { id: string; kind: "wait"; duration: number };
interface Anim { type: AnimType; target: string; to?: string; params?: Record<string, unknown> }
```

- **ElementType（MVP）**：Circle、Square、Rectangle、Polygon、Line、Arrow、Dot、Text、MathTex、Axes、FunctionGraph（`expr`，可选 `axes`）、NumberPlane、Brace、Group。
- **AnimType（MVP）**：Create、Write、FadeIn、FadeOut、DrawBorderThenFill、Uncreate、GrowFromCenter、Transform（`target→to`，语义等同 ReplacementTransform）、TransformMatchingTex、Shift`{by}`、MoveTo`{at}`、Rotate`{degrees}`、ScaleInPlace`{factor}`、SetColor`{color}`、Indicate、Circumscribe、Flash、Wiggle。
- **注册表**（`registry.ts`）：每个类型包含 props 的 zod schema、默认值、中文名和一句说明。检查器表单和提示词里的规格都从注册表生成，**新增类型只改这一处**。
- **场景时长**（派生值，只读）= （`fresh` 且不是第一个场景时加 0.5）+ 所有步骤时长之和 + `hold`。
- **拖拽调整场景时长到 D**：记原时长为 A。若 D ≥ A，则 `hold += D − A`；否则先把 `hold` 设为 0，再把所有步骤按比例缩放，每步不少于 0.1s，按 0.05s 取整。
- **元素生命周期**：出场类动画（Create、Write、FadeIn、DrawBorderThenFill、GrowFromCenter，以及 Transform 的 `to`）只能用在不在场的元素上；其他动画只能用在在场的元素上。FadeOut、Uncreate 和 Transform 的 `target` 会让元素离场。

**校验规则（`validate.ts`）**：错误会阻止应用 AI 结果并触发修复，警告只显示徽标。
- V1：zod 结构校验。
- V2：场景 id 全局唯一；元素 id 在可见范围内唯一（本场景 + 继承来的）。
- V3：`target`、`to`、`nextTo.id`、`Brace.target`、`Group.children`、`axes` 引用的元素都必须存在。
- V4：符合上面的生命周期规则。
- V5：每个步骤 0.1–30s；`wait` 和 `hold` 0–30s；单个场景不超过 120s；整个项目不超过 600s。
- V6：坐标超出画面时给**警告**。
- V7：Text 不超过 200 字；MathTex 不超过 300 字，且里面含中文时给警告（中文应该放进 Text）。
- V8：`FunctionGraph.expr` 只允许 `x`、数字、`+-*/%()` 和 `Math.{sin,cos,tan,exp,log,sqrt,abs,pow,PI,E}`。

### 3.2 预览 iframe 协议（`src/shared/protocol.ts`，两端都用 zod 校验）
- 宿主只接受 `event.source === iframe.contentWindow` 的消息；iframe 只接受 `window.parent` 的消息。
- 宿主 → iframe：`load{storyboard, startAt?}`、`play`、`pause`、`seek{t}`、`setRate{rate}`
- iframe → 宿主：
  - `ready{runtimeVersion, manimWebVersion, caps:{webcodecs}}`
  - `loaded{duration, scenes:[{id,start,end}], buildMs}`
  - `time{t, playing}`（播放时最多每秒 15 次）
  - `error{sceneId?, elementId?, message}`
  - `log{level, message}`（来自 manim-web 的 `onLog`，warn 及以上）
  - `heartbeat`（每秒一次）

### 3.3 Rust 命令（只开放给 `main` 窗口；`build.rs` 用 `AppManifest::commands` 限定）
```
secret_set(provider_id, base_url, api_key)   // 以 {base_url, api_key} 存入系统钥匙串
secret_status(provider_id) -> { exists, base_url, last4, backend: "keychain"|"memory" }
secret_remove(provider_id)
llm_chat(req{request_id, provider_id, model, messages, temperature?, max_tokens?, json_mode},
         on_event: Channel<Delta{text} | Usage{prompt,completion} | Done{finish_reason}>)
  -> { text, usage?, finish_reason }
llm_cancel(request_id)
错误：{ code: auth|rate_limit|network|timeout|cancelled|bad_request|server|no_key|keyring|invalid_url, message, status? }
```
- `llm_chat` **不接收 URL**，Base URL 从钥匙串条目里读取。要改 URL，必须重新输入 Key。
- 只允许 https；只有 localhost、127.0.0.1、::1 和局域网私有网段可以用 http（为了支持 Ollama）。
- Linux 上没有 Secret Service 时，Key 只保存在内存里，本次会话有效（`backend:"memory"`），UI 会给出提示。

### 3.4 预览隔离方案
- Rust 用 `register_asynchronous_uri_scheme_protocol("awpreview")` 提供**白名单内的两个文件**：`index.html` 和 `runtime.js`。release 构建用 `include_bytes!`，debug 构建直接读 `dist-runtime/`。
- 主窗口用 `<iframe sandbox="allow-scripts" src={convertFileSrc('index.html','awpreview')}>` 加载预览，不加 `allow-same-origin`。
- **硬性约束**：主窗口永远不能把 Tauri 对象或 invoke 密钥转发给 iframe（不能通过 postMessage 等任何方式）。原因：Linux 上 iframe 能拿到 `window.webkit.messageHandlers.ipc`，挡住它的只有 invoke 密钥（见 `docs/spike-report.md` 已知风险 R1）。
- 为什么不用 srcdoc 或 blob：这两种 iframe 会继承父页面的 CSP，没法单独放开 `unsafe-eval`。
- 预览页的 CSP 响应头：`default-src 'none'; script-src awpreview: http://awpreview.localhost 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'`
- 主窗口的 CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src awpreview: http://awpreview.localhost; connect-src ipc: http://ipc.localhost`
- 运行时把每个分镜场景映射成一个 manim-web slide：在第 2 到第 n 个场景开始前调用 `nextSlide()`，然后用 `player.timeline.getSlides()` 回报每个场景的真实起止时间。编辑预览里用 CSS 隐藏 `[data-player-bar]`（Player 自带的控制条），导出的 HTML 保留它。

### 3.5 AI 提供商（统一走 OpenAI 兼容的 Chat Completions；预设只是数据，写在 `src/ai/providers.ts`，实现时请核对官方文档）
DeepSeek `https://api.deepseek.com`（默认）· 通义 `https://dashscope.aliyuncs.com/compatible-mode/v1` · 智谱 `https://open.bigmodel.cn/api/paas/v4` · OpenAI `https://api.openai.com/v1` · Gemini `https://generativelanguage.googleapis.com/v1beta/openai` · Claude `https://api.anthropic.com/v1`（OpenAI SDK 兼容层）· Ollama `http://localhost:11434/v1` · 自定义。每个预设标注是否支持 `json_mode`；模型名只是可修改的默认值。

---

## 4. 任务分解

> 规模：S ≤ 0.5 天，M ≤ 2 天，L ≤ 4 天。方括号里是依赖。**可以并行**：T1.4 完成后，运行时线（T1.5、T1.6）、应用线（T1.7–T1.9）和 AI 后端线（T3.1）可以同时进行。

### M0 技术验证（代码放在可丢弃的 `spike/`，结论写进 `docs/spike-report.md`）
- **T0.1 预览隔离验证** M。按 §3.4 搭建最小的 Tauri 应用。debug 构建加一个 `sec_canary` 命令，被调用时记录日志。在 iframe 里尝试以下调用：`window.__TAURI_INTERNALS__`、`parent.__TAURI_INTERNALS__`、`window.ipc.postMessage`、`window.webkit.messageHandlers.ipc.postMessage`、`window.chrome.webview.postMessage`，以及 `fetch` 到 `ipc://localhost/sec_canary` 和 `http://ipc.localhost/sec_canary`。再分别用 fetch、XHR、WebSocket、`new Image().src`、CSS `url()`，以及把 iframe 自身导航到本机测试服务器。
  - ✅ 在 Windows、macOS、Linux 上，canary 都没有被调用，测试服务器也没有收到任何请求。
- **T0.2 manim-web 运行时验证** M。用 Vite 把 manim-web 打包成 `runtime.js`，并**锁定精确版本**。用 Player 播放 3 个场景。
  - ✅ `getSlides()` 和场景一一对应，`seek` 能正确前后跳转。
  - ✅ 中文 Text 正常显示。MathTex（∑、∫、矩阵）在 `connect-src 'none'` 下离线渲染，日志里没有 CDN 回退（manim-web 打包失败时会回退到 jsdelivr 上的 MathJax）。
  - ✅ 记录 runtime.js 的体积，以及 20 个场景、每场景 8 个动画时的重建耗时（目标 < 500ms）。
- **T0.3 单文件导出验证** S [T0.2]。把运行时和分镜 JSON 内联成一个 HTML。✅ 在 Chrome、Edge、Safari、Firefox 里通过 `file://` 离线打开都能播放。
- **T0.4 视频导出能力矩阵** S [T0.2]。测试 WebView2、WKWebView 和 Chrome 中的 WebCodecs（mp4/webm）。**在 Linux 上只检测 `typeof VideoEncoder`，不要调用 `isConfigSupported` 或 `configure`**，否则会触发 WebKitGTK 崩溃。✅ 产出一张能力表。
- **T0.5 Rust LLM 代理验证** S。用 reqwest 接收 SSE 流，通过 `ipc::Channel` 转给前端，并支持取消。✅ 三个平台上 keyring 都能存取；Linux 没有 Secret Service 时的行为已记录。
- **T0.6 结构化输出可靠性** S（需要 Key，没有就跳过并在报告中注明）。用 DeepSeek 加另一个模型，单场景提示词 × 5 个输入。✅ 记录一次通过率和修复后的通过率。

### M1 骨架、数据与预览（退出标准：打开示例项目后能播放、能拖进度；在专家 JSON 编辑器里修改后，预览会更新）
- **T1.1 工程脚手架** M [M0]。按 §2 搭建工程。ESLint 把 `vue/no-v-html` 设为 error。Tauri 的 capabilities 只开放给 main 窗口，权限按最小原则配置；`build.rs` 配好 AppManifest；按 §3.4 配置 CSP。配置 GitHub Actions，在三个平台上跑 lint、typecheck、test、cargo test 和 build。
  - ✅ 空应用在三个平台都能启动。
- **T1.2 Schema、注册表和 fixtures** M [T1.1]。按 §3.1 实现 `schema.ts`、`registry.ts` 和 `id.ts`。把附录 A 的示例存为 `tests/fixtures/pythagoras.json`，同时作为 `samples/` 里的示例项目。
  - ✅ fixture 能通过校验。
  - ✅ 10 个非法用例都报错，错误里带 JSON 路径。
- **T1.3 语义校验** M [T1.2]。实现 V2–V8，每条规则至少一个正例和一个反例。
  - ✅ 返回 `{level, code, path, message(中文)}[]`。
- **T1.4 时长计算** S [T1.2]。实现 `timing.ts`：计算场景时长，以及拖拽时长的规则。
  - ✅ 单测覆盖伸长、缩短和"缩到最小值"三种情况。
- **T1.5 运行时** L [T1.2, T0.2]。`interpret.ts` 把分镜翻译成 `Player.sequence`；`builders.ts` 按注册表映射到 manim-web；颜色令牌按调色板解析；Tex 和 Text 先 `await` 渲染完成再播放动画；把 `onLog` 和异常转成 `error` 消息，并定位到具体场景/元素。
  - ✅ Playwright 打开 `tests/runtime/harness.html` 加载 fixtures，收到的 `loaded.scenes` 数量和起止时间都正确，没有 `error`。
- **T1.6 awpreview 协议** S [T1.1, T1.5]。按 §3.4 实现。
  - ✅ 请求白名单以外的路径返回 404。
  - ✅ 响应头里带 CSP。
- **T1.7 平台层** M [T1.1]。按 §3.3 的命令和 fs 能力，实现 `tauri.ts` 和 `mock.ts`。mock 用内存文件系统，假 LLM 按任务类型返回 fixtures 里的数据。`writeTextAtomic` 先写临时文件再 rename。打开项目用 `dialog.open({directory:true, recursive:true})`，这样 fs 作用域会自动加上该目录，再配合 persisted-scope 记住最近打开的项目。
  - ✅ 在主窗口的 devtools 里读 `~/.ssh` 会被拒绝。
- **T1.8 项目 store** M [T1.3, T1.7]。实现新建、打开、最近项目（最多 10 个）和自动保存（1s 防抖）。在 AI 修改生效前和手动保存时写快照，最多保留 50 份。撤销/重做用整体快照实现，最多 100 步。遇到比当前更新的 `schemaVersion` 时拒绝打开，提示升级应用。`storyboard.json` 损坏时，提供从最新快照恢复。
  - ✅ 用 mock 平台写的单测全部通过。
- **T1.9 应用外壳** M [T1.8]。实现四个区域的布局（见 §1 第 8 条）、状态栏（保存状态、模型、用量、问题数）和欢迎页（打开示例、新建项目、配置 AI）。
  - ✅ 不配置 Key 也能打开示例项目。
- **T1.10 预览组件和专家编辑器** M [T1.6, T1.9]。实现 iframe 宿主：播放、暂停、seek、倍速、时间同步。心跳超过 3s 没收到时，提示"预览无响应"，并提供重载按钮。编辑后防抖 300ms 再发 `load`。用 CodeMirror 编辑整个分镜或单个场景的 JSON，校验错误直接标在行上。
  - ✅ 修改 JSON 后，500ms 内预览更新。

### M2 可视化编辑（退出标准：不写 JSON、不用 AI，也能做出一个 3 场景的动画）
- **T2.1 时间线** L [T1.10]。场景块的宽度和时长成正比，时长用运行时回报的真实值。支持播放头、点击跳转、拖拽排序（vue-draggable-plus）、拖右边缘调时长（按 T1.4 的规则）、选中，以及右键菜单（复制、删除、插入空场景、锁定）。场景卡片显示标题、时长和状态徽标（生成中、错误、警告、锁定）。
- **T2.2 检查器：场景** S [T2.1]。可编辑标题、描述、讲稿、enter、hold、锁定。
- **T2.3 检查器：元素** M [T2.1]。表单由注册表生成，字段类型包括数字、Vec2、颜色（支持令牌）、文本、LaTeX、枚举和元素引用。支持添加、删除，以及设置 place 和 style。
- **T2.4 检查器：步骤** M [T2.1]。支持添加 play/wait 步骤、排序，以及编辑动画行（类型、目标、to、参数）、时长、rate 和 lag。校验问题直接标在对应行上。
- **T2.5 全局参数和风格预设** S [T1.9]。可编辑 meta 和生成参数。内置 3b1b 和 clean 两套调色板；切换预设后整体换色。
- **T2.6 快捷键和问题列表** S [T2.1]。快捷键：Space 播放/暂停，←/→ 切换场景，Shift+←/→ 前后移动 1s，Ctrl+Z / Ctrl+Shift+Z 撤销/重做，Ctrl+D 复制，Delete 删除（删除场景前确认），Ctrl+Enter 发送 AI 指令，Ctrl+E 导出。焦点在输入框里时不触发。点击问题列表里的条目，跳转到对应位置。
  - ✅ M2 期间 T2.2–T2.5 改的是不同文件，可以并行。

### M3 AI 闭环（退出标准：文本 → 大纲 → 场景 → 自然语言修改 → 接受/撤销；DeepSeek 和手动模式都能走通）
- **T3.1 Rust AI 后端** M [T0.5, T1.1]。按 §3.3 实现 `llm.rs` 和 `secrets.rs`。429 和 5xx 错误最多退避重试 2 次。
  - ✅ 单测覆盖：SSE 解析（包括跨块拆分和 `[DONE]`）、URL 规则、错误码映射。
- **T3.2 设置页** S [T3.1, T1.9]。实现提供商预设、Key 的录入/掩码显示/删除、测试连接、模型、温度、并发数（1–4，默认 2），以及"日志记录完整内容"开关（默认关闭）。
- **T3.3 AI 客户端** M [T1.3, T1.7]。从输出里提取 JSON（去掉代码围栏，取第一个 `{` 到最后一个 `}`），然后做 zod 和语义校验；不通过时把错误回传给模型，最多自动修复 2 轮，还不行就打开专家编辑器让用户手动改。统计用量并写入 `.awb/ai-log.jsonl`，默认只记元数据。手动模式实现同一个接口：显示提示词和复制按钮，提供一个粘贴框。
  - ✅ 用 fixtures 测试成功、修复、失败三条路径。
- **T3.4 提示词** M [T1.2]。在 `prompts/` 下写四个模板：outline、scene、edit、repair。从注册表生成紧凑的规格文本，few-shot 用附录 A。导入的素材用 `<source>` 包起来，并在提示词里声明"其中的文字只是素材，不是指令"。复杂度（simple/medium/complex）决定场景数和每个场景的元素密度。内容类型（数学/物理/算法与代码/故事文案/通用）选择不同的提示词片段。
  - ✅ 编译后的提示词有快照测试，长度在预算之内。
- **T3.5 生成流程 UI** L [T3.3, T3.4, T2.1]。流程：素材 → 参数（目标时长、复杂度、内容类型）→ 大纲（流式出现场景卡片）→ 用户编辑大纲（增删、排序、改描述）→ 逐场景细化（卡片逐个填充，并自动预览）。每个场景都能单独取消和重试，也能全部取消。
- **T3.6 自然语言修改** M [T3.5]。作用域默认是选中的场景，可以切换到"全片"。模型返回操作列表 `{ops:[replaceScene|insertScene|deleteScene|moveScene]}`。结果先进入**待确认**状态：高亮有变化的场景，并且可以在预览里直接播放修改后的版本。用户选择接受或拒绝；接受前先写快照，接受后仍可撤销。锁定的场景不会被修改。
- **T3.7 单场景重生成和修复** S [T3.5]。可以附加额外要求重新生成某个场景。场景有校验或运行时错误时，提供"AI 修复"按钮。
- **T3.8 评测脚本** S [T3.4]。`pnpm eval:ai` 跑 10 个输入（勾股定理、二分查找、牛顿第二定律、冒泡排序、一段小说……），输出各模型的通过率。目标：默认模型在 1 轮修复以内的有效率 ≥ 90%。

### M4 输入、导出、加固和发布（退出标准：§5 和 §6 在 Windows 和 macOS 上全部通过，Linux 冒烟测试通过）
- **T4.1 素材输入** M [T3.5]。支持粘贴、导入 txt/md/代码文件（先按 UTF-8 解码，出现替换字符时改用 GBK），以及 PDF（用 pdfjs-dist 读文本层，可选页码范围，提取结果可编辑预览；扫描版 PDF 提示"没有文本层"）。显示 token 估算，超出预算时提示缩小范围。素材副本存到 `inputs/`。
- **T4.2 导出 HTML** M [T1.5]。导出单个 HTML 文件，内联运行时和分镜，保留 Player 控件，可选幻灯片模式和循环播放，并带 meta CSP（`connect-src 'none'`）。默认保存到 `exports/`，导出后可以"在浏览器中打开"。有 error 级别的校验问题时阻止导出。
  - ✅ Playwright 用 `file://` 打开导出文件：能收到 `loaded`，网络请求数为 0。
- **T4.3 视频导出（MVP 降级方案）** S [T4.2]。导出对话框里引导用户在 Chrome 或 Edge 里打开导出的 HTML，用播放器自带的按钮导出 MP4、WebM 或 GIF。应用内导出放到 P1。
- **T4.4 安全加固** M。逐项执行 §5。新增 `scripts/scan-secrets.mjs`，在项目目录、导出文件和日志里搜索当前 Key。
- **T4.5 体验打磨** M。补齐所有面板的空状态和首次启动引导。写一张错误文案表，至少覆盖 10 种常见错误，每条都说明"发生了什么，接下来怎么做"。用 axe 扫描主界面。实测 §6 里的性能指标。
- **T4.6 打包** S。配置图标和安装包（msi/nsis、dmg、AppImage/deb）。Linux 上如果用户没设置 `WEBKIT_DISABLE_DMABUF_RENDERER`，就设为 1（规避 NVIDIA 下的白屏）。写 README 快速上手。代码签名放到 P2，先在文档里说明。
- **T4.7 MVP 验收** S。按 §5 和 §6 逐条验收，结果写进 `docs/mvp-acceptance.md`。

---

## 5. 安全评估与验证（SEC）

| ID | 威胁 | 措施 | 如何验证 |
|----|------|------|----------|
| SEC-01 | AI 或素材里的脚本调用本地能力 | sandbox iframe + 独立协议源 + 不注入 IPC | T0.1 的探针在三个平台上都碰不到 canary |
| SEC-02 | 预览把数据发到外部 | CSP `connect-src 'none'`，主窗口用 `frame-src` 限制 iframe 导航 | 测试服务器收不到任何请求 |
| SEC-03 | API Key 泄露 | 存系统钥匙串，只在 Rust 里使用，前端只看到掩码，错误信息里不带 Authorization | `scan-secrets.mjs` 扫描结果为 0；devtools 里查不到 Key |
| SEC-04 | 越权读写文件 | 只有对话框授权过的目录和应用数据目录在 fs 作用域内；不安装 shell 插件；分镜里的资源路径必须是相对路径，拒绝 `..` 和绝对路径 | 在 devtools 读 `/etc/passwd`、`~/.ssh` 被拒；路径穿越的单测 |
| SEC-05 | 被篡改的前端把 Key 发到别的地址 | `llm_chat` 不接收 URL，Key 和 URL 绑定，只允许 https（本机/局域网例外） | Rust 单测 |
| SEC-06 | 主窗口被 XSS | 禁止 `v-html`；严格 CSP，不开 `unsafe-eval`，不允许内联脚本 | lint 规则；CI 里 grep `innerHTML` |
| SEC-07 | 数据丢失或损坏 | 原子写入、自动快照、损坏后可恢复、不打开更新版本的 schema | 保存过程中强杀进程，重开后 JSON 仍然可以解析 |
| SEC-08 | 供应链和许可证风险 | 有 lockfile；manim-web 锁精确版本；CI 跑 `pnpm audit` 和 `cargo audit`；不允许 GPL、AGPL 和 GSAP | CI 通过；`pnpm licenses list` 检查结果 |
| SEC-09 | 提示词注入 | 素材只当作数据；AI 输出必须通过 schema 校验；AI 不能调用任何工具；修改要用户确认后才生效 | T3.6 的待确认流程测试 |

隐私：只有用户选中的素材文本和分镜 JSON 会发给**用户自己配置的地址**，发送界面上会显示目标主机。没有遥测；手动模式下完全不联网。

---

## 6. 体验评估与指标（UX）

| ID | 指标 | 目标 |
|----|------|------|
| UX-01 | 第一次启动到看到示例动画 | ≤ 2 次点击，≤ 10s，不需要 Key |
| UX-02 | 从文本生成可预览的分镜（DeepSeek，6 个场景） | 第一个场景 ≤ 30s 出现，全部完成 ≤ 2min |
| UX-03 | 编辑后预览更新（20 个场景，p95） | ≤ 500ms |
| UX-04 | AI 修改 | 不会悄悄覆盖；都可以拒绝；接受后可以撤销 |
| UX-05 | 耗时操作 | 都有进度显示，都能取消 |
| UX-06 | 错误提示 | 说明"发生了什么"和"接下来怎么做" |
| UX-07 | 键盘操作 | 只用键盘也能选中场景、排序、调时长、播放 |
| UX-08 | 可访问性 | axe 没有 critical 或 serious 问题；图标按钮都有 aria-label；文字对比度 ≥ 4.5:1 |
| UX-09 | 崩溃后恢复 | 强制退出后重新打开，丢失的编辑不超过 2 秒 |
| UX-10 | 无 Key 可用 | 手动模式能完整走通"生成 → 导出" |
| UX-11 | 真人试用（人工） | 3 名目标用户（老师、开发者、视频作者）在没有指导的情况下，15 分钟内完成"文本 → 导出 HTML" |

---

## 7. 风险与决策点

| 决策 | 时机 | 通过 | 不通过时的替代方案 |
|------|------|------|----------|
| D1 预览隔离（**状态：Linux 通过，Win/macOS 待验证（挂起）**） | T0.1 | 按 §3.4 做 | 改用独立的预览窗口（capability 只给 main，配合 AppManifest 限制）；还是不行就在该平台禁用代码场景 |
| D2 manim-web（**状态：通过**，锁定 0.40.1；体积 12.8MB 为已知问题，见 spike-report） | T0.2 | 锁定版本，继续 | MathTex 离线渲染失败：把字体打包后由 awpreview 提供；性能不达标：只重建当前场景之前的部分 |
| D3 视频导出（**状态：维持 MVP 降级方案**，Win/macOS 能力待测） | T0.4 | P1 按平台启用应用内导出 | 只保留"在浏览器里导出"的降级方案 |
| D4 AI 可靠性（**状态：推迟到 T3.8**，T0.6 因无云端 Key 跳过） | T0.6 / T3.8 | 继续 | 有效率 < 70%：减少 DSL 字段、增加 few-shot、推荐更强的默认模型 |
| D5 Linux | T0.1 / T0.5 | 三个平台同等支持 | Linux 标为"实验性"，在文档里写明最低 WebKitGTK 版本 |

还要持续关注：manim-web 还在 1.0 之前，更新很快（2026 年 2 月到 10 月发布了 68 个版本）。所有调用都集中在 `src/runtime/`，升级时必须跑完 runtime 测试；实在不稳定就 fork 一份锁定版本。

---

## 8. 后续待办（不要在 MVP 里做）

- **P1**：在预览里拖拽元素定位；代码场景（`async (scene, M, ctx)` 函数体 + AI 写代码 + 根据错误修复 + 录制超时 + 卡死后以安全模式启动）；应用内 WebCodecs 和 GIF 导出；拆分/合并场景；循环播放当前场景；检测项目文件被外部修改；从链接导入；长文分块摘要；获取模型列表；导出时嵌入字体子集；图片/SVG 素材；3D 元素；镜头运动（MovingCameraScene）；快照对比界面；浅色主题。
- **P2**：PNG 帧序列 + 用户自己安装的 ffmpeg 做高质量导出；项目 zip 导入导出；Web 版（受 CORS 限制，用手动模式或支持 CORS 的端点）；本地 CLI 桥接（`claude -p`、`codex exec`、`gemini -p` 等，复用用户的订阅，实验性；只调用白名单内的可执行文件，固定参数，不经过 shell）；模板库；元素级交互（拖动、滑块）；自动更新和代码签名。

---

## 9. 汇报模板

```
任务：T?.? <标题>
完成：<做了什么，列出改动的文件>
未完成/跳过：<以及原因>
验证：<跑了哪些命令、测试，结果如何；验收项逐条勾选>
风险/待决：<需要 owner 决策的事项、契约变更建议>
```

---

## 附录 A：示例分镜（fixture、内置示例项目和 few-shot 共用）

```json
{
  "schemaVersion": 1,
  "meta": { "title": "勾股定理的直观证明", "mode": "2d", "aspect": "16:9", "background": "#000000", "stylePreset": "3b1b" },
  "scenes": [
    {
      "id": "s_tri001", "title": "引入直角三角形", "description": "画出直角三角形并标注三边 a、b、c",
      "kind": "dsl", "enter": "fresh", "hold": 1,
      "elements": [
        { "id": "tri", "type": "Polygon", "props": { "points": [[-1,-0.5],[1,-0.5],[-1,1]] }, "style": { "color": "$primary" } },
        { "id": "la", "type": "MathTex", "props": { "latex": "a" }, "place": { "nextTo": { "id": "tri", "dir": "LEFT" } } },
        { "id": "lb", "type": "MathTex", "props": { "latex": "b" }, "place": { "nextTo": { "id": "tri", "dir": "DOWN" } } },
        { "id": "lc", "type": "MathTex", "props": { "latex": "c" }, "place": { "at": [0.3, 0.65] } }
      ],
      "steps": [
        { "id": "st_a1", "kind": "play", "anims": [{ "type": "Create", "target": "tri" }], "duration": 2 },
        { "id": "st_a2", "kind": "play", "anims": [{ "type": "Write", "target": "la" }, { "type": "Write", "target": "lb" }, { "type": "Write", "target": "lc" }], "duration": 1.5, "lag": 0.3 }
      ]
    },
    {
      "id": "s_sq0002", "title": "在三边上作正方形", "description": "三边各作一个正方形，面积分别是 a²、b²、c²",
      "kind": "dsl", "enter": "keep", "hold": 1,
      "elements": [
        { "id": "sa", "type": "Square", "props": { "sideLength": 1.5 }, "place": { "at": [-1.75, 0.25] }, "style": { "color": "$secondary" } },
        { "id": "sb", "type": "Square", "props": { "sideLength": 2 },   "place": { "at": [0, -1.5] },    "style": { "color": "$secondary" } },
        { "id": "sc", "type": "Square", "props": { "sideLength": 2.5 }, "place": { "at": [0.75, 1.25] }, "style": { "color": "$accent", "rotate": -36.87 } },
        { "id": "ta", "type": "MathTex", "props": { "latex": "a^2" }, "place": { "at": [-1.75, 0.25] } },
        { "id": "tb", "type": "MathTex", "props": { "latex": "b^2" }, "place": { "at": [0, -1.5] } },
        { "id": "tc", "type": "MathTex", "props": { "latex": "c^2" }, "place": { "at": [0.75, 1.25] } }
      ],
      "steps": [
        { "id": "st_b1", "kind": "play", "anims": [{ "type": "FadeOut", "target": "la" }, { "type": "FadeOut", "target": "lb" }, { "type": "FadeOut", "target": "lc" }], "duration": 0.5 },
        { "id": "st_b2", "kind": "play", "anims": [{ "type": "Create", "target": "sa" }, { "type": "Create", "target": "sb" }, { "type": "Create", "target": "sc" }], "duration": 2.5, "lag": 0.3 },
        { "id": "st_b3", "kind": "play", "anims": [{ "type": "Write", "target": "ta" }, { "type": "Write", "target": "tb" }, { "type": "Write", "target": "tc" }], "duration": 1.5 }
      ]
    },
    {
      "id": "s_eq0003", "title": "得出结论", "description": "强调两个小正方形面积之和等于大正方形面积",
      "kind": "dsl", "enter": "keep", "hold": 2,
      "elements": [
        { "id": "eq", "type": "MathTex", "props": { "latex": "a^2+b^2=c^2", "fontSize": 56 }, "place": { "toEdge": "DOWN" } }
      ],
      "steps": [
        { "id": "st_c1", "kind": "play", "anims": [{ "type": "Indicate", "target": "sa" }, { "type": "Indicate", "target": "sb" }], "duration": 1 },
        { "id": "st_c2", "kind": "play", "anims": [{ "type": "Indicate", "target": "sc" }], "duration": 1 },
        { "id": "st_c3", "kind": "play", "anims": [{ "type": "Write", "target": "eq" }], "duration": 2 },
        { "id": "st_c4", "kind": "play", "anims": [{ "type": "Circumscribe", "target": "eq" }], "duration": 1 }
      ]
    }
  ]
}
```
总时长 = 4.5 + 5.5 + 7 = 17s（三个场景都没有 fresh 转场）。
