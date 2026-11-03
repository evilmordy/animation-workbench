先写整片计划，这一轮不要写场景代码。

可以先用几句话想清楚再落文件。这一轮只输出这些代码块：

- anim/plan.md：讲解怎么推进，每一场观众看到什么。
- anim/rubric.json：场景表。形如 {"title":"标题","scenes":[{"id":"s_intro","title":"标题","description":"这一场讲什么","hold":3,"enter":"fresh"}]}
- anim/shared.js：全片共用的常量。没有跨场常量就省略这一块。

不要在这一轮输出 anim/scenes/。hold 用秒，0 到 30。第一场的 enter 用 fresh。
