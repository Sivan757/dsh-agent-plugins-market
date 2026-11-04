# Agent Note：语言服务器的恢复靠一次显式重启，因为接缝不报告进程已经退出

Status: implemented

## Problem

挂载成功只是一个注册，不是进程。`ctx.lsp` 只提供 provider 注册与查询路由，别的都没有：没有 provider 快照，没有进程探测，也没有事件。`dsh-lsp-stdio` 只在下一次查询被拒绝时才发现服务已经退出，于是插件手里只有一个 disposer，看不到自己挂载的子进程。

这带来两处可见的代价。死掉或卡住的服务一直显示为已挂载，而且没有任何原因，这恰好是用户无法处置的那种状态。恢复则要等某个无关事件重新跑一遍 reconcile，用户即便已经修好原因，或者就想现在换掉进程，也没有可点的控件。

## Decision

LSP 详情对话框为 mounted 与 failed 的行提供「重启服务」。它带着该行的 id 调用一条新路由，只标记这一个挂载并重新跑一遍 reconcile；不传 id 时标记全部活动挂载，留给无法点名单个服务的调用方。

- `LspMountRegistry.forcedRemounts`、`forceRemount(key)` 与 `forceRemountAll()` 与 MCP 注册表同形，reconcile 循环把被标记的 key 视为指纹不匹配：先释放活动 provider，再用同一份解析后的配置挂载新的。标记在释放失败时保留，让下一趟重试；key 没有活动挂载时标记被丢弃，因为普通挂载路径本来就会挂载它。
- `LspService.restart()` 先标记，再调用 `notifyChanged(true)`，然后等待有界的 `refreshSettled()`，与 `McpService.retryMounts()` 完全一致。请求返回的是这一趟走到的状态，不是一个「慢重挂载会在本次调用内完成」的承诺。
- `CatalogPorts.lspRestart` 接受可选 id 且默认空实现，`MarketMutations.restartLspServers(id?)` 把它带到 HTTP 层，`MARKET_ROUTES.lspRestart` 是对应的 POST，`api.ts` 的 `restartLspServers(id?)` 是客户端调用。行 id 本身就是挂载键，所以对话框点的是自己那一个挂载，一次重启不会打断其他语言服务器正在进行的工作。
- 动作只对 `mounted` 与 `failed` 行提供。冲突、支持包缺失或已禁用的行需要别的修法，在那里提供重建只会让用户以为按钮没有作用。
- 工作区的资源详情渲染同一个对话框，但不带这个动作，与 MCP 在那里的只读形态一致。

强制重建会杀掉进程，所以下一次请求要付一次冷启动。这就是代价：接缝无法预热服务，因为宿主只在首个匹配查询时按规范工作区各起一个进程，而挂载趟次手里没有工作区。当替代方案是等待一个计时器时，用一次冷启动换掉卡住的 provider 是值得的。

## Alternatives considered

- **由插件轮询进程。** 否决：`ctx.lsp` 不发布 provider 列表，`dsh-subprocess` 也不发生命周期事件，唯一能做的「探测」是合成一次查询，那会拉起进程、读一个真实的源文件，还要报出一个面板并不知道的工作区。
- **包装 `lsp` 工具记录查询结果。** 不是永久否决：它能让行带上真实原因，但取决于包装器相对宿主超时策略的顺序，而且不改变恢复路径。它仍是稳定性审计里的下一步。
- **用更低的工具调用超时缩短失败路径。** 否决：调用预算到期时宿主会释放仍在初始化的实例，所以更低的预算会把一个慢服务变成永远起不来的服务。
- **把启用开关当重启用。** 否决：它会改写已存的禁用列表，用户得先关再开才能恢复，而且表层已被关掉的套件根本走不到这一步。
- **删掉声明再加回来。** 否决：为了恢复一个运行时状态去编辑来源拥有的文件，而套件声明本来就不是用户能改的。

## Consequences

- 用户不必等重试计时器，也不必重启 DSH，就能换掉一个语言服务器进程，而且不会打扰其他已挂载的服务。
- 重启一个健康服务是允许的，代价是下一次请求多一次冷启动。动作用文案说明，不加前置检查，因为先查健康需要这个接缝没有的探测。
- 被重建服务上正在进行的查询会以 `LSP_DISPOSED` 失败，随后状态行报告新的挂载。
- 重新挂载失败时会产出新的挂载诊断，于是这种情况下这一行终于带上了原因。

## Verification

- `packages/market-bundle/test/integration/lsp-mounts.test.ts` 证明点名重启只重建那一个挂载、整工作区趟次会释放全部活动 provider 并以同一份配置重挂、在趟次进行中发起的重启会排队而不是重叠，以及没有活动挂载时的标记不改变任何东西。
- `packages/market-bundle/test/integration/routes.test.ts` 证明这条 POST 会到达 `restartLspServers`。
- `packages/market-bundle/test/integration/client-lsp-detail.test.ts` 证明动作在已挂载行与失败行渲染、回显结果、对冲突与支持包缺失不提供，并在只读形态下隐藏。
- 触及范围内类型检查、lint、CSS 类名门与文档链接门都是干净的。

## Related decisions

[自供 LSP 能力](../architecture/2026-09-11-self-provisioned-lsp-capability.md) 拥有这个动作所重建的挂载生命周期，包括为什么挂载失败保持为诊断而不进入重试。
