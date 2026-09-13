# Agent Note: 注入会话的上下文不携带插件装饰

Status: implemented

## Problem

本插件放到宿主会话面前的文本，带着原作者从未写过的包装。转发的套件命令抵达时是 `[Agent Plugins 命令 /{command}（来自 {sourceId}/{suiteId}）]`、一个空行，然后才是作者写的模板；用户面板命令的对应物前面则是 `[用户快捷命令 /{command}]`。技能目录条目也是同样思路的前缀：套件技能是 `[{suiteName}] `，用户技能是 `[用户技能] `。Harness 会把这条目录行渲染进模型的 `<available_skills>` 区块，因此这些前缀是面向模型的文字。

代价有两处。套件标记来自 `qualifiedSuiteId()`，其值是注册表用的 `{sourceId}/{suiteId}` 写法——一个内部标识符，而不是读者认得出来的名字；它既进入模型上下文，也进入斜杠调用回执。而每条转发命令都为一个标题行和一个空行付出代价，去换取会话日志本就以结构化形式记录的来源：跟随消息携带 `source: { kind: 'plugin', plugin: 'dsh-agent-plugins-market' }`。

这层装饰是更早一套模式的最后遗留。代理定义过去以 `## 子代理定义（来自 Agent Plugins …，Claude Code agents 格式）` 标题包裹着进入上下文，旁边还有一个 `agent_plugins` 清单工具；两者都被[持久子代理目录](../architecture/2026-09-09-subagent-catalog.zh.md)取代，角色行只剩名称、描述和已保存的路由。命令在两旁的同伴失去标题后，保留着同样的形状。

## Decision

面向会话的文本就是作者的文本。命令转发是替换 `$ARGUMENTS` 后的模板，前后没有任何东西——套件命令与用户面板命令一致。技能候选携带技能自身的 `description`，用户面板技能携带其条目的描述。来源保持结构化：跟随消息的 `source`、`mcp__<suiteId>__<serverKey>__<tool>` 工具名，以及 `agent-plugins:instructions` 提示词 section 名，都在不消耗模型上下文的前提下标明出处。

宿主字典移除了五个键：`commandForwardTitle`、`userCommandForwardTitle`、`userSkillDescription`，以及已无调用点的 `subagentCatalogInherit` / `subagentCatalogDefaultEffort`。调用界面展示的回执去掉了 `（{suite}）` 后缀，因而与用户命令那条完全相同，两者合并为 `commandAcknowledged`。`UserPanelSkillProvider` 随它渲染的前缀一起失去了翻译函数参数。

## 边界

只有宿主自身界面读取的文本可以标出来源：斜杠菜单的注册描述对套件命令保留 `[{suiteName}] {description}`，对用户条目保留 `[用户命令] {description}`，因为菜单没有来源列，且那里的 `suiteName` 是 manifest 名而不是 id。`src/client/locales.ts` 中的面板文案不受影响。

`report_market_issue` 仍然是刻意的例外：它的工具描述点名所提交的仓库，这正是它能为正确的问题被调用的原因。

## Alternatives considered

**去掉插件名、保留套件名，继续用标题行。** 套件标记仍是我们添加的包装，且仍是内部 id；读者从它那里得不到他们键入的斜杠条目没有展示的信息。

**保留人类可读的套件名，作为给模型的来源线索。** 模型不按来源路由，套件本身也在自己的市场面板上露名。为在每条目录条目上复述这一点付出前缀，正是本记录要移除的冗余。

**保留 `[用户技能]` / `[{suiteName}]`，好让模型分辨哪些技能来自市场。** 两个 provider 都按名称排名并去重，目录里的名字本就唯一；该标签什么也分辨不出来。

**去掉转发模板末尾的换行。** 正文就是作者的文件原文；为没有可观察收益的效果改动他们的空白，是又一次编辑作者的文本。

## Consequences

模型看到的是命令模板本身，以及作者自己写的技能描述。代价是技能目录不再说明某项技能来自哪个套件——该事实留在市场界面与斜杠菜单里，不在模型的上下文中。

运行时少了五个本地化键、一个构造参数和两处装饰输出，调用回执也不再打印内部套件 id。这条规则由评审把关而非门禁：类型系统里没有任何东西阻止未来的注入路径加回标签，因此真正的防线是评审者看到 `src/runtime/` 中新的 `t(...)` 调用时会追问它是否必要。

## Testing

`tests/mcp-mounts.test.ts` 断言套件转发的文本等于替换 `$ARGUMENTS` 后的作者模板，逐字节一致、包括 fixture 文件自带的末尾换行；`tests/user-commands.test.ts` 对用户面板命令做同样的断言，并固定条目自身的 `description` 抵达斜杠菜单。`tests/skills-provider.test.ts` 与 `tests/native-project.test.ts` 断言套件技能候选的描述是作者的描述，`tests/user-panels.test.ts` 对用户条目同样如此，`tests/host-locale.test.ts` 固定不含套件的回执。加回任何装饰都会让两处转发断言在开头的标题行上失败。

## Related

[面向用户的文案不展示决策与多余提示](../process/2026-09-11-user-facing-copy-omits-decisions.zh.md) 约束同一插件面向人的文字，把同一原则用在另一个受众上；本记录覆盖会话中模型读到的东西。[持久子代理目录](../architecture/2026-09-09-subagent-catalog.zh.md) 是更早去掉装饰的那个界面。
