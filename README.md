# Animation Workbench

Animation Workbench 是一个桌面应用，用来把文字、教材和代码做成 3Blue1Brown 风格的讲解动画。AI 先生成结构化的分镜，你再用时间线和检查器逐项修改，预览实时更新，最后导出一个离线可用的 HTML 文件。

当前版本是 1.0.0，支持 Windows、macOS 和 Linux。

## 安装

在 GitHub Releases 页面下载对应平台的安装包：

| 平台 | 安装包 |
|------|--------|
| Windows | `.msi` 或 `-setup.exe` |
| macOS | `.dmg` |
| Linux | `.deb`（`.AppImage` 需要构建机能从 GitHub 下载 AppRun，网络不通时打不出来） |

安装包没有代码签名。Windows 第一次运行时 SmartScreen 会拦截，点“更多信息”再点“仍要运行”。macOS 会提示“无法验证开发者”，在“系统设置 → 隐私与安全性”里点“仍要打开”。代码签名计划在后续版本加入。

Linux 版依赖 WebKitGTK 4.1。Ubuntu 22.04 及以上可以直接安装 `.deb`。

## 快速上手

第一次打开应用，点“打开示例：勾股定理”。不需要配置任何东西，就能看到一段 17 秒的动画，可以播放、拖动进度条。

做自己的动画分三步：

1. **放入素材**。点“新建项目”，选一个空文件夹。在左侧“素材”页粘贴文字，或者导入 txt、md、代码文件和 PDF。
2. **生成并修改**。切到“AI”页，点“生成大纲”。检查大纲后点“逐个生成场景”，场景会依次出现在时间线上。之后可以在时间线上拖动排序、拖右边缘调时长，在右侧检查器里改元素和动画；也可以在“用一句话修改”里输入要求，比如“把圆改成蓝色，时长延长 2 秒”。AI 的修改会先显示为“待确认”，你可以预览后再接受或拒绝。
3. **导出**。按 Ctrl+E，导出单文件 HTML。用任何浏览器打开都能播放、全屏和拖进度。

导出视频：用 Chrome 或 Edge 打开导出的 HTML，点播放器右下角的下载按钮，选择 MP4 或 WebM。

## 配置 AI

在顶部点“AI 设置”。应用支持两种用法。

**API 模式**：填写服务商和 API Key。内置的服务商有 DeepSeek（默认）、通义千问、智谱 GLM、OpenAI、Google Gemini、Anthropic Claude 和本机的 Ollama，也可以填任何兼容 OpenAI Chat Completions 的地址。Key 保存在系统钥匙串里（Windows 凭据管理器、macOS 钥匙串、Linux 的 Secret Service），界面上只显示末 4 位。

**手动模式**：不需要 API Key。每一步应用都会给出提示词，你复制到 ChatGPT、Claude 或 DeepSeek 的网页版，再把回答粘贴回来。格式不对时，应用会生成修复用的提示词，再走一遍即可。手动模式完全不联网。

AI 只会收到你选中的素材和当前分镜，发送目标是你自己配置的地址。应用没有任何遥测。

## 快捷键

| 按键 | 作用 |
|------|------|
| 空格 | 播放 / 暂停 |
| ← / → | 上一个 / 下一个场景 |
| Shift + ← / → | 后退 / 前进 1 秒 |
| Ctrl + Z / Ctrl + Shift + Z | 撤销 / 重做 |
| Ctrl + D | 复制选中的场景 |
| Delete | 删除选中的场景（会先确认） |
| Ctrl + Enter | 发送 AI 修改指令 |
| Ctrl + E | 导出 |
| Ctrl + S | 保存并写一份快照 |

焦点在时间线的场景卡片上时，Alt + ← / → 移动场景，`[` 和 `]` 把时长缩短或延长 0.5 秒。

## 项目文件夹

每个项目是一个普通文件夹，可以直接用 Git 或网盘同步：

```
我的动画/
├── project.json     # 项目名称、素材列表、生成参数
├── storyboard.json  # 分镜，唯一的数据来源
├── inputs/          # 导入素材的副本和提取出的文本
├── versions/        # 自动快照，最多保留 50 份
├── exports/         # 导出的 HTML
└── .awb/            # AI 调用日志，可以删除
```

修改会在 1 秒后自动保存。AI 修改生效前和手动保存时，应用会写一份快照。`storyboard.json` 损坏时，打开项目会提示从最新的快照恢复。

## 已知限制

- 分镜目前只支持 2D 元素。3D、图片素材、代码场景和应用内直接导出视频计划在后续版本提供。
- 导出的 HTML 约 14 MB，因为里面包含完整的动画运行时（manim-web）。
- GIF 导出暂不可用。
- 1.0.0 在 Linux 上完成了完整验收；Windows 和 macOS 通过了 CI 构建，实机测试还在进行。详见 `docs/mvp-acceptance.md`。

## 开发

需要 Node.js 24、pnpm 10 和 Rust（stable）。Linux 还需要 `libwebkit2gtk-4.1-dev`。

```bash
pnpm install
pnpm dev            # 浏览器模式：内存文件系统 + 假 LLM，适合改界面
pnpm tauri dev      # 桌面应用
pnpm check          # 类型检查、lint 和单元测试
pnpm test:e2e       # Playwright：运行时和端到端测试
pnpm tauri build    # 打安装包
```

其他常用命令：

```bash
cargo test --manifest-path src-tauri/Cargo.toml                 # Rust 单元测试
EVAL_MODELS="deepseek:deepseek-chat" DEEPSEEK_API_KEY=... pnpm eval:ai   # 评测 AI 输出的通过率
AWB_SCAN_KEY=sk-... node scripts/scan-secrets.mjs <项目目录>    # 检查 Key 是否落盘
```

debug 构建设置 `AWB_SELFTEST=basic` 后启动，会在真实窗口里自动跑一遍自检（示例项目、预览、文件权限、性能），结果打印到终端。设计文档和实施计划在 `Animation_Workbench_软件设计方案.md` 和 `PLAN.md`。

## 许可证

MIT。动画运行时使用 [manim-web](https://github.com/maloyan/manim-web)（MIT）。
