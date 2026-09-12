# Agent Note: 运行时协调调度

Status: implemented

## Problem

启动、凭据变更和设置更新可能同时请求运行时协调。缓慢的 MCP 连接此前会延迟本地命令、Hook 和 LSP 注册，无关的下载区域与反馈设置变更也会触发挂载检查。销毁可能与尚未完成的目录发现竞争，导致清理之后再次注册资源。

## Decision

宿主入口将连续事件合并为一个执行中的协调以及最多一个待执行的后续协调，后续使用新的目录快照；合并逻辑位于 `src/runtime/reconcile-scheduler.ts`。只有 MCP 后端设置实际改变才触发挂载协调。销毁后拒绝新请求，并忽略销毁之后才返回的目录发现结果。

运行时协调器并行执行独立 surface，并保留各 surface 内部的顺序。销毁时等待该 surface 正在执行的工作，跳过销毁后尚未开始的排队任务，且分别处理失败。因此 MCP 连接延迟不会阻止本地资源注册或它们各自的清理。

本决策补充[运行时按需发现来源](../performance/2026-09-07-runtime-selective-discovery.zh.md)，来源选择与扫描缓存语义保持一致。现有发现缓存和运行时 surface 记录没有定义事件调度，因此本决策不替代它们。

## Alternatives considered

**全局串行队列**可以保序，但会让本地注册等待远端 MCP 就绪，并重复执行全部冗余事件。

**无序并行协调**能够绕开全局等待，但可能在禁用或销毁之后注册旧命令或 Hook。按 surface 保序才能保留变更语义。

## Consequences

慢速 MCP 连接仍可能延迟发起该变更的操作完成。其他运行时 surface 独立就绪，连续设置或凭据通知不会积累无界目录协调队列。凭据通知继续保守处理，避免丢失首次凭据引用快照建立前收到的更新。

## Testing

`tests/plugin-apply.test.ts` 验证后端事件合并及销毁后不再协调。`tests/runtime-reconciler.test.ts` 保持 MCP 启动等待并验证本地 surface 已完成，同时覆盖各 surface 的保序、失败隔离与销毁顺序。
