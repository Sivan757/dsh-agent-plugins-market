# Agent Note：最后一次 lsp 调用是语言服务器已死的唯一证据

Status: implemented

## Problem

`ctx.lsp` 不发布 provider 快照，也不发进程事件，`dsh-lsp-stdio` 只在下一次查询被拒时才发现服务已经退出。于是退出的 provider 保留着挂载、继续匹配自己的配置、继续显示为 mounted 且没有原因——正是用户无法处置的那种状态。稳定性审计把它列为第一优先：恢复手段（重启动作）已经有了，但行上还说不出为什么要按它。

## Decision

- **只有一个观察点，就是工具调用。** `RuntimeReconciler` 监听 `tools/post-execute`；一个纯函数（`runtime/core/lsp-call-observation.ts`）判断这次调用是不是宿主的 `lsp` 工具、结果如何，监听器据此记账。不做推断：从不被调用的 provider 不会留下证据，这正是对接缝已知范围的诚实表达。
- **按文件扩展名归属。** 接缝把一次请求路由给声明该扩展名的 provider，并在挂载时拒绝重复声明，所以一个路径最多命名一个存活 provider。没有存活 provider 声明的路径不记任何东西，而不是猜一个。
- **证据归注册表所有，并随挂载一起消失。** `LspMountRegistry.observe` 按 provider id 保存最近结果，`observationSnapshot` 把它交给状态构建器，卸载 provider 时删除该记录：重启后的进程不该继承上一个进程的失败。
- **行上把观察放在状态旁边，而不是替代状态。** 调用失败但仍在挂载的行显示「最近调用失败」告警，详情写明错误并提供重启。状态保持 mounted，因为挂载还活着，而一次失败既可能是死进程，也可能只是文件不存在或超时。

## Alternatives considered

- **调用失败就把行标成 failed。** 否决：单次失败分不清死进程和坏路径，把健康服务误判为 failed 比「挂载状态旁附一条准确观察」更糟。
- **包 `tools/execute` 而不是观察 post-execute。** 否决：预执行拒绝、取消与超时根本没跑到工具，也就不是 provider 的证据；post-execute 才是完成调用所在的位置。
- **定时探测进程。** 否决：接缝没有探测接口，合成一次查询会为了回答下一次真实请求免费就能回答的问题去拉起进程、读真实文件。
- **保留调用历史。** 暂时否决：面板要的是结论而不是日志，历史会增长却没有读者。

## Consequences

- 只有宿主 `lsp` 工具发起的调用会被观察到；其他客户端使用的语言服务器不会在行上留下证据。
- 面板显示最近一次调用而不是趋势，所以恢复的服务在下一次成功调用后自动清掉告警。
- 观察是状态线上的附加字段：忽略它的消费方读到的与以前完全一样。

## Verification

- `packages/market-runtime/test/lsp-call-observation.test.ts` 钉住提取：成功调用、带消息的失败，以及所有不可归属的形状（别的工具、没有路径、空路径）。
- `packages/market-bundle/test/integration/lsp-mounts.test.ts` 钉住归属与遗忘：扩展名所有者收到记录、无主扩展名不记录、卸载挂载时清除。
- `packages/market-bundle/test/integration/lsp-status.test.ts` 钉住状态行：观察随行携带，状态仍是挂载自己的判断。
- `packages/market-bundle/test/integration/client-lsp-detail.test.ts` 钉住对话框：最近调用与错误被渲染，重启动作就在一步之外。
