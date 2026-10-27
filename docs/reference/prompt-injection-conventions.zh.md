# 提示词注入约定

本页说明本插件注入模型请求的内容如何成帧。只有一个模块负责该决定：`packages/market-runtime/src/runtime/surfaces/prompt-frame.ts`。

宿主把注入内容原样传给模型，因此每个生产者为自己写入的文本负责成帧。harness 在[注入内容信封那份记录](https://github.com/deepseek-ai/deepseek-harness/blob/main/.agents/notes/archived/simplification/2026-07-20-unwrap-injected-content-envelopes.md)中定下该决定。它移除了随意的 `<steering>` 与 `<context>` 标签，因为没有模型被训练去读它们，而且有一份记录显示模型把 `<steering>` 指令当作第三方元数据而拒绝执行。

## 规则

| 规则                    | 内容                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| R1 生产者负责成帧       | 插件为自己的内容成帧，绝不依赖宿主去包裹。                                                     |
| R2 只给持久指令成帧     | `<system-reminder>` 仅用于持久、会话稳定的指令内容。临时通知、引导理由与一次性回调保持纯文本。 |
| R3 不发明标签           | 只用熟悉的框架与生态既有的强调标签。不使用 `<agent-plugins-...>`。                             |
| R4 先转义再计量         | 每个成帧正文都要转义 `</system-reminder>`，并且要在字节计量之前完成。                          |
| R5 标注贡献者           | 同一块里的两个套件必须可区分：每个贡献者一个标题，另加一句优先级说明。                         |
| R6 用户输入不成帧       | 用户编写的命令正文与用户命令面板条目永不被包裹。                                               |
| R7 段落本身就是系统权重 | 系统提示词段落用 Markdown 标题，不用框架。`renderPrompt` 只用空行连接段落，自己不加任何标题。  |

## 注入点

| 位置 | 机制 | 形式 | 原因 |
| --- | --- | --- | --- |
| `runtime/host/scoped-contributors.ts` 的 `agentInstructionSection` | `systemPrompt.section` | Markdown 段落：`## Agent plugin instructions`，每个贡献者一个 `### <套件>` | 依据 R7 与 R5。它已是系统权重，加框架等于给权重再加权重，而 `renderPrompt` 本身不提供结构。 |
| `runtime/surfaces/extension-hooks.ts` 的 `contextFrom(…)`，用于 `SessionStart` 与 `UserPromptSubmit` | `agent.inject` 或进入步骤的消息 | 成帧，首行为 `<事件> hook.`，每个贡献者一个 `### <套件>`，并转义 | 依据 R2、R4、R5。这是持久会话指令，而事件名正是让模型区分会话起始规则与中途回调的依据。 |
| `extension-hooks.ts` 的 `contextFrom(…)`，用于 `PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`SubagentStart` | `agent.inject` 或下游决定 | 纯文本，首行为 `<事件>[:<工具>] hook additional context:`，每个贡献者一块 | 依据 R2。单次工具调用的回调不是常驻指令，但不加来源标签的钩子文本会被模型读成用户发言。 |
| `extension-hooks.ts` 的 `contextFromReason` | `agent.inject` | 纯文本，首行为 `<事件> hook error:` | 依据 R2。被拦截的那次调用仍保留标签，因为此时模型最不该把钩子误当成用户。 |
| `extension-hooks.ts` 的 `Stop` 引导 | `agent.steer` | 纯文本 | 依据 R2。被加标签的引导正是那份记录里被模型拒绝的形态。 |
| `runtime/agents/subagent-catalog.ts` 的 `renderCatalogText` | `agent.inject` | 成帧，每个角色一行不加引号的 `- <名称>: <描述>`，无嵌套标签，经 `prompt-frame.ts` 转义 | 与参考实现的角色列表一致。嵌在里面的 `<available_subagents>` 与内部标题，是同一个块的第二套命名。 |
| `runtime/agents/team-coordination.ts` | `systemPrompt.section` | `## Team coordination` Markdown 段落 | 依据 R7。指令段落沿用的正是这个形态。 |
| `runtime/agents/role-composition.ts` 的 `roleChildNotice` | 子代理上的 `inject` | 纯文本 | 依据 R2。一句绑定说明，属模型可读事实而非指令内容。 |
| `runtime/host/extension-session-state.ts` 的唤醒与意图标记 | `inject`、`steer` | 纯文本，`form: 'context'` | 关于插件自身状态的元数据，不是指令。 |
| `runtime/surfaces/commands-mounts.ts` 的命令正文 | `agent.followup` | 纯文本用户消息 | 依据 R6。由用户编写，因此保持用户权重。 |

## 框架形态

框架就是 harness 工作区指令生产者使用的那一个，见 `packages/context/agent-instructions/src/render.ts:304-317`：

```text
<system-reminder>
<转义后的正文>
</system-reminder>
```

正文先一行来源标注，再给每个贡献者一个标题。来源标注点明注入出处：钩子输出写事件名，常驻指令写一句说明。技能目录见 `packages/skill/tool-skill/src/index.ts:256-310`，使用同一框架加 `<available_skills>`，并逐条转义。那个逐条转义函数是 `@deepseek-ai/dsh-skill` 导出的 `escapeText`，本插件现在直接调用它，不再保留自己的副本。

对照 Claude Code 2.1.308 实测（见 `docs/scratch/prompt-research/wire-captures.md`）：框架是 `<system-reminder>`、正文、`</system-reminder>`，框架本身不插空行；首条用户消息把每个提醒各放一个内容块而不是拼成一个字符串；模型看到的所有标签都是包住内容的框架，而不是为内容另起的名字。

## 转义

`escapeFrameBody` 把闭合标记替换为 `<\/system-reminder>`。转义后的写法读起来相同，且无法闭合框架。已经转义的标记保持原样，所以该函数是幂等的，不会有文本多出反斜杠。

转义在 `frame` 内部、调用方拼好正文之后执行。调用方对成帧结果做的任何字节计量因此都包含转义后的字节。

## 相关

- [宿主基础包地图](host-foundation-map.md)列出了本插件所依赖的宿主包。
- `.agents/notes/implemented/feature/2026-10-26-prompt-injection-conformance.md` 记录了框架为何到此为止。
