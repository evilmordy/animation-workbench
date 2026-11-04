# 削弱模型能力的限制审计

只读审计 `feat/agentic-codegen` @ `82dbd644`。共 36 条。本文件只记录条目和处理状态，不改运行时。

状态：

- **已处理**：本 PR 改了 agentic 链路。
- **部分**：只做了不把代码变复杂的那一部分。
- **未改**：故意留下，原因写在表里。
- **忽略**：不在产品代码里。

S8a 处理了表里标成「已处理」的较早条目。S8b 更新了 #4、#5、#9、#23。内核黑名单（schema、`build()`、预览消息语义、`stores/project`、`exportHtml` 的 CSP 模板、`samples/pythagoras`）没有改。

| # | 严重度 | 链路 | 位置 | 状态 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 1 | 致命 | 实验 | `eval/s7.eval.ts`（gitignore） | 忽略 | `max_tokens: 16000` 是评测脚本自己设的，产品代码里没有。 |
| 2 | 致命 | agentic | `src/ai/agent/loop.ts` | 已处理 | 读 `finish_reason`。空正文直接停。截断只收下闭合代码块；下一轮若和上一轮相同就停，不再打满轮次。日志里能看到原因。 |
| 3 | 致命 | agentic | `src/ai/agent/prompts/scenes.md` | 已处理 | 删掉「为整片每一个还没写的场景写函数体」。每一轮只点名一场。模型若一次写了多场，仍然收下。 |
| 4 | 致命 | agentic | `prompts/system.md` | 已处理 | 默认提示改成 GSAP：时间线必须可 seek、舞台 1920×1080、浅色字深色底、每场空 root。manim 说明只在分镜选了 manim-web 时使用。 |
| 5 | 致命 | agentic | `prompts/system.md` | 已处理 | 不新增 schema kind。Agent 在空项目上默认写 GSAP；manim-web 由设置或 `.awb/anim/renderer.json` 选择。产品默认引擎仍是 legacy。 |
| 6 | 致命 | legacy | `src/ai/prompts/outline.md` | 未改 | legacy 链路。agentic 的需求原文已经标成指令。 |
| 7 | 严重 | agentic | `src/ai/agent/parse.ts` | 已处理 | 未闭合的尾块不再扔掉：认得出路径就交回模型重发这一块，认不出就说明原因。不把半截内容写成完成的场景。 |
| 8 | 严重 | agentic | `loop.ts`、`prompts.ts` | 未改 | 历史里仍保留每一轮。逐场之后单次输出变小；把历史折成一份要改消息结构，这次不动。 |
| 9 | 严重 | agentic | `loop.ts` 默认 8 轮 | 已处理 | 默认轮次改为 24。计划 1 轮、之后一轮一场，8 轮写不完。没有另做场景数公式。面板上限仍是 32。 |
| 10 | 严重 | agentic | `run.ts` 审查 | 已处理 | 审查可以调用 `write_scene` 改一场，然后重新截帧。删掉「只说明问题、不能改」。面板上的最终一句仍只显示前 500 字；模型对话里的工具结果不截断。 |
| 11 | 严重 | agentic | `pixels.ts` 字叠 | 已处理 | 只比较两个文字框。一个框包住另一个（容器和它自己的文字）不算字叠。 |
| 12 | 严重 | agentic | `pixels.ts` 残留 | 部分 | 删掉绝对 24 像素，改成超过画面 0.5% 才判残留。连通域过滤会单独加一块算法，这次不做；收束帧对齐之后，抗锯齿碎点不再是主因。 |
| 13 | 严重 | agentic | `capture.ts` | 已处理 | 不改 `load/play/pause/seek`，也不改 `build()`。单场预览没有 `nextSlide` 时，报出的 span 往往只盖住停留段；截帧改用这次运行已经返回的时间线总长。默认截收束帧，而不是场的开头。 |
| 14 | 严重 | agentic | `run.ts`、素材 | 未改 | 这条是素材页的 `gen.source` 没进 agent。用户原始需求本来就整段放在每一轮开头，审查阶段也补上了，没有截断，也没有写成「只是素材」。素材附件另说。 |
| 15 | 严重 | legacy | `prompts/system.md`、`providers.ts` | 未改 | legacy 的 JSON 模式。 |
| 16 | 严重 | legacy | `prompts.ts` 素材预算 | 未改 | legacy。agent 的需求原文不走这个预算。 |
| 17 | 严重 | legacy | `scene.md` 的 `fresh` | 未改 | legacy。 |
| 18 | 严重 | legacy | 元素上限 | 未改 | legacy。 |
| 19 | 严重 | legacy | 大纲 description 120 字 | 未改 | legacy。 |
| 20 | 一般 | 两条 | 不传 `max_tokens` | 已处理 | 只在 agent 请求上显式传递。默认 65536，与 DeepSeek 思考模式的默认输出上限一致（思考和正文共用；不传时非思考模式只有 8K）。面板「单次输出」可改，清空则不传。上限按文档夹到 384K。 |
| 21 | 一般 | agentic | `agentTools: false` | 未改 | 默认打开会让每次生成都截帧。等这次误报修正在用过之后再单独开。 |
| 22 | 一般 | agentic | 审查共用剩余轮次 | 部分 | 删掉「审查只用写代码剩下的轮次」。审查用工具环自己的 6 轮。token 总预算用完仍不做截帧。没有新的预算字段。 |
| 23 | 一般 | agentic | DOM 框最多 40 个 | 已处理 | 上限仍是 40，文字框优先。跳过图层容器和不可见元素。没有 DOM 框时明确说布局检查不可用。GSAP 场用 DOM 包围盒。 |
| 24 | 一般 | agentic | 浅色字、黑底 | 未改 | 对比度要求先留着。 |
| 25 | 一般 | agentic | token 按字符数/4 估算 | 未改 | 估算只在服务商没回 usage 时用。 |
| 26 | 一般 | 两条 | 读超时 90 秒 | 未改 | 在 `llm.rs`，这次不改传输层超时。 |
| 27 | 一般 | 两条 | 全局 temperature | 未改 | 不按阶段拆温度。 |
| 28 | 一般 | 两条 | 默认 `deepseek-chat` | 未改 | 不按阶段拆模型。 |
| 29 | 一般 | legacy | 场景数锁时长 | 未改 | legacy。 |
| 30 | 一般 | legacy | 每段 Text 30 字 | 未改 | legacy。 |
| 31 | 一般 | legacy | 修复轮数和前 30 条问题 | 未改 | legacy。 |
| 32 | 一般 | legacy | 元素/动画白名单 | 未改 | 内核（schema）。 |
| 33 | 无害 | agentic | 只用 play/wait，禁止 `scene.add` | 未改 | 保留。这是时间线的真实约束。 |
| 34 | 无害 | 两条 | 429/5xx 重试 2 次 | 未改 | 保留。 |
| 35 | 无害 | legacy | 字数和时长上限 | 未改 | 内核（schema）。保留。 |
| 36 | 无害 | agentic | hold 0–30 秒 | 未改 | 保留。 |
