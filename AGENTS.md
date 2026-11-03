# Animation Workbench · Agent 说明

agentic 重构以 `feat/agentic-codegen` 为基线。动手前读 `docs/agentic/PLAN.md` 和 `docs/agentic/SAFE-REFACTOR.md`。根目录 `PLAN.md` 是产品设计原文，不是这条分支的施工计划。

## 内核黑名单

只许旁路，禁止破坏性修改：

- `parseStoryboard` / schema v1
- `stores/project` 的落盘与撤销（唯一入口仍是 `project.update`）
- 预览协议里已有消息的语义：`load` / `play` / `pause` / `seek` / `setRate`
- dsl 的 `interpret`、`builders`、`build()`
- `exportHtml` 的 CSP 与内联 runtime（纯 dsl 项目导出必须与改前逐字节一致）
- `samples/pythagoras`
- 边界 lint：只有 `src/runtime` 能依赖 manim-web，只有 `src/platform` 能依赖 Tauri，`src/shared` 不能碰 Vue 或 DOM

## 只加旁路

新能力用新目录、新 flag、新分支。`kind: 'code'` 已经在 schema v1 里，不要升版本。`runtime.codeScenes` 默认关；关掉之后，预览、导出和检查器回到 v1 的可感知行为。不要重写 builders，不要改勾股示例，不要删旧的 dsl 生成管线。

## PR 正文

每个 PR 固定三节，base 用 `feat/agentic-codegen`，不是 `main`：

### 做了什么

### 没碰什么

### 必跑测试

回滚顺序：关 flag，revert 单个 PR，最后才弃分支。禁止用一个更大的修复 PR 盖住内核回归。

## 必跑测试

- `pnpm check`
- `pnpm test:e2e`，至少覆盖 `m1`、`m2`、`m4-export`
- 勾股附录 A 的场景起止时间保持 `[0, 4.5]`、`[4.5, 10]`、`[10, 17]`

## S0 教训

写 `kind: 'code'` 场景时必须遵守：

- 录制期间（`player.sequence` 回调里）禁止 `scene.add`。对象会进场景但不进时间线，seek 之后全片都看得见，换场就会叠在一起。对象用 `FadeIn` / `Create` 等动画引入，换场也用动画清场。
- 不要靠 opacity 判断「看不见了」。验收要看像素（整片帧对单场帧），或确认对象已经不在场景列表里。
- 字幕和说明用高对比：浅色字，黑底。
- 跨场共享的常量（例如半径 `R`）全片只有一份取值，不能每场各写一个。
