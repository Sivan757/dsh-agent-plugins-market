# Agent Note：子会话用父会话的已提交选择作答

Status: implemented

## Problem

每 agent 的工具门禁会拒绝一个扩展选择里没有点名的能力——而子会话的选择从来不会点名父会话已提交授予的那一行。在 teammate 或 subagent 里，模型报告找不到 MCP，而市场面板显示每个 server 都已连接。修复前实测：挂上门禁、策略回答 false 之后，lead、原生 teammate 和普通 subagent 的准入集合都从一根根注册的探针工具变成空。

两个原因叠在一起：

- 新建的子会话凭空捕获一份选择：工作区默认 preset、旧版工作区过滤器，或对可用行的默认捕获。没有人替子会话挑资源，捕获只能靠猜，而猜测经常漏掉父会话自己授予的那一行。
- 自己的 inventory 还没落地的子会话，拒绝得像资源被撤回一样：`denialReason` 只在 agent 被标记 stale 时报告暂时的 `extension-inventory-pending`，于是模型被告知资源没了，并被建议让用户去启用一个用户早已启用过的资源——这条建议把一次准备中的短暂缺席变成了看起来永久的消失。

## Decision

- **子会话的选择就是父会话的已提交选择。** `initialSelection` 从 agent 的 session header 取 `parentSession`，解析那个活的父 agent，回答它的已提交选择；工作区捕获只在没有活父、或父自己还没有选择时运行。fork 路径早已把父的已提交绑定当作子自己的——这把同样的答案扩展到了新建子会话，而插件派生的 teammate 全是新建的。
- **尚未发布的选择有自己的拒绝原因。** `ExtensionToolDenialReason` 在 `extension-inventory-pending` 旁长出 `extension-selection-pending`，带自己的模型侧后缀：本会话的资源还在准备中，会自动返回，稍后重试。stale 分支保留 inventory 文案；撤回文案继续建议找用户，因为那种情况下资源是真的没了。
- **门禁的机制不动。** 它仍然在该 agent 自己的 scope 里 restrict 并守护执行；变化的是策略给子会话的答案，以及准备中陈述的理由。

## Supersession

没有更早的 note 拥有这个决策：门禁的构造记录在 2026-10 的每 agent 门禁变更里，fork 继承是会话状态的一个性质而不是一条成文规则。本 note 第一次成文子会话如何作答。

## Alternatives considered

- **豁免没有选择的 agent 的限制。** 否决：不受治理的 agent 会看到进程挂载过的每一个受管工具，包括它的会话从未选过的行——门禁存在的理由就是按会话回答，这样改会变成按进程回答。
- **持续复制父的 live 选择。** 否决：父可以中途换 preset，一个跟着父实时变的子没有属于自己的稳定授权；子挂上来那一刻的已提交选择，才是父会话真实作出的授予。
- **对子完全去掉门禁。** 否决：这会重新暴露门禁当年要堵的跨会话泄漏——一个会话的目录读取不能决定另一个会话的工具。
- **只在子的 inventory 未落地时用父的快照播种。** 否决：一个 agent 两个授权来源，拒绝原因也说不清是哪个在作答。

## Consequences

- teammate 或 subagent 从自己的第一轮起就能看到父会话授予的 MCP 工具、技能、命令和 agent，不需要自己的面板。
- 父还没有选择时，子以新的 selection-pending 原因暂时拒绝，而不是撤回建议，模型会重试而不是让用户重新启用一个已经启用过的资源。
- 根会话（无父）保持工作区捕获；用户直接打开的会话没有任何变化。
- `ExtensionToolDenialReason` 被导出，未来的面板无需解析后缀文本即可命名两个暂时性原因。

## Verification

- `packages/market-runtime/test/root-tool-visibility.test.ts`：一根由 ownership 映射认领的根注册探针，在挂了以 runtime 为策略的门禁的 held teammate 与 held subagent 的准入集合里保留；父授予的行出现在子自己的选择里；允许策略的对照组与无门禁的可见性矩阵保持原有答案。子被刻意在回合中测量：settle 过的 run 会 dispose scope 并连同释放 restriction。
- `packages/market-bundle/test/integration/mcp-model-catalog-visibility.test.ts`：桥构建的工具在会话允许时到达模型自己的目录链（`tools.resolve\` 然后 `systemPrompt.assemble\`），会话拒绝时离开。
