# Animation Workbench · Agent 说明

v2 以 `feat/agentic-codegen` 为基线。每个 PR 开工前读 `docs/agentic/DESIGN.md` 的 §0、本 PR 对应的小节，以及本文件。复盘在 `docs/agentic/POSTMORTEM.md`。回归题见 `docs/agentic/EVAL.md` 和设计书 §11。

`docs/agentic/PLAN.md`、`docs/agentic/SAFE-REFACTOR.md` 和根目录 `PLAN.md` 是上一轮的计划与产品原文，不是 v2 的施工计划。

## 内核黑名单

只许旁路，禁止改语义。唯一解冻的是设计书 §3.1 标出的 manim-web 渲染依赖，只在 PR-9a、PR-9b、PR-9c 里动。其余冻结。要碰冻结部分就停下，在 PR 描述里写明原因，等人决定。

- `parseStoryboard` / schema v1（`src/shared/schema.ts`）：不升版本、不加必填字段。agent 状态放 `.awb/anim/`，不进 `storyboard.json`。`kind: 'code'` 已经在 v1 里。
- `stores/project` 的落盘与撤销：唯一写入口仍是 `project.update`。agent 一次工具写入 = 一次 `update` = 一步撤销。
- 预览协议已有消息的语义：`load` / `play` / `pause` / `seek` / `setRate`（`src/shared/protocol.ts`）。新能力加新消息类型。`ready` 里的 `manimWebVersion` 按 §3.1 在 PR-9c 删除，其余字段不动。
- DSL 的数据格式：`registry.ts`、`timing.ts` 的时长算法不改。`kind: 'dsl'` 仍要能解析。`interpret.ts`、`builders.ts`、`runtime/index.ts` 的 manim 渲染已解冻，改由运行时转译，不在 PR-9b、PR-9c 之外提前动。
- `exportHtml` 的 `assembleExportHtml`：CSP 指令和内联结构不改。内联的运行时包在 PR-9c 从 manim 的 `runtime.js` 换成 anime 运行时。
- `samples/pythagoras/storyboard.json` 只读、不改写。场景起止 `[0, 4.5]`、`[4.5, 10]`、`[10, 17]` 仍是硬回归。
- 边界 lint：只有 `src/platform` 能依赖 Tauri，`src/shared` 不能碰 Vue 或 DOM。manim-web 那条在 PR-9c 改成只有 `src/runtime` 能依赖 `animejs`、`three`、`katex`，并且 `src/ai/agent` 不能 import 这三个。

## 删除优先

新逻辑换掉旧逻辑时，旧逻辑在同一个 PR 里删掉。不留兼容层、旧路径备用、默认关的新路径。删什么见 `docs/agentic/DESIGN.md` §9。

一次只做一个 PR，范围以设计书 §10 为准。只开 PR，不合并。base 用 `feat/agentic-codegen`，不是 `main`。每个 PR 要能单独 revert。禁止用一个更大的修复 PR 盖住内核回归。

## PR 正文

每个 PR 固定五节：

### 做了什么

### 删了什么

写清删了什么、为什么删。删除清单里标给这个 PR 的项，必须在同一个 PR 里删干净。

### 没碰什么

### 对应审计项

36 条限制审计里的编号，或设计书 / 复盘的章节号。

### 必跑测试

新增明显多于删除时（新增 > 删除 × 3，且新增 > 300 行），再单列一节「为什么新增多」，说明新增的每个文件是干什么的。

## 必跑测试

- `pnpm check`
- `pnpm test:e2e`，至少覆盖 `m1`、`m2`、`m4-export`、`anime-renderer`
- 勾股示例场景起止时间保持 `[0, 4.5]`、`[4.5, 10]`、`[10, 17]`

## 回归题

固定 5 题，细则在 `docs/agentic/EVAL.md` 和设计书 §11：祖暅原理、线性代数（矩阵变换 / 向量）、归并排序、Transform 的数学原理与实现、心理学小知识。机器初筛必过，人再看完整视频终审。

## 禁用写法

代码场禁止的写法和原因见 `docs/agentic/DESIGN.md` §4.5。运行门命中即 `BANNED_API` 并报行号。
