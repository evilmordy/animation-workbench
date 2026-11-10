# animation-workbench 第一版复盘：为什么大失败，哪些值得留

写于 2026-11-09（太平洋时间）。范围是两段代码：

- **v1.0.0 legacy 管线**（Opus 写的初版，`main@2ea0806`）：大纲 → 并发逐场生成 DSL JSON → zod 修复。
- **agentic 第一版**（`feat/agentic-codegen` 上 S2a–S8b，PR #1–#12，最后一次合入是 PR #12，2026-11-09 20:15 太平洋时间）：Agent 写 `kind:'code'` 场景，S8b 起默认 anime.js 4.5.0。

证据都来自能翻到的材料：只读审计 `awb-brief/REPORT.md`（2026-11-02）、36 条限制审计 Page、S0/S7 盲比、S8c 初筛 `awb-s8c/out/REPORT.md`、S8d 消融 `awb-s8d/REPORT.md` 和 `out/aggregate.json`、产品快照 `awb-s8d/product`（S8c 基线是 `21cd413`，S8d 在它上面加了原型改动）、GitHub PR 元数据。查不到的地方单独标出来了。

---

## 0. 结论先说

1. 最大的问题不是模型笨，是 harness 让模型**写完看不到、看到改不了、改了没人验**。桌面端甚至没有截帧后端（A10），闭环只在 eval 里存在过。S8d 里只把「写完自动体检、把图和报告塞回去、逼它改」这一件事做对（A → A1），后向 seek 和布局就开始成片下降；再给运行时 helper 和一份别题范例（B、C），C/祖暅拿到了全实验唯一一次机器 PASS。
2. 第二大的问题是**渲染库选错**。manim-web 0.40.1 语料少，模型按 Python manim 猜 API；非数学题材硬套黑板风也难看。换成 anime.js 之后，上限来自 anime.js 自己的坑（同属性多段 `[起点,终点]` 往回 seek 不复原、`loop: true`），这些坑可以在运行时一次堵住。
3. 第三是**流程和代码治理**：每发现一个问题就加一个开关、一个检查器、一个阶段，新增远多于删除，最后形成「两套协议 + 四个开关 + 六个检查工具」的结构，越修越难判断哪一层在起作用。
4. 内核这块写得好：分镜是唯一真相，seek、锁定、手改一场、hold、导出、撤销全部围着它转。这次失败没有一条根因落在内核里，重做时要原样保住。

---

## 1. 失败根因（分层）

### 1.1 架构 / harness 层

| # | 根因 | 证据 | 后果 |
|---|---|---|---|
| A1 | **两套协议并存**：写阶段只收 markdown 围栏代码块（`parse.ts` 抽 ```` ```file:anim/... ````），审阅阶段才有 tool_calls（`frames.ts` `runVisionReview`）。两段由 `run.ts` 串起来：`runAgent` 返回 `done` 之后才进 review。 | 快照 `run.ts:83` `runAgent(...)` → `run.ts:95` `if (... !agentToolsEnabled(settings.runtime.agentTools)) return result` → `run.ts:105` `runVisionReview(...)`；`loop.ts:95` 注释原文「没有 tool_calls，模型只按代码块交卷」 | 写的时候模型拿不到任何画面反馈；看的时候又换了一套输出规则。模型要学两种交卷方式，解析器要维护两套容错。 |
| A2 | **闭环默认关**：`settings.runtime.agentTools` 默认 `false`。 | `src/stores/settings.ts` 第 52 行 `agentTools: false`；审计 #21 | 产品默认情况下，模型从来看不到自己画出来的东西。写完即开环。 |
| A3 | **开了闭环也是「只看不改」**：review 最初只有 render/check 工具，没有写工具（审计 #10，S8a 才加 `write_scene`）；S8a 之后有了写工具，但不自动给体检结果，靠模型自己想起调用。 | S8d 臂 A（`agentTools=true`，6 轮）：四道写成的题 `write_scene` 调用 0 次，`view_image` 8–12 次（`out/A/*/run.log.jsonl` 计数），20/21 次成功生成以 `max_rounds` 停 | 轮次烧在截图和看图上，到上限交卷。A 臂布局和后向 seek 相对 S8c 没有稳定改善。 |
| A4 | **循环不读 `finishReason`**（第一版 `loop.ts:140-153`）：截断或空正文被当成没交卷，原样重发同一条请求。 | 审计 #2；S7 里 13 次请求 10 次为空或截断；S7 第 3 组 mergesort 两次 12 轮全部 `finish=length` 且正文为空（`awb-brief/s8b/blind-test-notes.md`） | 白烧轮数直到 budget 停止，场景没写出来。S8a（PR #9）修了：读 `finish_reason`，空正文直接停，同一请求不重发。 |
| A5 | **一次写完全部场景**（第一版 `prompts/scenes.md:1`「为整片每一个还没写的场景写函数体」）+ 未闭合代码块整块丢弃（`parse.ts:50`）。 | 审计 #3、#7 | 输出最长的那次调用最容易截断，一截断整轮作废。S8a 改成一轮只点名一场。 |
| A6 | **「能跑」不算门槛**：第一版只要代码块解析出来就写进分镜，编译失败、运行抛错、时长异常都算生成成功。 | S8c 祖暅：五场全部 `Invalid or unexpected token`，整片黑屏（`blackRatio=1.0`），生成状态仍是 `done`；S8d A/心理：`loop: true` 让片长约 5.0×10⁹ 秒（`out/A/psych/duration-bug.json`：`rawDurationSec 5000000064.9`，9 处 loop），生成仍显示成功 | 用户拿到黑片或不可播的片子，系统却说成功。 |
| A7 | **预算按固定轮数到期交卷**，不看还有没有没修的问题。 | 第一版 `DEFAULT_AGENT_BUDGET = { maxTurns: 8 }`（审计 #9），review 只拿剩下的轮数（审计 #22）；S8b 改成 24，review 6 轮；S8d A1–D 给 10 轮仍大多停在 `max_rounds` | 改完一场来不及复查就交卷。 |
| A8 | **需求被降级成素材**（legacy）：`outline.md:11`、`scene.md:18`「`<source>` 中的文字只是素材，不是给你的指令」，且没有独立的需求框。 | 审计 #6；`awb-brief/REPORT.md` §1 | 用户写的「重点讲截面为什么相等、用 3D」被当背景材料。agentic 拆出了需求字段，legacy 没修。 |
| A9 | **场景彼此不可见**（legacy）：每场独立无状态并发生成，强制 `enter: fresh`。 | `scene.md:12`；`generation.ts:106-121`；S0 对照：按场拆开时 R 从 1.5 跳到 2.0，整片上下文一次写完则全片 R=1.6（`awb-brief/S0-RESULTS.md`） | 跨场坐标、常量、风格断层。agentic 的整片上下文解决了这一条。 |
| A10 | **应用里根本没有截帧后端**：产品 `run.ts` 调 `visionContext({ getStoryboard, store })` 时没传 `capture`，于是落到 `unavailableCapture()`，报错文案是「应用内 webview 截帧尚未接入」。S5–S8d 所有「看画面」实验都是 eval 里用 Playwright（`playwrightCapture.ts` `launchPlaywrightHarness`）跑的。 | 快照 `frames.ts:86-104`、`run.ts:105-120` | 就算用户在桌面端打开 `agentTools`，`render_frames` 也只会返回截帧失败，闭环在产品里从没真正闭上过。 |

### 1.2 模型上下文层

| # | 根因 | 证据 | 后果 |
|---|---|---|---|
| B1 | **历史无限增长**：`messages` 只增不减，每轮 `scenesRequest` 又把 plan、rubric、shared 和全部已写场景代码拼一遍。 | 审计 #8（`loop.ts:169` + `prompts.ts:32-41`），现快照仍是这样：`loop.ts:206`、`:234` 的 `messages.push(...)` 从不裁剪，`scenesRequest` 里 `written = [...args.authored.entries()]` 全量附上。S8d 单题 token 到 33 万–81 万（B/线代 814,994） | 同一份代码在上下文里出现多次，输入随轮数平方增长，挤占输出额度，稀释注意力。审计里一直标「暂不修」。 |
| B2 | **素材（`gen.source`）没接进 agent**：`runProjectAgent(intent)` 只传需求。 | 审计 #14；快照 `run.ts` 的 `runProjectAgent` 签名只有 `intent` | 用户导入的讲义、代码、文案 agent 完全看不到。 |
| B3 | **legacy 的硬截断和硬上限**：素材 6000 字、大纲描述 120 字、元素数 ≤ 6、场景数锁死、只许输出 JSON。 | 审计 #15–#19、#29、#30 | 设计信息在每一步被压缩丢失；不允许先想再写。 |
| B4 | **prompt 不给库的真实 API 和坑**：system.md 只列 8 个 manim-web 类，其余「用 manim-web 的导出名」。 | 审计 #4 | 模型按 Python manim 习惯猜。 |
| B5 | **说明文字和代码混在一个块里**：模型把「这一轮只出计划…」这种中文句子写进 `shared.js`，`withShared` 又把 shared 原样拼进每一场。 | S8c 祖暅根因（`awb-s8c/out/REPORT.md`），整片黑屏 | 一处错误放大成全片黑屏。S8d 原型在 `apply.ts` `syntaxError` 里加了「疑似这一行」提示。 |
| B6 | **路径标记格式脆弱**：模型写裸 `file:anim/plan.md` 而不是围栏信息行，解析器认不出，重试提示和上一轮一样，卡死检测直接停。 | `awb-brief/s8c-file-marker-repro/README.md`；PR #12 补了裸标记解析（+75/−2） | 每多一种模型写法就要补一条解析规则，是文本协议的固有问题。 |

### 1.3 渲染库层

| # | 根因 | 证据 | 后果 |
|---|---|---|---|
| C1 | **manim-web 0.40.1 语料少**：Brace 方向、Transform 点数不匹配、seek 后文字丢失、录制期 `scene.add` 不进时间线等坑 prompt 一个没提。 | 审计 #4、#33；`AGENTS.md`「S0 教训」整节都是 manim-web 坑 | 模型精力花在猜库上。 |
| C2 | **所有题材只能用 manim-web，强制浅色字黑底**。 | 审计 #5、#24；用户 2026-11-03 反馈心理学题用 manim 风格不好看 | S7 盲比（`awb-blind/mapping.json`，mergesort / psych 各四组）：manim-web 两组在两题都垫底（审计 #5 记录）。 |
| C3 | **canvas 渲染让检查器失明**：manim-web 画在 canvas 上，几乎没有 DOM 框，布局检查只剩「边缘像素 > 8%」。 | 审计 #23 | 出界、字叠查不出来。 |
| C4 | **GSAP 许可证不能用**。S7 实验用过 GSAP，S8b 撤回，钉死 `animejs@4.5.0`，`scripts/check-licenses.mjs` 禁 gsap。 | PR #11 描述；`check-licenses.mjs` | 浪费了一轮手写对照（不能拿 GSAP 手写当 S8c 对照）。 |

### 1.4 运行时坑（anime.js 4.5）

| # | 坑 | 证据 | 现状 |
|---|---|---|---|
| D1 | **同一元素同一属性多段补间都写 `[起点, 终点]`**，往回 seek 落进两段之间时不恢复起点。 | S8c 四道能跑的题后向 seek 全部失败（线代 37/83、归并 10/110、Transform 40/101、心理 34/92），手写同标准全过；失配集中在每场前段和切场附近 | 手写 `shared.js` 的 `tw()` 能处理（第一次保留起点并写进初始状态，之后只用终点）；S8d B 臂把它做成 helper，模型用了的题后向明显下降（线代 → 0/101，Transform 38 → 4）；D 臂 `seek-guard.js` 包 `tl.add`，离线回放 C/线代 46/110 → 0/110，但重新生成并不稳定胜过 C。 |
| D2 | **`loop: true`** 让每场时间线约 10⁹ 秒，整片约 5×10⁹ 秒。 | S8d A/心理 `duration-bug.json` | 运行门没拦，生成显示成功。 |
| D3 | **`onUpdate` / 对象动画路径**不经过 guard。 | S8d 报告 §6：guard 修不了 A1 祖暅（10/83 不变），S8c 线代只从 37 降到 27 | 需要禁用或给出 seek 纯函数的写法。 |
| D4 | **helper 名字重复声明**：helper 前缀接在 shared 前面，场景里再 `const W` 就报「已声明」。 | `helpers.md` 原文提醒「不要再定义同名的 const」 | 靠 prompt 提醒，不稳。 |
| D5 | **shared 和 helper 被烘进每一场的 `code`**（`withShared`）。 | 手写 `hand-anime/zugeng/storyboard.json` 每场 `code` 都以「公共工具」开头 | 检查器里手改一场要面对几 KB 前缀；改 shared 要重写所有场。 |

### 1.5 流程与代码治理

| # | 问题 | 证据 |
|---|---|---|
| E1 | **新增远多于删除**。每个阶段都在旁边加一层，旧层不删。 | GitHub 统计：PR #5（S3 骨架）+1246/−29；PR #7（S5 闭环工具）+1626/−12；PR #9（S8a）+550/−76；PR #11（S8b）+1250/−103（40 个文件）；PR #12 +75/−2。 |
| E2 | **开关越叠越多**：`generation.engine`（legacy/agentic）、`runtime.codeScenes`、`runtime.agentTools`、`runtime.codeRenderer`（anime/manim），外加项目旁路 `.awb/renderer.json` 和 `resolveAgentRenderer` 的三段兜底逻辑。 | `src/stores/settings.ts` 第 34–60 行；`src/ai/agent/renderer.ts` |
| E3 | **检查器越堆越多**：`render_frames`、`view_image`、`check_layout`、`check_residual`、`check_seek`、`console_errors`、`write_scene` 七个 review 工具，外加 S8d 原型 `reviewReport` 自动体检、`verify` 运行门。S8d 报告结论：「不要再堆新检查器……问题是默认关着、或开了却不自动跑、或跑了却不改代码。」 | `frames.ts` `visionTools`；S8d 报告 §最小改动清单第 6 条 |
| E4 | **检查器误报逼模型改不存在的问题**：容器与自身文字算字叠（#11）、残留 24 个绝对像素（#12）、截帧时间对不齐让 S7 归并 7 场里 6 场 suspect（#13）。S8d 里 SVG 满屏网格线顶到画布边被算「非文字出界」，D/线代画面清楚、数字正确，仍因 17 处网格线官方 FAIL。 | 审计 #11–#13；S8d 总表 |
| E5 | **实验驱动自设限制被误当产品问题**：`max_tokens: 16000` 在本地 eval 驱动里，不在产品代码里。 | 审计 #1（更正项） |
| E6 | **合并流程**：PR #9 在 CI 跑完前就被自动合并（私有免费仓库不能设 required checks）；后台合并脚本 `merge-when-green.sh` 中断无输出。 | 审计页 S8a 节；用户记忆 2026-11-03 |
| E7 | **S8d 原型只活在 eval 里**：`prelude` / `systemExtra` / `verify` 是 `loop.ts` 的可选参数，产品 `run.ts` 没传，只有 `eval/s8d.eval.ts` 在用。 | 快照 `run.ts` 调 `runAgent` 时没有这三个参数 |

---

## 2. 实验数据摘要（重做的依据）

S8d 五题 × 六臂，模型 `deepseek-chat`，温度 0.3，单次 `max_tokens` 65536，2026-11-09 20:59–22:00 太平洋时间（报告原文记北京时间 11-10 12:59–14:00）。官方 PASS = 布局、残留、同毫秒、后向、乱序、导出、控制台全过且黑屏比 ≤ 0.1。

| 臂 | 相对上一臂多了 | 机器 PASS | 后向 seek 宽松线通过的题 | 一句话 |
|---|---|---:|---|---|
| S8c | 基线（闭环关、无运行门） | 0/5 | 祖暅「通过」无意义（黑帧比黑帧） | 祖暅全黑，其余布局和后向都不过 |
| A | 运行门 + 闭环开 6 轮 | 0/5 | 祖暅 | 零次改写；Transform 没写成；心理 `loop:true` |
| A1 | 先自动体检再交模型，10 轮 | 0/5 | 心理 | 每题 4–12 次改写，最关键的一档 |
| B | + 运行时 helper | 0/5 | 祖暅、线代 | 用了 `tw` 的题后向下降；B/线代 124 处字叠 |
| C | + 别题手写范例 | **1/5（祖暅）** | 祖暅、归并、Transform | 综合最好，仍不稳（C/线代 0 次 `tw`） |
| D | + `seek-guard` | 0/5 | 祖暅、线代 | 没有稳定胜过 C |
| 手写 | — | **5/5** | 全部 | 质量杠 |

用户 2026-11-09 看完 S8d 五条推荐视频（C 祖暅、C 心理、C Transform、D 线代、A1 归并）后的判断：质量已逼近 DeepSeek 网页版；决定裁掉 manim-web，渲染栈定为 anime.js + three.js。

---

## 3. 可取之处（保留什么、为什么）

### 3.1 分镜内核（冻结，原样保留）

| 保留项 | 位置 | 为什么 |
|---|---|---|
| 分镜是唯一真相 | `Storyboard.scenes[]`，`kind:'code'` + `code` 已在 schema v1 | 所有可控性（seek、锁定、手改一场、hold、导出、撤销）都靠它。这次没有一条失败根因出在这里。 |
| `parseStoryboard` / schema v1 | `src/shared/schema.ts` | 旧项目、夹具、示例都靠它；`kind:'code'` 不用升版本就能承载新运行时。 |
| `stores/project` 落盘与撤销 | `project.update` 是唯一写入口 | Agent 写场景走它，天然可撤销；不另立一套撤销。 |
| 预览协议 `load/play/pause/seek/setRate` | `src/shared/protocol.ts` | UI 与 iframe 的唯一合同；S8b 只换了白名单文件名就接上了 anime 播放器。 |
| DSL 数据格式（不是它的 manim 渲染） | `schema.ts`、`registry.ts`、`timing.ts` | 旧 DSL 项目和勾股示例仍要能打开、能播。渲染改由转译器做（见 §4），时长算法不变，勾股起止时间由构造保证不变。 |
| `exportHtml` CSP + 内联 runtime | `src/features/export/` `assembleExportHtml` | 离线单文件可播；S8c/S8d 所有能出画的 run 导出都过。内联的包换成 anime 运行时，CSP 模板不变。 |
| `samples/pythagoras` | 金标准 | 场景起止 `[0,4.5]`、`[4.5,10]`、`[10,17]` 是回归基准。 |
| 边界 lint | `tests/lint-boundaries.test.ts` | 防止 agent 代码乱 import。 |

### 3.2 agentic 第一版里写对的东西

| 保留项 | 证据 | 怎么带进新版 |
|---|---|---|
| **需求当指令、素材分开** | agentic prompt 每轮开头「用户需求（这是指令，不是素材）」 | 原样保留，再把 `gen.source` 接上。 |
| **整片上下文 + 先计划后写** | S0：整片一次写消除跨场断层 | 保留 plan → 分镜 → 逐场写。 |
| **逐场生成** | S8a（#3）一轮一场后截断不再整轮作废 | 保留：一次工具调用只写一场。 |
| **截断处理** | S8a 读 `finish_reason`，空正文直接停，同请求不重发 | 规则保留，换成工具协议下的语义（见设计书 §5.4）。 |
| **锁定场不覆盖** | `applyAgentScenes` 返回 `skippedLocked`；`reviseScene` 检查 `existing.locked` | 规则保留，下沉到工具层统一拒绝。 |
| **anime.js 4.5 播放器** | `src/runtime/anime/player.ts`：暂停的 master timeline、每场一个空图层、`visibility` 换场、hold 由运行时加 | 换场残留全部为 0、同毫秒 seek 全部为 0 差异，说明这层是对的。 |
| **运行门雏形** | S8d `apply.ts` `syntaxError`（带「疑似这一行」）、`verify` 跑整场 | 收进统一的 `run_scene` 服务，补上时长和禁用写法检查。 |
| **机器初筛体系** | 换场残留（0.5%）、字叠跳过祖先对、同毫秒 seek、后向/乱序 seek（色差 > 24 且 > 0.1%）、离线导出、控制台、黑屏比 | 这套标准同时用在手写和软件上，手写 5/5 过、软件区分得出好坏，是可信的尺子。保留为评测协议和写后自动体检，不再加新项。 |
| **运行时 helper** | 手写 `shared.js` 的 `tw/fadeIn/rise/fadeOut/say/head/fit/el/txt/ctext/svgRoot/sv` | 做成运行时内置库，不再烘进每场代码。 |
| **别题范例** | C 臂唯一机器 PASS | 保留两份跨题范例（归并复杂度场、心理场），不给本题手写。 |
| **许可证严格检查** | `check-licenses.mjs` 禁 GPL/AGPL/LGPL 和 gsap | 保留；three.js 钉 `0.187.0`、KaTeX 钉 `0.19.1`，npm 上都标 MIT（2026-11-09 查）。删掉 manim-web 后 lockfile 里不再有它。 |
| **三平台 CI** | `.github/workflows/ci.yml` 矩阵 ubuntu-24.04 / windows-latest / macos-latest；PR #11 三平台全绿 | 保留，每个 PR 必须三平台绿。 |
| **file: 路径白名单** | `parse.ts` `isAnimPath`、`isFramePath`；`projectAgentHost.writeFile` 拒绝白名单外路径 | 文本解析会删掉，但「只能写 `.awb/anim/` 下固定几类文件」这条安全边界保留到工具层。 |
| **PR 三节正文 + 小 PR + 可回滚** | `AGENTS.md`「做了什么 / 没碰什么 / 必跑测试」 | 保留，再加「删了什么、对应审计项」。 |

---

## 4. manim-web 与内核黑名单的冲突（已定）

核实时发现 manim-web 不只是 agent 的代码场渲染器：

- `src/runtime/builders.ts:43`、`src/runtime/interpret.ts:1`、`src/runtime/index.ts:1` 都从 `manim-web` import。DSL 的 `interpret` / `builders` / `build()` 就是在 manim-web 上画的（14 种元素、18 种动画、MathJax 公式、`Player` 播放器）。
- `samples/pythagoras/storyboard.json` 三场全是 `kind: "dsl"`，靠这条路径播。
- `src/shared/protocol.ts:19` 的 ready 消息里有 `manimWebVersion` 字段。
- 导出内联的 `dist-runtime/runtime.js` 是 17,839,161 字节，几乎全是 manim-web 及其依赖；anime 运行时 `anime-runtime.js` 是 200,980 字节。
- 边界 lint 写的是「只有 `src/runtime` 能依赖 manim-web」。

**2026-11-09 22:34（太平洋时间）用户决定**：DSL 内核里的 manim-web 依赖一并删除。黑名单只解冻这一部分：`builders.ts` / `interpret.ts` / `runtime/index.ts` 的 manim-web 用法、`protocol.ts` 的 `manimWebVersion`、勾股示例的渲染依赖。schema 与 `parseStoryboard` 兼容、预览协议 `load/play/pause/seek` 语义、保存与撤销、`exportHtml` 的 CSP 与内联结构仍冻结。

替代方案选的是**运行时把 `kind:'dsl'` 转译成代码场**（设计书 §4.7），不在 anime.js 上重写一套 DSL 解释器：运行时只剩一套场景模型，旧文件不迁移、不改写，删得最多。分三步落地：PR-9a 裁 manim 代码场，PR-9b 加转译器，PR-9c 切换并从依赖和 lockfile 里删掉 manim-web。

manim-web 0.40.1 自己依赖 `three`、`katex`、`@mathjax/src` 等（npm 元数据），产品 `node_modules` 里现在的 three 是 0.186.1、KaTeX 是 0.19.1，都是传递依赖。新加 three.js（钉 0.187.0）和 KaTeX（钉 0.19.1，供 DSL `MathTex` 兼容）时都要显式钉版本，不能借传递依赖。

---

## 5. 核实不了或没核实的地方

- **S7 盲比的「manim-web 两组垫底」**：只在审计 #5 的文字里有记录，`awb-blind/` 下只有视频、网格图和 `mapping.json`，没有打分表文件。
- **「S7 里 13 次有 10 次为空或截断」**：出自审计 #2，原始日志没有逐条复核。
- **S8d 里的 `write_scene` 次数**：报告给出 A1 4–6、C 2–12 等「看画面改写」次数；我对 `run.log.jsonl` 做的是粗计数（日志里调用和结果各占一行），只用它确认了「A 臂 0 次」这一条。
- **DSL 转译后的观感**：manim-web 的 `Transform` 点对点变形、`TransformMatchingTex` 片段匹配不会一模一样，只能保证时长和结构一致，要你看勾股转译版确认。
- **manim 代码场的旧项目有多少**：只在实验和夹具里见过，真实用户项目里有没有核实不了。
- **three.js 和 anime.js 时间线配合做 seek 可复原**：S8c/S8d 五题都没有用 three.js，手写对照也没有。设计书里的 three.js 约定是设计，要靠 PR-10 的夹具测试验证。
- **DeepSeek 网页版的同题质量**：只有你看视频后的主观判断，没有机器数据。
- **PR #6、#8 的增删行数**没有拉，E1 只列了拉到的五个 PR。
