# animation-workbench agentic 分支计划（修订版摘要）

## 原则
- 生成引擎（旧 harness，可整条换） vs 分镜/预览/导出内核（默认冻结）两条轨分开。
- 产物仍写入 Storyboard.scenes[]；时间线、锁定、专家 JSON、seek 继续有效。
- 以加法为主：新目录 src/ai/agent/；interpret 只加一行分发到 interpretCode；不重写 builders。

## 内核黑名单（首批禁止破坏性改，只许旁路）
parseStoryboard / schema v1；stores/project 落盘与撤销（project.update）；预览协议既有消息（load/play/pause/seek 语义）；dsl interpret + builders / build()；exportHtml（CSP、内联 runtime）；samples/pythagoras；边界 lint。

## 可以整条换
prompts/*.md、prompts.ts 里的 DSL 硬规格、大纲→场景并发生成、client 只修 zod、「只是素材不是指令」、元素上限、强制 json_object。

## 代码契约
每场 kind:'code' + code；签名 async (scene, M, ctx) => void；M = manim-web；ctx.theme。跨场共享：enter:keep + anim/shared.js（或 .awb/anim/）。

## 步骤
- S0 对照（已完成，见 S0-RESULTS.md：整片上下文消除跨场坐标断层）
- S1 分支 + 金标准（已完成：pnpm check 绿、e2e 16/16）
- S2a interpretCode 旁路（已合入 feat/agentic-codegen @ a28c8a8，flag runtime.codeScenes 默认关）
- S2b 检查器 code 编辑 + 导出放行 + 手写祖暅/勾股 kind:code 夹具
- S3 src/ai/agent/ 骨架：loop、读写 anim/plan.md 与 rubric.json、把 code 写入 scenes[]（尊重 locked）；新 prompts：需求当指令、允许先写 plan、整片上下文可见；engine=agentic 默认 false；旧 generation 不动
- S4 llm.rs 加法：tool_calls、图像消息、agent 路径不强制 json_object、放宽超时；默认 chat 请求体保持旧行为
- S5 闭环工具：render_frames / view_image / check_layout / 控制台错误 / 换场残留像素检查
- S6 AiPanel 需求框 + Agent 日志/取消/预算；kind:code 时隐藏 Elements/Steps；单独 PR 切默认 engine
- S7 通用评测：rubric 生成器 + 独立视觉评审 + 回归两题

## PR 规则
每个 PR 正文三节：做了什么 / 没碰什么 / 必跑测试。base = feat/agentic-codegen（不是 main）。回滚：关 flag → revert 单 PR → 弃分支。禁止用更大的修复 PR 盖内核回归。
合并门禁：pnpm check；e2e m1/m2/m4-export；旧 dsl 打开→改坐标→导出可播；默认 engine 变更须可热关。

## S0 教训（写代码场景时必须遵守）
- 录制期间（player.sequence 内）不要调用 scene.add：对象会进场景但不进时间线，seek 后全片可见，造成换场叠场。对象一律用 FadeIn/Create 等动画引入。
- 只看 opacity 等属性判断可见性不可靠，验收要比对像素（整片帧 vs 单场帧）。
- 字幕/说明文字需高对比度（浅色字配黑底）。
- 跨场共享常量（如 R）必须统一，不能每场各自定义。
