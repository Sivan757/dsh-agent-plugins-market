# Agent Note: 删除已声明的 MCP 服务，并把预设需求如实报出来

Status: implemented Date: 2026-10-19

## Problem

MCP 界面只有一条写入路径，没有回退的路。用户可以通过 `mcp-servers/add` 新增服务，而同一个编辑器的 JSON 视图连新增都完不成：新建服务时编辑器守着一个草稿键，文档读取器拒绝粘贴进来的带键文档——它的 `mcpServers` 键与草稿键不同。名称字段随后锁死，保存始终不可用，而且整个界面没有任何删除动作可以移除已经配置好的服务。在预设选中它的工作区里，被关掉的服务还会报红色的 `orphaned` 状态，而那个状态描述的是卸载失败，不是开关被需求压过。

## Decision

三项变更一起发布，因为它们讲的是同一个用户自有服务的生命周期。

- **新建读取用户给出的文档。** `packages/market-ui/src/ui/server-form.ts` 里的 `readDraftServerDocument` 接受裸服务对象(按草稿名称键读取)与带键文档(采用该文档唯一的 `mcpServers` 键及其 `com.deepseek.harness` 策略那一半)。文档写明的键成为字段里显示的名称，名称与声明因此不会各说各话。编辑模式仍用严格的 `parseServerDocument` 读取器，因为改掉座位会让保存悄悄指向另一个服务。
- **用户声明可以删除。** `POST /api/agent-plugins/mcp-servers/remove` 接收 `{ suiteId, serverKey }` 并进入 `McpService.removeServer`(`packages/market-mcp/src/application/mcp-service.ts`)。只有 `@user-mcp` 声明可删；套件声明的服务会被拒绝，并在消息里点名「停用」才是支持的操作。删除先写声明，保留本客户端不建模的全部顶层键，写入前重新校验剩余文档，随后删除该服务的覆盖记录与 OAuth 授权，并加入 reconcile 的收敛等待，使响应返回前 bridge 已经卸载。该动作在卡片的操作行里，需二次确认，且只对 `direct` 行出现；详情弹窗只报告服务并提供恢复操作，因此破坏性按钮不会挨着它描述的只读事实。
- **会话需求按需求本身报出来。** 挂载时会话选择被以 `enabled: true` 合并进挂载请求，因此被用户关掉的服务在预设选中它期间仍然存活。`RuntimeReconciler.demandedMcpMounts()` 把这组身份通过可选的 `mcpDemandedMounts` 目录端口传进 `buildMcpStatus`，后者现在报 state `disabled`、code `preset-demand`，并给出点名预设的原因，而不是 `orphaned`/`orphaned-tools`。挂载诊断仍然优先，因此需求之下的真实失败不会被解释成需求。需求优先的顺序本身没有改变。

## Alternatives considered

- **允许删除任何已声明的服务。** 否决：套件的 `mcp.json` 归来源所有，刷新或重装会把服务装回来，删除会表现为坏掉。停用才是能活过刷新的操作。
- **按解析后的套件重写 `mcp.json`。** 否决：解析形状会丢掉本客户端不建模的顶层键，并把其他声明重写成解析形状。删除必须只改一个键，所以重新读取原始文档并只删那一个键。
- **去掉需求合并，让面板开关获胜。** 本次否决：需求优先是刻意设计且与 LSP 共享，反转它会让预设自身的激活校验失败。缺陷在被报告的状态，不在顺序。
- **保留 orphaned 状态但隐藏开关。** 否决：那样用户就看不到预设做了什么，而那句话正是提醒他们去改预设。
- **让删除路由独立成一条路径、不加端口。** 否决：路由调用目录的 `MarketService` 门面，把该成员放进端口可以让线路与用例留在一份契约里。

## Consequences

- 用户自有的服务可以新建、编辑、开关与删除；JSON 新增流程采用粘贴进来的键，而不是卡在它上面。
- 删除会一并清掉覆盖记录与 OAuth 授权，同名服务之后再建起来是干净的。
- 被预设选中的服务读作「已停用」并附带解释，而不再是红色；调用它仍会被工具闸门拒绝：可用性没有改变。
- 需求集合每次调用现读；没有会话层的组合返回空列表，每一行状态与本变更之前完全一致。
- 项目维度的 MCP 行没有覆盖：它的需求经由 scoped 贡献层到达，而 `createProjectExtensionResources` 构建该状态时没有传入需求列表，因此这样的行仍可能报 `orphaned`。补齐需要把项目需求集发布给那个读取器。
- 删除声明不是跨文件事务：中断的删除可能留下一条无用的覆盖记录，不会留下策略被悄悄丢弃的活服务。

## Testing

`packages/market-bundle/test/integration/mcp-remove.test.ts` 覆盖正常路径、拒绝套件自有服务、以及删空表。`packages/market-bundle/test/integration/mcp-status.test.ts` 覆盖有需求、无需求、以及诊断优先三种行。`packages/market-ui/test/client-detail-editors.test.ts` 覆盖文档采用与编辑模式拒绝，`mcp-status-render.test.ts` 覆盖两个界面上的删除动作。`packages/market-runtime/test/demand-outranks-mcp-toggle.test.ts` 钉住状态修复所依赖的顺序。

## Related decisions

[市场卡片平台能力](../feature/2026-09-02-market-card-platform-affordances.md) 定义了该动作所在的卡片解剖。
