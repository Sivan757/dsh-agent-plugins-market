# Agent Note: 应用 hook 决策与覆盖的事件

Status: implemented

## Problem

本插件的 hooks 面会执行命令 hook，却丢掉了它们给出的决定。`ExtensionHooks` 通过 `@deepseek-ai/dsh-hook-protocol` 解码每个命中的 hook，把用不上的字段记进日志，然后只映射三种结果：deny、ask 和一条补充上下文。`continue: false` 被记录下来，运行照旧继续。`systemMessage` 没人记录。工具入参改写被逐 hook 逐事件地警告。只跑七个事件，于是声明 `PostToolUseFailure`、`PreCompact` 或 `SessionEnd` 的套件只会看到一条"不支持的事件"诊断，而参考实现本来会执行它。

结果是一类"看起来能用、实际什么也没做"的套件。默认目录里的七个套件就是证据：hookify 用 `permissionDecision: deny` 拦截，把规则文本放在 `systemMessage` 里，没有 `permissionDecisionReason`，于是用户读到的是 `blocked by PreToolUse hook` 而不是规则本身。ralph-loop 和 hookify 的 Stop 规则把理由用在一次续跑上，而没有上限的桥可以无限重复。code-modernization 与 claude-security 声明的事件被本插件直接拒绝。

## Decision

应用宿主接入点能表达的每个决定，并报告表达不了的。

`packages/market-runtime/src/runtime/surfaces/extension-hooks.ts` 现在按事件应用：

- `PreToolUse` 把 deny 映射为 `{ kind: 'deny', reason }`，把 ask 映射为 `{ kind: 'ask', reason, displayReason }`，把 allow 映射为预批准：hook 的 allow 会替换下游的 `ask`，但绝不覆盖下游的 `deny`，所以后面的策略仍保留否决。`additionalContext` 通过 `agent.inject` 进入下一个请求，这是会落日志的 inbox 通道，且只在调用真正执行时注入。
- `PostToolUse` 把 block 变成纠正反馈；如果调用本身已失败，block 的理由改走上下文，因为替换掉失败结果会把失败藏起来。
- `UserPromptSubmit` 遇到 block 就拒绝该步，并把 `additionalContext` 与纯文本 stdout 折进 enter 决定。
- `SessionStart` 与 `UserPromptSubmit` 还会把非 JSON 的纯 stdout 当作上下文读出，这正是参考实现给这两个事件的规则。
- `Stop` 把理由或上下文作为续跑 steer 进去。`stop_hook_active` 现在反映这是否是一次强制续跑，不再恒为 `false`；连续八次续跑是上限，与参考实现一致。
- `continue: false` 通过 `agent.cancel({ kind: 'hook', reason })` 取消这次运行。`@deepseek-ai/dsh-session` 的 `AgentCancelCause` 本来就有这个分支，循环会把该轮记为 `{ kind: 'aborted', reason: { kind: 'hook', reason } }`，所以中止是持久的，而不是一个日志字段。
- 阻塞理由按参考实现自己的通道依次回退：`permissionDecisionReason`（或顶层 reason，或退出码 2 的 stderr），然后 `stopReason`，然后 `systemMessage`，最后才是固定句子。hookify 的形态因此能把规则文本送到模型。

三个事件加入集合。`PostToolUseFailure` 就是 `result.isError` 时的 `tools/post-execute`，两个事件的全部差别就在这个标志。`PreCompact` 是 `session/event` 上的 `compaction/start` 条目，触发方式由是否存在 `sourceCommandId` 推导。`SessionEnd` 从桥自身的销毁流程运行，沿用参考实现的 1.5 秒预算和 `reason: other`，因为代理销毁载荷不带原因。

`packages/market-contracts/src/contracts/extension-presets.ts` 的支持表继续是"什么能跑"的唯一归属。目录校验器现在从该表推导它接受的事件，`packages/market-runtime/test/hook-event-coverage.test.ts` 把 `HOOK_RUNTIME_POINTS` 钉在同一张表上，于是校验器、运行时与 Hooks 页签不可能互相矛盾。`Notification` 与 `PermissionRequest` 如实标为 `registered-only`：没有任何东西运行它们，它们的行也这么说。

## Alternatives considered

- **给每个字段写一条缺口、不应用任何决定。** 否决：宿主的决定联合本来就带着 deny、ask、allow、block、上下文与取消。类文档里的那条限制，接入点已经不再支持。
- **在 pre-execute 监听器里改写工具入参。** 否决理由是不可能，而不是不想要：`ToolExecution.arguments` 是深冻结的，`tools/execute` 包装器只能改 `exec.signal`。`@deepseek-ai/dsh-tools` 的 `PreToolDecision` 没有改写分支，并且明确记录了排除。该字段因此连同这个符号一起报告。
- **hook allow 直接返回 `{ kind: 'allow' }` 而不调用 `next()`。** 否决：那会短路后面所有 `tools/pre-execute` 监听器，把套件 hook 变成权限绕过。只预批准下游的 `ask` 才保住"最严格优先"的折叠。
- **把 `systemMessage` 注入为模型上下文。** 否决：该字段是给用户看的文本，送进模型会改变模型的判断。它保持为日志警告，并在 hook 没有给出别的文本时作为阻塞理由的回退。
- **为 `systemMessage` 自建通知面。** 暂缓而非否决：客户端需要会话级路由、存储和面板，而本插件自己的 Hooks 面板是无会话的。参考页把这个选项写下来，下一次变更可以从它开始。
- **注册自己的 `CompactionEngine` 来否决压缩。** 否决：那是替换宿主引擎，属于接管宿主责任，而不是桥接。
- **为 `PermissionRequest` 和 `Notification` 引入审批包。** 否决：profile 不会安装 peer（见 hook-protocol 自备那份记录），一个 peer import 可能丢掉全部面。
- **让 `Notification` 保持 `supported-partial`。** 否决：没有任何运行时代码跑它，一个承诺了不存在桥接的支持标签正是本次变更要消除的缺陷。

## Consequences

- 阻塞型 hook 现在用自己的文本解释自己，用户读到的是规则，而不是一句通用说明。
- hook 的 allow 会取消一次确认提示。没有审批服务的部署本来就把 `ask` 降级为 deny，那种环境里 allow 不改变任何行为。
- `continue: false` 结束这次运行并清空待处理输入，这正是"中止"的含义，也是提出该请求的套件所期待的。
- Stop 的上限让无条件阻塞的 hook 在八轮后停下。想要无限循环的套件不再能得逞，这是参考实现的行为。
- `PostToolUse` 不再对失败的调用运行。依赖旧共享路径的套件需要声明 `PostToolUseFailure`，这正是参考协议的分工。
- `PreCompact` 的 hook 运行在插件自己不产生的事件上。宿主压缩包不是本包的依赖，所以触发方式的读取把载荷当数据校验，读不出来就报告一次。
- `SessionEnd` 在销毁期运行，因此不能追加 `hook/invoked` 或 `hook/result`：协议要求这对事件在本轮内闭合，而销毁发生在任何轮之外。它的结果改为记日志。
- 仍有三个参考字段未应用，每一个现在都点名了需要改动的宿主符号。docs/reference/hooks-event-coverage.md 是那张表。

## Testing

`packages/market-bundle/test/integration/extension-hooks.test.ts` 用假 shell 覆盖每个已应用字段：hook allow 预批准下游 ask 而下游 deny 仍生效、仅有 `systemMessage` 时的 deny 理由、PreToolUse 上下文只在调用执行时进入 `agent.inject`、`continue: false` 以 `{ kind: 'hook' }` 取消、退出码 2 在提问、工具与停止三点都以 stderr 为理由、纯 stdout 只在文档规定的两个事件上折叠、`PostToolUseFailure` 保留失败结果并附带上下文、`PreCompact` 在压缩事件上运行并报告缺失的否决、`SessionEnd` 在销毁时只运行一次、八次续跑上限与 `stop_hook_active`、`updatedInput` 只报告不应用，以及各事件的默认超时。

`packages/market-runtime/test/hook-event-coverage.test.ts` 把运行时事件表钉在支持表上。`packages/market-bundle/test/integration/project-hooks.test.ts` 覆盖校验器接受新事件、拒绝 `PermissionRequest`。`packages/market-bundle/test/integration/extension-hooks-inventory.test.ts` 覆盖 Hooks 页签读到的支持结论，`hooks-overview-identity.test.ts` 覆盖部分支持的事件与可选中事件并排时保持只读。
