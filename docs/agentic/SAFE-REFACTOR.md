# agentic 重构 · 防修烂指南（只读审视，2026-11-03）

- 仓库：`/workspace/awb-spike`（HEAD `2ea0806` / `v1.0.0`）
- 依据：`harness-audit/REPORT.md`、`PLAN-INPUT.md`、源码只读核对
- 原则：**加法优先、旧路径必绿、一 flag 可回滚、一个 PR 只动一层**
- 本文不写实现；不 push；不改业务代码

---

## 0. 一句话总则

Opus 烧掉的是：**Storyboard 为唯一真相 + DSL interpret/builders + Pinia 落盘/撤销 + 预览协议 + 单文件导出 + 边界 lint**。  
agentic 能做的是：**在旁边加一条生成路径**，产出仍写入已有的 `scenes[]`（优先已预留的 `kind:'code'`），**不要重写编辑器真相源**。

把「生成引擎」和「播放/编辑内核」拆开：前者可以烂了再 revert；后者一动，勾股示例、e2e M1–M4、导出 HTML 会一起坏。

---

## 1. 绝对不要先动的核心（动手前冻结）

下列文件/模块是「一改就全产品面晃」的地带。**第一批 PR 禁止重写、禁止破坏性 schema、禁止改默认行为。** 若必须碰，只允许「新增分支 / 新增可选字段 / 向后兼容扩展」。

| 层级 | 路径 | 为什么一动就危险 | 允许的触碰方式 |
|---|---|---|---|
| Schema 解析 | `src/shared/schema.ts`（`SCHEMA_VERSION=1`、`parseStoryboard`） | 旧项目打不开；所有测试夹具、示例 JSON 失效 | **保持 v1**；`kind/code` 已在 v1，勿升版本、勿改 `strictObject` 语义、勿删字段 |
| 注册表 | `src/shared/registry.ts` | DSL 表单/校验/builders 全靠它 | 不删不改既有 14 元素 / 18 动画；新引擎不进 registry |
| 语义校验 | `src/shared/validate.ts` | Issues 栏、AI 修复、落盘前闸门 | 只**追加**对 `kind:code` 的可选规则；dsl 规则不动 |
| 场景 ops / 时长 | `src/shared/ops.ts`、`timing.ts` | 时间线拖拽、复制场景、AI pending ops | 保持 `emptyScene` 默认 `kind:'dsl'`；新生成路径自己设 `code` |
| 项目落盘 | `src/stores/project.ts` | 打开/保存/撤销/快照/最近项目 | **不改** `update`/`writeAll`/`readStoryboard` 契约；旁路文件走 `anim/` 或 `.awb/`，不劫持 `storyboard.json` |
| 预览协议 | `src/shared/protocol.ts` + `PreviewPane`/`preview` store | UI 与 iframe 的唯一合同 | 新能力用**新 message 变体**（旧 iframe 忽略未知 type）；禁止改 `load/play/pause/seek/setRate` 语义 |
| Runtime 构建 | `src/runtime/index.ts` 的 `build()` | 预览与导出共用入口 | 保持签名；内部可 `if kind==='code'` 分支，**dsl 路径字节级行为不变** |
| DSL 解释 | `src/runtime/interpret.ts` + `builders.ts` | 现网唯一能播的路径；`kind!=='dsl'` 已安全 skip | **先加** `interpretCode` 旁路，再在 `interpret` 里一行分发；不要重写 `playScene` / builders |
| 导出 | `src/features/export/exportHtml.ts` + `dist-runtime/runtime.js` | CSP 哈希、离线单文件；e2e `m4-export` | 导出仍只吃 Storyboard + 同一 runtime；code 未实现时**禁止静默导出坏片**（显式报错即可），不要改 CSP/内联结构除非有单独 PR |
| 边界规则 | `tests/lint-boundaries.test.ts` + ESLint | `runtime` 独占 manim-web；`platform` 独占 Tauri；`shared` 无 DOM/Vue | 新 agent 代码放 `src/ai/agent/`，**禁止**从 features/stores 直 import manim-web / `@tauri-apps` |
| 示例夹具 | `samples/pythagoras/**` | schema/validate/timing/e2e 金标准 | 只读；回归基准，永不「顺便改示例」 |

**破坏性变更黑名单（首批绝对禁止）**

1. 把 `Storyboard.scenes[]` 改成「只剩单文件 timeline label」而时间线/检查器失联  
2. `SCHEMA_VERSION` 升到 2 且旧 JSON 无法 `parseStoryboard`  
3. 改写 `HostMessage`/`PreviewMessage` 既有字面量含义  
4. 重写 `useProjectStore.update` 的 undo/autosave 语义  
5. 为了 agent 方便，让 `shared/` 依赖 Vue/DOM 或让非 runtime 依赖 manim-web  
6. 默认关闭或删除现有「大纲→场景」管线，却还没有可播的 code 路径（用户会觉得软件坏了）

---

## 2. 可安全加法的落点

### 2.1 新目录（推荐默认落点）

```
src/ai/agent/          # 全新：loop、工具适配、plan/rubric 读写、与 generation 解耦
  index.ts
  loop.ts
  tools.ts             # 工具名 → 实现；实现可调 platform / preview 适配器
  prompts/             # 与 prompts/*.md 并列，旧 DSL prompt 不动
project 旁路（运行时写入，非 src）：
  <project>/anim/      # plan.md、rubric.json、可选 shared.js；不进 storyboard 解析
  <project>/.awb/      # 已有；可放 agent 日志、预算、会话草稿
```

- `PROJECT_DIRS` 今日为 `inputs/assets/versions/exports/.awb`。加 `anim` 时：  
  - **兼容写法**：打开旧项目时若不存在则 `mkdir`（加法）；  
  - 或先只写 `.awb/anim/`，零改 `PROJECT_DIRS`，更安全。

### 2.2 Schema / Runtime：新 kind 分支（已预留）

- Schema **已有** `kind: 'dsl' | 'code'` 与 `code?: string`（`schema.ts`）。  
- `interpret.ts:28-31` 已对非 dsl **跳过并 wait(hold)**——这是天然安全网。  
- 加法步骤：新建 `src/runtime/codeScene.ts`（或 `interpretCode.ts`），在 `interpret` 里：

```text
if (scene.kind === 'code') { await interpretCode(...); continue }
// 原 dsl 路径一字不动
```

- **契约先冻结再写解释器**（B：`async (scene, M, ctx)` 贴近 PLAN.md；或分层：整片 `anim/shared.js` + 每场 `scene.code`）。  
- 整片单文件若需要，**放 `anim/`，由适配器切回 `scenes[]` 的 id/title/hold/enter**，不要让时间线直接绑单文件。

### 2.3 Feature flag（行为开关，不是编译开关）

建议落在 `settings` 或 `GenerationParams` 旁路字段（**optional + default 旧行为**）：

| Flag | 默认 | 作用 |
|---|---|---|
| `generation.engine` | `'dsl'`（合并前）→ 稳定后可改 `'agentic'` | 选生成管线；dsl 永远可开旧项目 |
| `generation.intentAsInstruction` | `false` 直到对照实验通过 | 是否把「需求」当指令（止血项也可单独 flag） |
| `runtime.codeScenes` | `false` 直到 interpretCode + 单测绿 | UI 是否暴露 kind/code 编辑；false 时专家 JSON 手写 code 仍被 skip（现状） |

Flag off = 用户可感知行为回到 v1.0.0。**合并 main 后若翻车：先关 flag，再 git revert。**

### 2.4 UI 加法（不拆 Workbench）

| 加法 | 落点 | 不碰 |
|---|---|---|
| 「需求」输入框 | `AiPanel.vue` 增量字段 → `generation.source` 旁的 `intent` | 不改 LeftPanel 信息架构大改 |
| Agent 日志 / 取消 / 预算 | 新组件 `features/ai/AgentPanel.vue`，Tab 或折叠区 | 不重写 Timeline/Inspector |
| Code 场景检查器 | `SceneForm` 增加 kind 选择 + 只读/CodeMirror 代码区（flag 开） | Elements/Steps 对 `kind:code` **隐藏或禁用**，勿删组件 |
| 专家 JSON | 已有；继续可手写 | 不改 JsonEditor 校验入口（仍 `parseStoryboard`） |

### 2.5 LLM / Tauri 加法

- `src-tauri/src/llm.rs`：tools / 图像 content **新函数或可选字段**；默认请求体保持现网 `json_object` 行为，agent 路径显式关 json_object。  
- 不要在第一周改 `secrets.rs` / `preview_protocol.rs` 的安全边界。  
- 截帧：优先 **eval 用 Playwright（已有）**；应用内 webview 截帧单独 spike，失败则 agent 工具降级为 `check_layout` 文本 + 外置评审，不阻塞 code 场景落地。

### 2.6 旧 AI 管线处置

- `prompts.ts` / `prompts/*.md` / `generation.ts` 的大纲→并发场景：**保留**，用 flag 切换。  
- 「去 DSL 规格、去上限、intent 当指令」可做**小 PR 只改 prompt 文案与 AiPanel**，仍走 dsl 生成——这是止血，不是重构内核。  
- 禁止「删掉旧 generation 再开写 agent」的大爆炸。

---

## 3. 里程碑失败如何回滚

约定分支：`feat/agentic-codegen`（从 `main@2ea0806` 拉出）。每个里程碑对应 **可独立 revert 的 commit 组或独立 PR**。

| 里程碑 | 内容（加法） | 成功判据 | 失败回滚 |
|---|---|---|---|
| **M0 对照实验** | 仅 `harness-audit/` + `abc/` spike，**零业务代码** | 盲评表证明「整片上下文」优于「按场拆」或否证 | 删 spike 产物即可；无 git 业务回滚 |
| **M1 止血 prompt** | intent 字段 + prompt 去「只是素材」+ 可选去上限；flag | dsl 旧 e2e M3 仍绿；手动看一场生成 | `flag off`；或 `git revert` 该 PR |
| **M2 code 运行时** | `interpretCode` + 单测 + 示例 code 场景夹具；`runtime.codeScenes` 默认 false | dsl 勾股预览/导出绿；code 夹具可播 | flag 保持 false；revert M2 PR；interpret 分发一行撤掉即回到 skip |
| **M3 导出/预览兼容** | code 场景可进导出；协议若扩展仅附加 | `pnpm test` + `test:e2e` m1/m4-export 绿 | revert；导出对 code 改回「拒绝导出并提示」 |
| **M4 agent 旁路** | `src/ai/agent/*` + 写 `anim/` + 填 `scenes[].code`；`engine=agentic` 默认仍 false | 关 flag 时 UI/生成与 main 一致 | **只关 flag**；agent 目录可留着不调用 |
| **M5 工具闭环** | tools：文件限 anim/、render_frames、check_layout；llm tools | 无工具时 loop 仍能一次性写 code | 工具调用 feature 子 flag；revert M5，M4 降级为无工具单次生成 |
| **M6 UI 打磨** | AgentPanel、code 检查器、预算显示 | 隐藏入口则与旧 UI 无异 | revert UI PR；不碰 runtime |
| **M7 eval** | rubric 冻结 + 独立评审脚本（可仍在 repo 外/tests/eval） | 不阻塞产品 | 删 eval 配置即可 |

**回滚优先级（由快到慢）**

1. **Flag off**（分钟级，用户侧恢复）  
2. **Revert 单个 PR**（小时级，分支历史清晰）  
3. **整分支弃用**，main 从未合入则用户零感知  
4. 禁止用「再推一个大修复 PR」掩盖；先回滚再重来

**合并 main 的门槛（防修烂门禁）**

- `pnpm check`（typecheck + lint + unit）绿  
- `pnpm test:e2e` 至少：`m1`、`m2`、`m4-export`、打开 `samples/pythagoras` 可 seek  
- 手测：旧 dsl 项目打开 → 改坐标 → 导出 HTML 可播  
- `engine` 默认值变更必须单独 PR，且可热关

---

## 4. 建议的 PR 粒度

每个 PR 标题建议带 `[agentic]`；正文固定三节：**做了什么 / 没碰什么 / 必跑测试**。

### PR-0 · 对照实验（可不进 main，或只合 `harness-audit` 文档）

| | |
|---|---|
| **做了什么** | 祖暅同一需求：整片单文件 vs 按场拆；盲评；结论写入 `harness-audit/` |
| **没碰什么** | 全部 `src/`、`src-tauri/` |
| **必跑** | 无；或仅 dump prompt 的 vitest |

### PR-1 · Feature flag 骨架 + 「需求」字段（UI 接线，默认旧行为）

| | |
|---|---|
| **做了什么** | settings/`GenerationParams` 增加 optional `engine`（默认 `dsl`）；AiPanel 增加需求框但默认仍当素材或双重写入；文档一行 |
| **没碰什么** | runtime、schema 形状、protocol、export、builders、project store 逻辑 |
| **必跑** | `pnpm test`；e2e `m3`（AI 面板不崩） |

### PR-2 · Prompt 止血（仍 dsl）

| | |
|---|---|
| **做了什么** | 改 `outline.md`/`scene.md`/`prompts.ts`：intent 当指令；去掉或软化「只是素材」；去掉元素上限/TYPE_HINT（可留开关） |
| **没碰什么** | `system.md` 可先保留 DSL 规格（避免一次改太猛）；runtime 全不动 |
| **必跑** | `src/ai/prompts.test.ts`；`pnpm test`；快照若有则更新并人工看 diff |

### PR-3 · code 场景运行时（B 优先：manim-web JS）

| | |
|---|---|
| **做了什么** | 新增 `runtime/codeScene.ts`；`interpret` 一分发；单测 + 最小 fixture；flag `runtime.codeScenes` |
| **没碰什么** | `builders.ts` 的 dsl 映射表；`exportHtml` 结构（若尚未支持则导出仍拒 code）；protocol 字面量 |
| **必跑** | `pnpm test`；`tests/runtime`；手测 dsl 勾股；code fixture 预览 |

### PR-4 · 导出支持 code（独立）

| | |
|---|---|
| **做了什么** | 确认 `dist-runtime` 含 interpretCode；导出含 code 的 sb；必要时 e2e 一条 |
| **没碰什么** | CSP 策略大改；AI；Pinia |
| **必跑** | e2e `m4-export`；导出 HTML 离线打开 |

### PR-5 · `src/ai/agent/` 最小 loop（无工具或假工具）

| | |
|---|---|
| **做了什么** | 新目录；从 intent+素材写 plan + 每场 code；`project.update` 只经现有 ops；`engine=agentic` 才入口 |
| **没碰什么** | 旧 `generation.generateOutline/Scenes` 删除；llm.rs；interpret |
| **必跑** | unit + 关 flag 后 e2e m1/m2/m3 |

### PR-6 · llm tools / 图像（Tauri）

| | |
|---|---|
| **做了什么** | `llm.rs` 可选 tools；TS 适配；限路径 anim/ |
| **没碰什么** | secrets 存储格式；preview_protocol 安全模型 |
| **必跑** | Rust 单测；前端 mock transport 单测；手动 cancel |

### PR-7 · render_frames / check_layout

| | |
|---|---|
| **做了什么** | 工具实现；eval 可先用 Playwright |
| **没碰什么** | 默认预览 UX；protocol 可扩展但旧消息不变 |
| **必跑** | 工具单测；dsl 回归全绿 |

### PR-8 · UI AgentPanel + code 检查器

| | |
|---|---|
| **做了什么** | 展示日志/预算；SceneForm 暴露 kind/code（flag） |
| **没碰什么** | Timeline 拖拽算法；JsonEditor 核心 |
| **必跑** | e2e 冒烟；a11y 不崩 |

**刻意不要出现的 PR 形态**

- 「一口气：换 schema + 重写 interpret + 新 UI + 删旧 AI」  
- 「顺便重构 Pinia / 重写 PreviewPane」  
- 「升级 SCHEMA_VERSION 迁移所有示例」  
- 「引入 GSAP 替换 manim-web 作为默认」与「agent loop」绑在同一 PR（C 引擎单独里程碑）

---

## 5. 对照实验是否必须在改软件之前用 spike 完成？

**必须。且必须不改仓库业务代码。**

### 5.1 为什么必须先做

REPORT §6–§7 里「B/C 瑕疵 = 按场拆 + 无视觉闭环」仍是**推断**。若推断错了：

- 你可能花 1–2 周做 agent 工作区，却发现根因是模型数学/3D API 用法，而不是 harness；  
- 或者根因只是「intent 被降级 + 无截帧」，用 **PR-1/PR-2 止血** 就够，不必上完整 agent。

用户目标是「尽早找到降智原因」，不是「尽早合并大分支」。对照实验是唯一便宜的否证手段。

### 5.2 实验设计（仍在 `/workspace/awb-spike/abc` 或 `harness-audit/`，只读业务树）

| 项 | 做法 |
|---|---|
| 题目 | 同一「祖暅求球体积」需求原文（intent 明确当指令） |
| 变量 A | 按场拆（复现现网 / 旧 spike B 结构） |
| 变量 B | **整片单文件**，模型可见全文，允许 `enter:keep` 语义或连续 timeline |
| 控制 | 同一模型、温度、库（建议先 B=manim-web JS，与拟选引擎一致）；生成者与盲评者分离 |
| 度量 | 已有 `rubric-zugeng.md`；盲评 mp4；可选 `check.py` 数值 |
| 禁区 | 不改 `src/**`、`src-tauri/**`；不 push；不把实验代码当产品默认路径 |

### 5.3 实验结论如何闸门后续 PR

| 结果 | 下一步 |
|---|---|
| B（整片）明显优于 A（拆分） | 解锁 PR-5 的「整片上下文 / 串行可见」设计；PR-3 契约按映射回 `scenes[]` |
| 二者差不多，但截帧评审能抓住错图 | 优先 PR-7 视觉闭环；agent 文件工作区可延后 |
| 二者都差，且是 API/几何不会用 | 先补 code 运行时文档/示例（PR-3）与 banned patterns，而不是先上 tools |
| 仅把 intent 当指令就明显好转 | 先合 PR-1/PR-2 止血进 main（风险极低），大分支继续慢做 |

**没有 M0 结论，不启动 PR-5 及以后的业务合并。** PR-3（code 运行时）可与 M0 并行设计，但 **默认 flag off**，且不删 dsl。

---

## 6. 「最容易弄坏」清单（按风险）

若无视上文、按 agentic「大改」最容易炸的，按杀伤力排序：

1. **重写或绕开 `parseStoryboard` / 升 schema 毁旧项目** → 全部既有工程打不开  
2. **改 `build()` / `interpret` dsl 主路径或 `builders.ts` 映射** → 预览与导出同时坏，e2e 全红  
3. **改 `protocol.ts` 既有消息或 PreviewPane load 节流语义** → 时间线 seek/时长条与播放不同步  
4. **改 `stores/project.ts` 的 update/undo/autosave** → 静默丢稿、脏写、快照不可恢复  
5. **改 `exportHtml` CSP/内联方式或 runtime 打包入口** → 「能预览不能分享」或导出白屏  
6. **删旧 `generation.ts` 管线却未交付可播 code** → AI 面板空窗，用户感知为软件坏了  
7. **破坏 lint-boundaries（shared←vue、features←manim-web）** → 架构腐化，后续每个 PR 更难审  
8. **llm.rs 默认全局改 tools/关 json_object** → 旧 dsl 生成与手动模式连带异常  

（正式「最高风险 5 条」见文末回报；此处 6–8 供评审时盯 diff。）

---

## 7. 给执行者的检查口令（每个 PR 打开前默念）

1. 这个 diff 能否用 **flag off** 让行为回到 v1？不能 → 拆 PR。  
2. `samples/pythagoras` 是否仍可打开、seek、导出？不能 → 禁止合并。  
3. 是否只新增文件/分支，而不是改 dsl 主路径？不是 → 重写方案。  
4. 是否动了 schema 版本或 project store 核心？是 → 停，改旁路。  
5. M0 对照结论是否已经写进 `harness-audit/`？没有 → 不要合 agent loop。

---

## 8. 与上一版计划的校正（防 Grok 修烂）

| 原计划易激进点 | 校正 |
|---|---|
| 一上来就 agent 工作区 + 工具 + 换运行时 | 先 M0 spike，再 PR-3 code 旁路，再 agent；工具最后 |
| REPORT 单文件 `scene.js` 取代 scenes[] | **否**；单文件最多当 `anim/` 源，适配器写回 `scenes[]` |
| 弃用 DSL 生成即删代码 | **否**；flag 隐藏；dsl 只读打开永久保留到 code 稳定多个版本 |
| 先上 GSAP（C） | **否**；先 B 少动 runtime；C 另分支另里程碑 |
| 改 protocol 做截帧 | 先 Playwright eval；应用内截帧单独验证后再扩展消息 |
| 11–20 天大包干 | 拆成上表 PR-0…8；任一失败只 revert 一片 |

---

*本文件路径：`docs/agentic/SAFE-REFACTOR.md`*
