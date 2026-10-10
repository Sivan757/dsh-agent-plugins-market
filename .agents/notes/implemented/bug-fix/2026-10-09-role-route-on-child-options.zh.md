# Agent Note: Role route on the child Agent options

Status: implemented

## Problem

角色成员执行的是卡片或调用声明的路由，但所有上报成员模型的宿主面读的都是子代理自身的 `AgentOptions`：Team 名册（`live?.options.model ?? root.options.model`）、图片输入准入判定，以及成员自身派生代理的继承。宿主 Team 创建请求不携带按成员的路由，因此子代理以 Lead 的路由启动，这些面于是在成员执行角色路由时描述的是 Lead 的模型。空闲成员更糟：自然结算会释放它的 Agent，名册回退到 Lead 的模型，已经没有任何按成员的值可读。

## Decision

`TeammateRoleRuntime` 在组合成员时把已验证的角色路由写入成员自身的 `AgentOptions`，并在该组合被释放时恢复继承值。请求期路由仍由 `installModelSelection` 掌管；这次写入让面向宿主的读取（`TeamMemberView.model`、`assertImageCapable`、`parentAgentOptionsForDelegation`）在成员活跃期间与它一致。宿主若冻结该对象，运行时诊断会报告，模型选择仍然生效，因此任何请求路由都不依赖这次写入。

空闲情形仍归宿主：成员的 Agent 一旦释放，`TeamMemberView.model` 就回退为 `root.options.model`，没有任何插件可见的值可以纠正它。[代理角色文档](../../../../docs/user/agent-roles.zh.md)把路由核对指向创建结果，而不是 `list_agents`。

## Alternatives considered

**只通过模型选择携带路由。** 这是此前的状态：请求路由正确，但所有读取 `AgentOptions` 的宿主面在成员执行期间仍报告 Lead 的路由，图片准入也按错误的模型判定。

**让空闲成员保持活跃。** 没有公开 seam 能按住一个可继续子代理。自然结算会释放空闲 activation，而用待处理 inbox 消息或一个假子代理来阻止结算，会为每个成员泄漏一个 Agent。

**用插件工具遮蔽 `list_agents`。** 宿主把 Team 工具注册在 Lead 的 Agent 作用域，更外层作用域的注册会被遮蔽，而且复制宿主管理面在[角色入口笔记](../architecture/2026-10-02-role-aware-team-entry.md)中已被否决。

**让宿主携带按成员的路由。** 那仍是空闲读数的彻底修法，按用户指示不在本次范围内。

## Consequences

- 成员活跃期间，名册行、图片输入判定与成员自身的派生继承都与执行路由一致。插件写入的是宿主类型标记为 `readonly` 的字段；宿主若使其不可写，诊断会覆盖。
- 空闲成员在名册里仍显示 Lead 的路由。路由核对以创建结果为准。
- 角色绑定不变：持久创建快照仍在冷恢复和插件重载后掌管路由，`restore()` 会同时重新应用模型选择与这次写入。

## Testing

`tests/teammate-role.test.ts` 固定了活跃名册行与成员自身 options、`restore()` 路径，以及 options 被冻结时的降级行为（请求仍使用角色模型）。已用变异确认：关闭写入会让名册与恢复断言失败。
