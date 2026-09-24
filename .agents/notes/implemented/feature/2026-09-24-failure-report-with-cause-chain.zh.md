# Agent Note: 失败报告先说出原因

Status: implemented

## Problem

MCP 服务详情直接把挂载流程记下的诊断原文印在弹窗里。那句话由失败的层写出，包着桥接层的内部服务名——`mount failed: mcp-client(chrome-devtools__chrome-devtools): initial connection or tool synchronization failed`——而且同一句话在一个弹窗里出现两次：一次拼在顶部的重试回执里，一次在「原因」下面。原因区块整块铺上错误色，连根本不算失败的状态（被覆写停用的服务、被别的 MCP 客户端挂载的服务）也一样。

包在那句话背后的真实原因从来没到过面板。桥接层只抛出固定的一句话，把真正的失败放在 `cause` 里（`src/runtime/mcp-client/bridge.ts`），而挂载流程只读 `error.message`，于是子进程启动失败、连接被拒绝、握手超时到面板时都是同一句话。客户端分类器正是拿这句话去匹配正则，所以面对最常见的那类失败，弹窗给不出任何下一步该查什么。LSP 详情弹窗渲染的是同一个区块，问题一样，只是原因换成它自己的英文。

## Decision

- **运行时记录原因链。** `src/runtime/failure-detail.ts` 从挂载错误出发沿 `cause` 向下走，抹掉 URL 里的凭据、去重、遇到指回自身的链条就停下，最多保留四条消息。两条挂载流程都把它们作为 `causes` 记在诊断上，两个状态构建器把记录的 `code` 与 `causes` 一起送到接口：`src/contracts/` 里的 `McpStatusEntry` 与 `LspStatusEntry` 都增加该字段，`LspStatusEntry` 同时补上它从未报告过的 `code`。
- **状态构建器自己写的原因也有了代码。** `disabled by override`、`modified by override` 与 `MCP tools remain after this plugin surface was disabled` 分别带上 `disabled-override`、`modified-override`、`orphaned-tools`，面板据此本地化，不再在中文控件旁边印一句英文。
- **失败报告只有一个实现。** `src/client/ui/FailureReport.tsx` 渲染一条 3px 状态边条（只有卡片同样标为错误的状态才用错误色）、按失败类型选出的那一句话、该状态唯一的恢复操作，以及收在 `aria-expanded` 折叠项里的诊断原文，折叠项标题是「诊断详情」/ `Diagnostic details`。MCP 与 LSP 详情弹窗都用它，连信息性的状态也走同一条路径，因此只有一份区块、一套 token。
- **分类先看记录的代码，再看措辞。** `src/client/ui/failure-guidance.ts` 取代 `src/client/features/mcp-status/diagnostic-guidance.ts`：有代码就由代码决定；走措辞的那条路把摘要行与它下面的消息合在一起匹配；`mount-failed` 里认不出的形状退到那句适用于所有启动失败的话，而不是什么都不给。
- **重试回执不再复述原因。** 它只回答这次操作有没有重新连上；原因由下面的报告给出，内容来自操作后重新读取的那一行。

## Alternatives considered

- **以原文打头，本地化句子放下面。** 拒绝：原文说的是包在外面的那句话，而读者第一个问题是该查什么。把它原样留在一层折叠之后，用于提交问题或搜索的用途不受影响。
- **只在客户端按措辞分类，不带原因链。** 拒绝：分类的上限取决于输入。外层那句话本身不含形状，原因链不跟着走，「找不到命令」这类判断就永远到不了。
- **在运行时本地化原因。** 拒绝：运行时没有语言环境，宿主自己的措辞也不该由我们改写。接口保留记录的原文，展示归面板，这与其余面板的分工一致。
- **保留整块铺红的原因框，只缩短文字。** 拒绝：渲染这个区块的状态有一半不是失败，给一个只是被停用的服务涂上错误色，正是弹窗看起来像坏掉的原因。
- **两个弹窗各写一份报告。** 拒绝：两边已经漂成同一个区块的两种写法，而英文原文正是活在第二份里。

## Consequences

- 状态接口增加 `causes` 与三个 MCP 原因代码，`LspStatusEntry` 增加 `code` 与 `causes`。原先匹配英文 `reason` 的消费方现在有稳定的代码可用；记录的原文仍旧留给日志与问题报告。
- 以后新增一种失败形状，只需在指引表里加一条和它的中英文各一句，渲染代码不用动，也不需要新的颜色或间距决定。
- 分类器认不出的原因按原文显示，而不是编一句话替代；此时报告里没有折叠项，因为没有东西藏在后面。

## Testing

- `tests/failure-detail.test.ts` —— 链条顺序、URL 抹除、去重、回环停止、四条上限，以及没有链条的情况。
- `tests/client-failure-guidance.test.ts` —— 先看代码的分类、按原因链分类外层那句话、启动失败兜底，以及无法归类的原因。
- `tests/client-mcp-detail.test.ts` —— 按原因链分类后的首句、折叠项先藏后露外层句子与它下面的原因、无法归类的原因按原文显示，以及重试回执不再带上原因。
- `tests/client-lsp-detail.test.ts` —— 语言服务器弹窗走同一条先给首句再展开的路径，以及组件缺失那条路径。
- `tests/mcp-mounts.test.ts`、`tests/mcp-status.test.ts`、`tests/lsp-status.test.ts` —— 诊断带上原因链，构建器挂上代码。

## Related

- [服务详情先当档案来读](./2026-09-21-service-detail-skeleton.zh.md) —— 这个区块所处的弹窗顺序；本记录细化的正是它的状态行。
- [MCP 身份不带会话命名空间](./2026-09-13-mcp-identity-without-session-namespace.zh.md) —— 记录的原文里为什么会出现 `套件__服务` 这样的名字。
