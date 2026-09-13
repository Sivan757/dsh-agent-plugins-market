# Agent Note: 变更流水线与请求等待的有界化

Status: implemented

## Problem

安装、卸载、启用或停用套件，此前只有在整条变更流水线跑完之后才会应答：先落盘状态，再依次刷新每个派生 surface——项目命令、套件指令、项目 MCP 与 Hook、用户命令，最后是运行时挂载协调。因此，一个永不结束的挂载会把请求一直挂住，市场页的阻塞遮罩也随之卡住。这条路径上没有任何一方有截止时间：客户端的 `fetch` 没有，流水线没有，`ReconcileScheduler` 也只在 `finally` 里清理执行中的 pass。

实际观测到的现象是：单个卡住的挂载冻结了之后的所有变更。`POST /api/agent-plugins/mcp-retry` 跑的正是「启用」所要等待的那次协调，在线上的 profile 上 280 秒都没有返回；与此同时普通读取是毫秒级，1026 个套件的全量扫描只要 1.2 秒。由于 `request()` 会并入执行中的 pass，之后每个变更都在等同一个 promise：一个卡死的 pass 就意味着重启宿主之前，启用、停用、安装、卸载全都无法完成，遮罩也无法关闭。

## Decision

变更在状态落盘时就应答，绝不等挂载就绪。`CatalogContext.notifyChanged` 同步失效缓存，并在后台调度一次合并后的刷新 pass；已在执行的 pass 会吸收期间到达的变更。显式调用方要等待这次 pass 时用 `CatalogContext.refreshSettled(deadlineMs)`，上限为 `DERIVED_REFRESH_WAIT_MS`（10 秒），超时后如实返回而不是继续死等。

有界的是等待，不是工作。`settlesWithin(work, deadlineMs)`（`src/runtime/deadline.ts`）让 promise 与计时器赛跑并报告谁先结束；任何工作都不会被取消，因为取消一次挂载要么让已派生的服务进程变成孤儿，要么丢弃用户正在完成的授权。组合根给变更流水线的每个阶段同样的处理（`src/index.ts` 中的 `CHANGE_STAGE_DEADLINE_MS`，20 秒）：记录超时日志后继续，因此卡住的 surface 只损失自身的新鲜度，不会拖垮整条流水线的活性。

手动重试会重建存活挂载。bridge 背后的服务即使已经死掉，其已解析配置的指纹仍然没变，所以任何 pass 都不会再校验它——某个本机 IDE 侧端点在被上报为 `connected` 很久之后早已开始拒绝连接。`McpMountRegistry.forceRemountAll` 会把每个存活挂载标记为显式重建，经 `mcpRemountAll` 端口接线，由 `retryMounts` 在它所等待的那次 pass 之前应用。

客户端不会无休止地等待。`src/client/api.ts` 中读取由 `READ_TIMEOUT_MS`（15 秒）约束、写操作由 `MUTATION_TIMEOUT_MS`（10 分钟）兜底；`RequestTimeoutError` 经 `clientErrorMessage` 以 `requestTimeout` 文案呈现给用户。阻塞遮罩在 `BUSY_LONG_RUNNING_MS`（20 秒）后明确说明等待时间偏长，而不是让用户自行猜测。

## Alternatives considered

**保留等待流水线、只给总时长设上限。** 这样能保住旧的语义——挂载就绪后弹窗才关闭——但每次开关仍要为用户并未要求等待的挂载阻塞，而且上限会变成「按最慢的合法克隆来定」的数字，而不是按用户刚做的事来定。

**超时后连同挂载一起取消。** 截止时间无法区分「卡死的挂载」与「等待用户批准的浏览器授权」。放弃后者等于丢弃用户正在完成的授权，放弃 stdio 挂载则会留下孤儿进程；只约束等待才能让两者都可恢复，这也是把挂载层的 OAuth 上限（`CALLBACK_TIMEOUT_MS`，5 分钟）留给 bridge 的原因。

**构建 MCP 状态时探测每个挂载。** 这样能如实报告已死的端点，但会把网络 I/O 放到面板读取路径上，而且仍然无法区分「空闲的服务」与「已死的服务」。改为在显式重试时重建，既修掉了用户可见的症状，也不必凭空发明一套探测策略。

## Consequences

变更及其遮罩现在只需一次状态写入的时间。挂载、命令、Hook、LSP 注册在其后追平，因此开关后立刻读取的客户端可能先看到新状态、其后才看到对应 surface 就绪；挂载是否就绪以状态面板为准。卡住的挂载会一直拖住它自己所在的 surface，直到 bridge 自身的上限触发，而现在它只会记录超时日志，不再冻结之后的每一次变更。派生刷新是合并的，所以一串连续变更只花一次 pass 而不是每次一次，被拒绝的 pass 也不会再卡住队列。

## Testing

`tests/catalog.test.ts` 固定了：变更在变更回调仍被 gate 住时就 resolve、`refreshSettled` 能报告执行中的 pass、被拒绝的 pass 不会阻止后续刷新。`tests/deadline.test.ts` 固定有界等待，包括截止时间过后工作仍会完成。`tests/mcp-mounts.test.ts` 固定每个存活挂载都会被强制重建。`tests/client-busy-overlay.test.ts` 固定长时间等待提示与 lease 释放。`tests/project-commands.test.ts` 与 `tests/project-mcp.test.ts` 在切换项目布局后 await `refreshSettled`，这就是任何断言派生状态的测试所要遵守的契约。
