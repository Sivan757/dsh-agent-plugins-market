# Agent Note: 插件的设置、卡片表单与浏览器状态都交给宿主

Status: implemented

## Problem

改一个默认值需要动五处源码加上文档。这个设置的含义被独立写了五遍：命名空间 schema、注册时声明的组合层 `base`、catalog 的字段初值、发现函数的形参默认值，以及浏览器卡片自己的兜底——而浏览器这一侧连自己都不一致，一个开关读 `!== false`，另一个读 `=== true`。

凡是面对宿主既有能力的地方，都是同样的形状。浏览器卡片手搓了宿主已有契约的东西：六个 getter 闭包、一个 `setTick` 重渲染，没有「尚未送达」的判断，没有回到默认值的路径，逐行的 busy/error 样板还已经漂移成两种不同的 promise 链。网格/列表偏好自己手搓了可订阅对象加 `localStorage`。工具注册表是透过宿主私有内部结构读的。四个宿主 seam 以「这些包没有发布」为由被逐字复制进本仓库，而那个理由早已不成立。

## Decision

**一个事实只有一个归属，宿主已经拥有的就归宿主。**

设置。`src/contracts/settings.ts` 是默认值、字段名与「缺失意味着什么」的唯一落笔处。`MarketSettingsSchema` 只是把这些默认值声明给宿主，并不持有它们。每个读取方——node 半边的四个开关、catalog 的初值、浏览器卡片——都走 `resolveMarketSettings`。注册不再声明 `base` 层：每个字段都带 schema 默认值，`base` 只是同一批值的第二份拷贝，且不改变解析结果。

卡片表单。`src/client/plugin-card-controller.ts` 暂存编辑、保存时提交，与 `settings.plugin.item` 槽位里每个卡片遵循的契约一致。控制器把状态投影成 `@deepseek-ai/dsh-client-store` 快照，经槽位的 `hooks` 座位发布，由宿主渲染器合成卡片的选择器 hook，`src/client/McpPluginCard.tsx` 因此只是一个渲染器。命名空间未送达时卡片不渲染任何内容；只有用户层确实带着该字段时才标记为已自定义；重置走 `scope.unset`，让字段重新跟随插件，而不是把当前值钉死。

浏览器状态。网格/列表偏好使用平台的快照 store 加 `persist`，这正是宿主自己的浏览器本地持久化方式。

宿主 seam。`src/runtime/mcp-client/host-seams.ts` 从 `@deepseek-ai/dsh-timeout`、`dsh-subprocess`、`dsh-credentials`、`dsh-attachment` 重新导出 `MAX_TIMER_DELAY_MS`、`scrubbedParentEnv`、`credentialKey` 与图片准入错误词汇。工具观察改读 `ctx.tools.schemas()`。宿主语言偏好改读设置服务对 `locale` 条目的投影（`describe()` → `ns === 'locale'` → `value.preference`），也就是 harness 自己的桌面外壳读取它的接口；此前的 `settings.get(ns)` 取值方法与随后的 `settings.yaml` 解析都已删除，记录见[宿主语言来源 Note](../bug-fix/2026-09-24-host-locale-source-read-and-lifetime.md)。

## Alternatives considered

**插件自己持有一个共享可变设置 store。** 拒绝：浏览器半边不能 import `src/runtime`，node 半边是异步读设置，而进程级全局会抹掉「哪一层知道这个值」。宿主设置文档本身就是那个 store，并且带有声明式的 base/默认值/用户层结构与写入的 revision 栅栏。

**保留 `base` 并从它读默认值。** 拒绝：`view.base` 在本仓库与宿主自己的卡片代码里都没有消费者，保留它只会多出第三份拷贝。

**保留浏览器卡片的即时提交开关。** 拒绝：一次设置写入是持久的、带 revision 栅栏的文档变更，node 半边会据此重新挂载 MCP 服务。逐次切换提交会把一个选择变成用户没要求、也无法预览的多次写入，而由此产生的逐行 busy/error 代码正是漂移的来源。

**继续透过内部层结构读工具注册表。** 拒绝：`schemas()` 是公开的列举 API；内部形状不是契约，且依赖宿主从未承诺保留的结构。

## Consequences

改一个默认值、增删一个字段或翻转一个极性，现在只需改契约模块一处加上其文档。浏览器卡片不再复述任何默认值：它没有答案的字段不渲染，它没有覆盖的字段跟随文档。

有一处刻意保留的偏离，理由不是「没看过」：

- **MCP 桥接、脱敏启发式与 `/api/agent-plugins/*` HTTP 面保留。** 宿主 MCP 客户端没有 OAuth 也没有 SSE；宿主脱敏由 schema 驱动，而第三方的 `mcp.json` 没有 schema 可声明；把 HTTP 面迁到宿主的 Remote seam 是重写全部路由与客户端调用，属于重写而不是复用。

定时器**不在**这个清单里。`src/runtime/timer-seat.ts` 读的是宿主的 `timer` 服务，因此在任何挂载了 `@deepseek-ai/cordis-plugin-timer` 的组合里，重复、延迟与合并调度都随插件 fiber 一起释放——base bundle 在每个标准 profile 都会挂载它。该服务同时把 `interval` / `timeout` / `debounce` 混入上下文，但 Cordis 的访问器要经服务解析，所以未 `inject` `timer` 的 fiber 上 `ctx.interval` 会报 `cannot get property "timer" without inject`；读服务本身才让这个座位保持可选。裸句柄兜底只服务于测试构建的极简上下文与未挂载该插件的组合，也是唯一需要 `unref` 的路径。此前「本插件依赖 unref 才能让 DSH 进程退出」的说法是错的：`ctx.appExit` 的定义就是「树 dispose 之后再退出」，而 dispose 本就会跑本插件的清理，所以兜底里的 unref 属于卫生习惯而非承重保证。

`settlesWithin` 同样不再是偏离：它只是在宿主 `deadline` 之上的薄竞速，定时器与 `TimeoutReason` 都归宿主。只有「工作到底有没有 settle」这一层折叠留在本地，因为宿主原语刻意只做通知。有一个陷阱值得记住：宿主把非正的超时读作「不设定时器」，而这里的调用方把它读作「不等」，因此该辅助函数给等待设了下限，而不是把零直接透传。

当服务器自己没有声明 `startupTimeoutMs` 时，每次连接尝试现在都由 `DEFAULT_STARTUP_TIMEOUT_MS`（10 秒）兜底。在此之前，未声明的服务器会落到 MCP SDK 自带的 60 秒请求默认值，于是一台连不上的服务器会占着进程、传输与浏览器腿整整一分钟才失败。确实需要更久的服务器可以自己声明 `startupTimeoutMs`（Codex TOML 里的 `startup_timeout_sec`/`startup_timeout_ms`），而该声明仍然是一项**策略**：宿主兼容模式依旧拒绝携带它的服务器，因为那个后端无法执行。默认值在连接时解析——位于内置桥接内部，也就是它唯一适用的后端——正是为了让未声明的服务器在兼容模式下仍可挂载。

卡片的开关控件改用平台 `Switch`，同时也获得了可见的焦点环。网格/列表偏好不再跨浏览器标签页同步：平台 store 每个文档持久化一个值，而跟随平台正是这次的目的。

node 半边有一处行为变化：`discoverSourceListWithNotes` 现在要求传入 `scanProjectLayouts`。它唯一真实的调用方一直会传，因此那个默认值只是一份没人读的第二拷贝。

## Testing

`tests/client-plugin-card.test.ts` 覆盖卡片表单的契约：命名空间未送达前不渲染、已存段落按契约默认值解析、暂存编辑在保存前不写入文档、放弃、重置把字段交还、被拒绝的写入报告为未保存、宿主 MCP 客户端缺失时阻止兼容模式、只读文档拒绝编辑。`tests/timer-seat.test.ts` 覆盖两条调度路径——存在宿主座位时优先使用它，兜底路径则负责重复、延迟、合并与释放停止——并覆盖挂了 timer 插件却没有 inject 的 fiber：那里混入的访问器会抛错，读服务则照常可用。`tests/deadline.test.ts` 固定 settle/超时竞速、非正等待，以及「拒绝算作已 settle」。`tests/mcp-backend.test.ts` 固定 schema 默认值，`tests/regions.test.ts` 固定区域收窄，`tests/mcp-status.test.ts` 固定工具观察及其失败形态，`tests/host-locale.test.ts` 固定 `locale` 条目的投影、未接线时的答案与接线的身份判断，`tests/client-workspace-view.test.ts` 固定持久化偏好与非法值兜底。
