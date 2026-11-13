# Agent Note: 角色走 subagent seam，不再依赖 Team

Status: implemented

## Problem

宿主 0.2.2-rc.2 这条线移除了 Agent Teams 的成员 API。`ctx.agentTeams` 保留了名字，但只发布任务图操作：`isEnabled`、`setEnabled`、`createTask`、`getTask`、`listTasks` 与 `updateTask`。创建、消息、中断、名册、成员关系与等待改由普通 subagent 控制承担，因为宿主现在从子代理树推导 Team。

角色层建立在被移除的那套 API 上。座位（seat）只要 `agentTeams` 服务存在就撤下 `subagent_role`，`spawn_teammate_role` 通过它创建成员，协调系统段在每次提示组装时读取成员关系。在新宿主上，座位看到服务就撤下了可用面，而依赖 Team 的那一面又装不上：角色委派整体消失，`subagent-catalog` 随之消失。

## Decision

删除 Team 集成，把角色面统一到宿主自己的 subagent seam 上。

只要 tools、LLM、subagents、agents 与系统提示词服务可用，`subagent_role` 就挂载。没有座位去观察别的服务，目录也从同一个挂载点发布。`spawn_teammate_role`、其运行时、协调段与座位一并删除，测试同删。本包不再声明任何 Team 包：这里不挂载 Team，任务板与 `team:policy` 段由宿主自己的 bundle 提供。

角色子代理不需要 Team 专用的创建路径。宿主从子代理树推导成员关系，因此经 `ctx.subagents` 启动的子代理在协作开启处就是 Team 成员，自带消息、中断、成员浏览与任务工具。

激活 seam 现在把子请求的字段平铺进宿主的 `SubagentActivationSpec`，不再嵌在 `request` 下，并返回激活句柄。原来的嵌套形态是潜在缺陷：seam 对该成员的标注过宽，构造出的 spec 因缺少 `parent` 与 `prompt` 会被宿主拒绝。这个句柄同时是本线唯一的按子代理释放手段，因为服务上的 `drainDescendants` 关闭整棵树；`drainChildren` 与 `drainContinuableChildren` 仅供旧线使用。

## Supersession

归档：[角色感知的 Team 入口](../archived/architecture/2026-10-02-role-aware-team-entry.zh.md)与[独立的 Team 协调段](../archived/architecture/2026-10-05-team-coordination-separate-from-discovery.zh.md)。它们的替代品是本决定加上宿主自己的 Team 策略。

[经宿主延续通道的角色委派](2026-09-10-agent-role-delegation-via-host-continuation.md)仍然有效，继续负责组装通道、持久绑定与拒绝行为。

## Alternatives considered

**保留座位并检测成员 API。** 这是第一版做法。它让崩溃不再出现在提示组装里，但也让所有 `agentTeams` 服务存在的部署撤下了可用面——在这条宿主线上就是全部部署。不予采纳：角色面跟随的是委派 seam，而不是服务的在场。

**在新的 Team 服务上重建增强入口。** 该服务没有成员 API，重建出来的入口将与 `subagent_role` 重复。Team 负责任务，子代理 seam 负责子代理。

**声明 `@deepseek-ai/dsh-agent-team` 以保持"感知 Team"。** 本仓库没有任何模块调用它。声明未使用的宿主包会削弱对齐门禁，而那道门禁的意义正是让声明可信。

**保留协调段。** 宿主在每一个启用 Team 的请求里都会发布自己的 `team:policy` 段，第二段只是在同一上下文里把同样的规则再说一遍。

## Consequences

角色委派与目录在基线宿主线以及 seam 仍支持的每条线上都可用。协作属于宿主：任务板、消息、中断、成员浏览与共享任务。插件失去 Team 专用的创建入口与成员专用目录模式；`subagent_role` 是唯一的创建路径，它的目录是唯一的目录。

seam 现在按宿主声明来标注激活成员，这正是要点：某个发布改了字段名会在类型检查里失败，而不是在用户会话里失败。

## Verification

`pnpm run typecheck`、`pnpm run lint` 与全量 `pnpm run test` 通过。真实宿主测试覆盖平铺后的激活 spec（一次启动发布保留的身份，其句柄精确释放该子代理）、目录的首次发布与替换，以及经提示词段通道完成的角色组装。`pnpm run check:host-alignment` 显示所有已声明的宿主包都匹配 0.2.2-rc.2。
