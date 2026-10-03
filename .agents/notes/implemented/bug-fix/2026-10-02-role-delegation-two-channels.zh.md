# Agent Note: 角色委派提供宿主的两条通道，而非作业通道

Status: implemented

## Problem

`subagent_role` 通过一个 `run_in_background` 参数暴露三条通道：省略时返回可继续子代理，`false` 运行一个前台子代理，`true` 则通过 `ctx.get('jobs')` 注册受跟踪作业并返回供 `job_output` 与 `job_kill` 使用的 `jobId`。第三条通道在本部署中从未工作过。

它按原样也无法工作。`executeAgentRole` 向 `jobs.start` 传入 `owner: parent`，而宿主的 `JobSpec.owner` 是 `SessionId`，宿主自己的每个调用方都传 `parent.id` 或 `owner.id`。作业注册表通过 `agents.get(session)` 解析 owner，查不到即抛错，因此该调用以 `session "[object Object]" has no live agent (background job owner must be live)` 失败。接口把 owner 声明为 `owner?: unknown`，编译器无法发现这一不匹配；而 `tests/agent-role-router.test.ts` 断言的是 `owner: parent`——测试锁住了缺陷，而不是捕获它。还有一条更早失败的路径：除非部署加载了 `@deepseek-ai/dsh-jobs` 与 `@deepseek-ai/dsh-tool-jobs`，`ctx.get('jobs')` 就是 undefined，而本包从未声明过它们，于是调用报出 `background role jobs unavailable`。

这条通道在实践中同样不可达。`run_in_background` 是宿主工具的参数名，宿主按 `request.run_in_background ?? options.continuable` 解读它。在本部署的 `backgroundMode: continuable` 下，省略该参数与传 `true` 走的是同一条分支，因此宿主的 `subagent` 在这里永不返回作业 ID。只有本插件的工具存在第三条分支，而随目录发布的说明却用宿主工具的参数语汇描述它。学会了“true 表示受跟踪作业、用 `job_output` 收取”的父代理，把它套用到返回子代理 ID 的宿主 `subagent` 调用上，随后用 `job_output` 去收一个子代理 ID：会话日志中有五个会话出现 `Error: unknown job <subagent-uuid>`。

## Decision

`subagent_role` 只提供宿主的两条通道，并用宿主自己的说法陈述它们。省略 `run_in_background` 返回 `{ kind: 'continuable', subagentId }`；传 `false` 则通过宿主的一次性 `start` 运行一个前台子代理，返回 `{ kind: 'foreground', runId, output }`。传 `true` 保持可继续的默认行为而非选择通道，这正是宿主在 `backgroundMode: continuable` 下的解读。

作业分支、`AgentRoleJob`、`AgentRoleJobs` 与 `ctx.get('jobs')` 读取一并删除。工具描述中的参数文本改为宿主自己的句子——“Defaults to true. Set false only when your next action depends on the result.”——两个工具因此教同一条规则。

发布的说明陈述做法，而不解释参数：保持 `run_in_background` 不设置，仅当下一步动作依赖结果时才设为 `false`。它不再描述通道菜单、不再点名 `job_output` 或 `job_kill`，也不再说明由哪个工具继续运行中的子代理——那些属于其他包的契约，而本部署中同名的可达工具并不是目录所描述的那个。

## Alternatives considered

**修正 owner 参数并保留该通道。** 否决：传 `parent.id` 只修好一个缺陷，留下的是一条只有本插件能到达的通道，其结果是一个会话词汇表中无人寻址的作业 ID，而其契约必须每一步都在目录里重述。宿主已决定自己的委派工具在本部署下只提供两条通道；第二个实现另造第三条，正是本仓库要消除的漂移。

**保留通道并声明 `@deepseek-ai/dsh-jobs` 依赖。** 否决：依赖能让通道启动，但说明层面的问题依然存在——同一个 `run_in_background` 名字对本工具意味着“作业”、对宿主工具意味着“持久子代理”，而目录正是在两者之间做选择时被阅读的。

**保留通道但不写进说明。** 否决：未记录的第三条通道比没有通道更糟，因为模型唯一的到达方式靠猜。

**改为对齐 `one-shot`，让 `true` 对两个工具都选择真正的作业。** 否决，理由是部署需要：`backgroundMode: continuable` 正是角色子代理跨轮次持久、可被后续追加指令的前提。为一个罕用参数的一致性而放弃它，等于移除角色功能赖以成立的续期语义。

## Consequences

- 缺陷在构造上消失：没有任何代码路径调用 `jobs.start`，也就不存在传错的 owner 参数。断言 `owner: parent` 的测试随它锁定的分支一起删除。
- `subagent_role` 与宿主的 `subagent` 现在对 `run_in_background` 的回答完全一致，在一个工具上学到的规则在另一个上同样成立。
- 想要受跟踪作业的调用方在此没有通道。`one-shot` 组合下的宿主 `subagent` 仍提供一条，而通用委派路径仍是没有匹配角色时被记录的途径。
- 本包不再触达一个它从未声明的宿主 seam，`check:host-alignment` 因此少了一处待处理的未声明依赖。
- 放弃的能力：把角色子代理作为作业触发并用 `job_kill` 收取。取消现在走持久子代理上的 `interrupt_agent`，即宿主对可继续子代理自己的路径。

## Testing

`tests/agent-role-router.test.ts` 断言可继续请求形状、前台路径的释放与 stop-reason 映射、拒绝场景，以及只含两个结果分支的注册参数面；作业注册用例及其取消断言被删除。`tests/subagent-catalog.test.ts` 断言调度规则以做法形式陈述，且 `job_output`、`job_kill` 与受跟踪作业措辞不出现在已发布的契约中。

## Related decisions

部分取代[委派契约随角色目录发布](../architecture/2026-09-22-subagent-delegation-contract.md)：操作契约的存放位置、固定英文文本、摘要覆盖范围与通用通道回退继续有效；三通道清单及其 `run_in_background` 描述不再有效。取代[经由宿主续期 seam 的角色委派](../architecture/2026-09-10-agent-role-delegation-via-host-continuation.md)中的作业通道；其可继续委派、精确路由规则与工具过滤移除继续有效。
