# MVP 验收（v1.0.0）

日期：2026-11-02。验收环境：Linux 7.0.0、WebKitGTK 2.52.6、Tauri 2.12.5。
Windows 和 macOS 只跑了 CI 构建，没有实机验收。UX-11 需要真人试用，还没做。

## §5 安全

| ID | 结果 | 证据 |
|----|------|------|
| SEC-01 | Linux 通过；Win/macOS 挂起 | `docs/spike-report.md` T0.1。iframe 发不出有效 IPC，canary 只有宿主对照调用 |
| SEC-02 | Linux 通过；Win/macOS 未测 | T0.1 测试服务器在探针期间收到 0 个请求。预览 CSP 为 `connect-src 'none'` |
| SEC-03 | Linux 通过 | `AWB_SELFTEST=basic`：钥匙串只回报末 4 位；项目目录 3 个文件里搜不到 Key。`scripts/scan-secrets.mjs` 可对任意目录复检 |
| SEC-04 | Linux 通过 | 自检：读 `/etc/passwd`、`~/.ssh`、写家目录均被拒。`safeFileName` 单测覆盖路径穿越。capability 只给 main 窗口，且按命令逐项授权 |
| SEC-05 | 通过（逻辑 + Linux） | `llm.rs` 单测：公网 http、带账号的 URL 被拒；本机和局域网 http 放行。自检实测拒绝 `http://api.openai.com` |
| SEC-06 | 通过 | `vue/no-v-html` 为 error；禁止 `innerHTML` 赋值；CI 里 grep。`tests/lint-boundaries.test.ts` |
| SEC-07 | Linux 通过 | 原子写入。自检过程中 `kill -9` 五次，`storyboard.json` 每次都能解析。打开更新的 schemaVersion 会被拒绝，损坏文件可从快照恢复（`src/stores/project.test.ts`） |
| SEC-08 | 部分通过 | `pnpm audit --prod` 无 high。`scripts/check-licenses.mjs` 通过，没有 GPL/AGPL/GSAP。manim-web 锁定 0.40.1。`cargo audit` 配在 CI 里，本机没单独跑 |
| SEC-09 | 通过 | 素材包在 `<source>` 里并声明不是指令。AI 修改先进入待确认，e2e 覆盖了拒绝、接受和撤销。锁定场景不会被改（`ops.test.ts`） |

## §6 体验

| ID | 结果 | 证据 |
|----|------|------|
| UX-01 | 通过 | 自检：1 次点击打开示例，约 1.0–1.1 秒看到预览，不需要 Key |
| UX-02 | 未测 | 没有云端 API Key。本机 Ollama `qwen3.5:9b-16k` 大纲一次通过但用了 213 秒，单场景超时，不能当默认方案。见 `docs/ai-eval.md` |
| UX-03 | 通过 | 真实窗口自检，20 个场景连续改 10 次：p95 为 370 ms 和 403 ms（两次），目标 500 ms。构建本身约 115 ms |
| UX-04 | 通过 | `tests/e2e/m3.spec.ts`：待确认、拒绝后恢复、接受、Ctrl+Z 撤销 |
| UX-05 | 基本通过 | 大纲、单个场景、全部场景和修改指令都可以取消。生成中的场景在时间线上显示“生成中” |
| UX-06 | 通过 | `src/shared/errors.ts` 覆盖 10 种 AI 错误，另加权限和文件缺失。设置、导入、导出都用这张表 |
| UX-07 | 基本通过 | 空格、方向键、Ctrl+Z、Alt+方向键、`[` `]` 在 e2e 里走过。焦点在输入框里不触发 |
| UX-08 | 通过 | `tests/e2e/a11y.spec.ts`：欢迎页和工作台各面板 axe 没有 critical 或 serious |
| UX-09 | 基本通过 | 自动保存防抖 1 秒，短于 2 秒。强杀后文件仍可解析，但没有用秒表量“丢失了多少编辑” |
| UX-10 | 通过 | `tests/e2e/m3.spec.ts` 手动模式：不合格回答会进入修复轮，合格后接受并生效 |
| UX-11 | 未做 | 需要 3 名目标用户各 15 分钟，没有安排 |

## 功能抽查（Linux）

- 示例项目播放、拖进度、专家 JSON 改完 500 ms 内预览更新：`tests/e2e/m1.spec.ts`
- 不用 JSON、不用 AI 做出 3 个场景，并切换风格预设：`tests/e2e/m2.spec.ts`
- 文本生成大纲和场景（含自动修复）、自然语言修改：`tests/e2e/m3.spec.ts`（浏览器模式用假 LLM）
- PDF 中文文本层、页码范围、GBK 文本：`tests/e2e/m4-inputs.spec.ts`
- 导出的 HTML 用 `file://` 打开能播放，外部请求为 0，有错误时不能导出：`tests/e2e/m4-export.spec.ts`
- 真实 Tauri 窗口：示例、seek、文件权限、钥匙串、流式 LLM、取消、429 重试：`AWB_SELFTEST=basic`

## 安装包

本机打出了 `src-tauri/target/release/bundle/deb/Animation Workbench_1.0.0_amd64.deb`（17 MB，里面的可执行文件 44 MB，前端打进了二进制）。AppImage 没打成：构建卡在从 GitHub 下载 `AppRun-x86_64`，本机连这个地址一直 0 字节。Windows 和 macOS 的安装包没有在本机打。

## 没达到的退出标准

PLAN 要求 §5 和 §6 在 Windows 和 macOS 上全部通过。这一条没有做。Linux 上 UX-02 和 UX-11 也没有通过。
