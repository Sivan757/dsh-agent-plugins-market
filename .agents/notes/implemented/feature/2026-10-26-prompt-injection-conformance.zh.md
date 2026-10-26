# Agent Note: 为每个注入提示词的块成帧、转义并标注来源

Status: implemented

## Problem

owner 的提问是：这里每个功能往宿主提示词注入内容时是否符合最佳实践——有没有 `<system-reminder>`，有没有 XML 强调块。审计发现两个生产者的回答与宿主不一致。

套件指令以一整段无归属文本进入系统提示词（`runtime/host/scoped-contributors.ts` 用空行连接 `mount.instructions`）。两个互相冲突的套件无法区分，也没有任何一句说明优先级。当前没有已安装套件声明 `systemPrompt`，所以这是潜在的而非正在发生的缺陷。

hook 上下文以裸用户散文进入会话记录（`runtime/surfaces/extension-hooks.ts` 的 `contextFrom`）。套件 hook 的整套指令都走这条路：本机真实的 `learning-output-style` 与 `explanatory-output-style` 套件通过 `SessionStart` hook 推送段 3208 字节的写作模式指令，而它到达时的样子像是用户自己打的。

全仓没有任何转义。唯一的转义函数是 `subagent-catalog.ts` 里的本地副本，只在一个文件里使用。套件正文若包含 `</system-reminder>`，就能闭合一个不是它打开的框架。

## Decision

由一个模块负责成帧、转义与标注：`packages/market-runtime/src/runtime/surfaces/prompt-frame.ts`。它导出框架常量、`escapeFrameBody`、`frame`、`attribute` 与 `escapeEntry`，所有需要成帧的生产者都调用它。

规则来自宿主自己的决定，写在 `docs/reference/prompt-injection-conventions.md`：

- R1 生产者为自己内容成帧，因为会话面对注入内容是原样透传。
- R2 `<system-reminder>` 只用于持久、会话稳定的指令内容。
- R3 不使用任何模型没被训练过的标签。
- R4 每个成帧正文都转义 `</system-reminder>`，且在字节计量之前。
- R5 标注贡献者，每个一个标题，另加一句优先级。
- R6 用户输入保持不成帧。
- R7 系统提示词段落用 Markdown 标题，绝不用框架。

落地内容：

- 套件指令段落现在是 `## Agent plugin instructions`、一句优先级说明，以及每个贡献者一个 `### <套件>` 标题。同时贡献系统提示词与启动技能的套件读作一块。`renderPrompt` 只用空行连接段落、不加任何标题（`packages/core/system-prompt/src/index.ts:290-295`），所以结构必须长在段落内部。
- hook 上下文按持久性分流。`SessionStart` 与 `UserPromptSubmit` 的上下文属持久会话指令，成为一条成帧消息，含说明句、优先级句，以及每个贡献套件一个标题。`PreToolUse`、`PostToolUse`、`PostToolUseFailure` 与 `SubagentStart` 的上下文保持纯文本，每个贡献者一块。`Stop` 引导与纠正反馈保持纯文本。
- 标注需要合并过程丢弃的身份，因此 `collect` 现在把每条解码结果连同套件标签一起返回，`PointOutcome` 在合并决定之外携带带归属的上下文。
- `subagent-catalog.ts` 改为导入 `escapeEntry`，不再保留私有副本；该助手委托给 `@deepseek-ai/dsh-skill` 导出的 `escapeText`，也就是宿主技能目录逐条使用的同一个函数。
- `team-coordination.ts`、`role-composition.ts`、`extension-session-state.ts` 与 `commands-mounts.ts` 本来就合规。它们未被改动，并由测试钉住。

## Why not the alternatives

- **连引导也成帧。** 否决：harness 记录过一份会话，模型把带标签的 `<steering>` 视为第三方元数据并拒绝执行。这正是要避免的失效模式，也是上游删除会话面信封的原因。
- **系统提示词段落也成帧。** 按 R7 否决。该段落已是系统权重，加框架只是给权重再加权重，而标题能提供它没有的结构。
- **自造 `<agent-plugins-instructions>` 标签以示区别。** 按 R3 否决。模型没被训练过的标签只增加 token，没有可靠效果，这正是上游删除信封的理由。
- **对成帧正文整体做 HTML 转义。** 否决：那会破坏套件刻意写下的 Markdown，例如标题或代码围栏。只转义闭合标记，宿主生产者做的也正是这一件事。
- **每个调用方各留一个转义函数。** 否决：本仓就是这样在 `subagent-catalog.ts` 里长出一份私有拷贝，别处什么都没有。
- **保留旧纯文本并旁挂框架。** 否决：目的是把形态改一次，而不是同时发布两种。

## Consequences

- 成帧后的套件指令读起来是注入的上下文，带明确优先级，两个套件也能区分。
- 附加成本就是框架本身。以真实的 `learning-output-style` `SessionStart` 载荷测量：3208 字节的 hook 文本变成 3530 字节，多 322 字节，约 10%。其中 256 字节是说明句，其余是框架标记与套件标题。
- 内容、门控与时机不变。新增字节只有框架、说明句与标注标题。
- 正文含闭合标记的套件会看到它被渲染为 `<\/system-reminder>`。今天没有已安装套件写这种文本。
- 系统提示词段落新增标题。若有套件靠数空行判断自己在提示词里的位置就会受影响，而没有套件这么做。
- 转义与成帧集中在一个模块，未来的生产者若不删掉这处 import，就无法重新引入私有副本缺陷。

## Testing

`packages/market-bundle/test/integration/prompt-frame.test.ts` 覆盖该模块：闭合标记被转义、已转义的保持幂等、框架标记各占一行、成帧后只剩一个闭合标记、空段落不贡献内容、标题保持单行、条目转义与宿主一致。

`packages/market-bundle/test/integration/prompt-injection-conventions.test.ts` 为每条规则配一个用例：

| 规则  | 用例                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------- |
| R1    | hook 的 `SessionStart` 上下文以成帧形式到达                                                              |
| R2    | 用户提问上下文成帧而 `Stop` 理由不成帧，`PreToolUse` 上下文保持纯文本                                    |
| R3    | 段落与目录文本中的尖括号标签只有框架、`<available_skills>`、`<available_subagents>` 与 `<skill_content>` |
| R4    | 套件 hook 上下文里的闭合标记被转义                                                                       |
| R5    | 两个 hook 套件可由标题区分，两个指令套件同时带标题与优先级句                                             |
| R6    | 用户编写的命令正文到达模型时无框架、无标题                                                               |
| R7    | 指令段落以 Markdown 标题开头且不含框架，空段落不渲染，空正文不贡献标题                                   |
| GAP D | 纯文本生产者不导入框架模块，团队段落保留 `## Team coordination`，会话状态标记保持纯文本                  |
