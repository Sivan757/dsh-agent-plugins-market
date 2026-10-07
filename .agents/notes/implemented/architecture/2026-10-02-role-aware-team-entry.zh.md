# Agent Note: 通过公开宿主接口创建角色 Team 成员

Status: implemented

## Problem

Team profile 替换了宿主 subagent 控制工具。独立角色子代理不是 Team 成员，其 UUID 无法被 Team 工具寻址。撤下角色工具能避免冲突，但也失去角色指令与模型选择。用户要求提供插件自有的增强创建工具，不修改宿主。

## Decision

Team 部署中以 `spawn_teammate_role` 替代 `subagent_role`，原生 Team 工具保持不变。增强入口调用 `agentTeams.spawnTeammate`。独立命名的 continuation provider 提供全新创建规格，将预留子代理 ID 关联到调用局部的角色快照。被等待的 `agent/created` hook 验证准确父代理及成员身份，再安装作用域 persona 和 `installModelSelection`。不修改父代理 options，不替换宿主方法，不创建第二套名册。

已验证角色快照保存在 `teammate-role-binding` 上下文消息的来源元数据中，通过宿主 inbox 注入，并在首次任务接受前刷盘。来源记录子代理 ID、角色身份、指令及有效路由。恢复通过 `sessionQuery` 观察成员自己拥有的日志；继承的角色绑定不能变成另一个成员的角色。专用外部事件被发布版持久化读取器拒绝，首个 system head 之前追加 user surface 也会破坏重放；inbox 同时保证已知事件封装与正确消息顺序。

角色发现继续使用精简持久目录，不修改全局工具 schema。模式标记保证独立／Team 模式切换时即使条目不变也发布替换。Team 说明只在用户授权 Team 工作后帮助选择角色，不授权创建。非 Team 部署保留独立目录行为。动态观察服务存在性选择入口，因为 Team 工具稍后才按 Agent 作用域注册。 协调规则的独立挂载与 Lead／成员分工见[Team 协调独立于角色发现](2026-10-05-team-coordination-separate-from-discovery.zh.md)。

## Installed reference evidence

Claude Code 2.1.284（`/opt/homebrew/bin/claude`）的已安装 SDK 声明提供 `subagent_type` 与模型覆盖，其可执行文件含首次公布、增加及移除代理类型的提示。Codex CLI 0.158.0（`/opt/homebrew/bin/codex`）包含 `Available roles:`，并明确角色说明从不授权创建。这是已安装二进制的观察，不代表验证了每条请求组装路径。参考证据支持保留可发现性，同时分离角色选择与创建授权。

## Alternatives considered

**修改宿主 Team 工具或请求 schema。** 用户否决。发布版请求不转发 persona／agentOptions，但公开的可等待 Agent 初始化、作用域系统指令和模型选择监听器提供了插件内路径。

**保留第二套子代理管理工具，或遮蔽原生名字。** 否决：独立 helper 虽能让游离成员可达，仍保留两套不兼容的管理约定；遮蔽名字依赖加载顺序与作用域。给角色工具加 list／send／stop 也有同样的归属问题。

**在 Team 部署继续整体让位。** 不作为最终产品：角色指令与模型路由正是插件价值。两个创建入口可以共享一套原生 Team 名册与管理 API。

**把角色塞进可变工具描述，或在 schema 中枚举。** 未采用：项目角色因调用者而异，并会在会话中变化。现有目录发布已处理变更、移除、恢复与压缩，无需重新注册全局工具。在飞成员名册也不并入角色目录，该状态由原生 Team 列表负责。

**把 persona 拼进任务 prompt，或从 prepareContinuable 返回额外字段。** 否决：任务文本不是作用域 persona，provider 只返回全新／fork 数据。角色配置改用明确的公开 Agent hook。

## Consequences

- 角色身份可复用；Team 成员名称终身唯一，原生成员上限仍有效。后续工作应给已有成员发消息，而不是反复新建。
- 增强入口始终从全新上下文启动，返回原生 target 与有效路由；无前台／job 通道或 fork 参数。普通成员仍可用原生 spawn_teammate。
- 编辑卡片只影响新成员，恢复使用创建快照。卸载插件时先停止并排空活跃角色子代理再移除配置。恢复角色成员时须保持插件安装，宿主不会独立重建本插件的角色来源。
- rc.2 原生名册不能作为路由依据：成员行取活跃 Agent 的模型，成员转为非活跃后回退为 Lead 的模型（`list` 中的 `live?.options.model ?? root.options.model`）。有效模型以增强工具结果和持久化请求头为准；不修改原生展示，因此文档改为引导操作者看工具结果。
- Agent、Session、Subagent、system-prompt、Team 与 Session-query 包声明为 peer 并配精确开发镜像。Team／query peer 可选，集成测试使用已发布 loop／testkit／persistence／原生 Team 包。其传递原生依赖 koffi 禁止编译，因为测试不使用桌面 I/O。对齐门禁允许未被生产代码导入的包仅作开发依赖，但仍校验精确版本；测试证明从 src 导入而未声明运行依赖会失败，修复操作也不会把测试依赖提升为消费者 peer。

## Testing

真实已发布 Team／AgentLoop／JSONL 测试覆盖首轮角色及路由、显式调用强度、按成员自身 Session 寻址的原生命名和通信、跨完整 Context 重建的冷恢复、插件替换、仅由 restore() 组合的活跃成员、并发快照隔离、初始化取消、直接 provider 调用拒绝、仅限 Lead 与空 prompt 的拒绝、继承绑定属于父级的 seed fork、后到 Team 激活／卸载，以及重复 compact 初始化。成员流量断言按 Session 而非数组位置选取请求，这是它们不受 Lead 调度影响的原因。目录测试覆盖模式替换与不授权创建的 Team 文案。模型适配器使用内存实现，不宣称已执行付费模型调用或桌面 profile 重启。每项受守护行为均经变异确认：关闭组合、路由、绑定过滤、恢复或任一拒绝路径都会让套件失败。

## Related decisions

合并并取代未提交的 one-delegation-surface-per-deployment 记录：保留命名空间隔离、动态服务检测和拒绝并行管理；不保留关闭角色能力。旧记录的管理替代方案保留于此。扩展[角色目录约定](2026-09-22-subagent-delegation-contract.zh.md)，保留[独立双通道委派](../bug-fix/2026-10-02-role-delegation-two-channels.zh.md)。
