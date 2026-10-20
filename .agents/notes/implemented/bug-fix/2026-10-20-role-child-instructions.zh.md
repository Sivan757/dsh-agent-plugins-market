# Agent Note: 由插件组合角色子代理的指令

Status: implemented

## Problem

`subagent_role` 工具承诺角色自身的指令会生效。插件把它们以 `persona: policy.content` 放进子代理启动请求，宿主 0.2.0-rc.2 会读这个字段。

宿主 0.2.1 从 `SubagentStartRequest` 中删除了 `persona`，并开始对自家工具拒绝该字段。插件继续发送，宿主静默丢弃，于是已安装宿主上的每个角色子代理都在没有角色卡正文的情况下运行，而工具仍报告成功。角色子代理仍然进入目录、仍然拿到路由，失败表现为顶着角色名给出自信但无指令依据的输出，且没有任何诊断。插件自己的测试把这种坏行为固定了下来：断言请求携带 `persona`，而该线上的任何宿主都不再读取它。

插件本来就为角色成员用作用域提示词段与持久创建快照组合指令。宿主删除字段后，角色子代理失去了等价路径。

## Decision

`packages/market-runtime/src/runtime/agents/role-composition.ts` 负责一个角色子代理的指令。

- 子代理身份用既有 `@deepseek-ai/dsh-session` peer 的 `SessionId(randomUUID())` 铸造，并放进启动输入，使插件能在宿主发布子代理之前完成组合。
- 每条宿主线只用一种机制，由接缝判定。成员拼写就是判据：`startContinuable` 存在时宿主仍读请求里的 `persona`，请求携带它且插件不装段；从 `0.2.1-alpha.2` 起请求不再带 `persona`，插件通过子代理自己的 `systemPrompt` 以 `interpolate: false` 安装 `deployment:persona-prefix`。
- 段在 `agent/created` 上安装，宿主在投递首个提示前等待该事件，因此首个模型请求已带角色卡正文。
- 创建时记录一条插件自有的上下文消息，携带角色身份与卡片正文，并要求 `ctx.sessions.flush` 返回 true。之后的恢复读取该记录并重新安装段，且不再追加第二条消息。
- 该通道失败即关闭。缺少持久化服务时在子代理出现前拒绝调用；段无法安装或绑定无法提交时拒绝创建，宿主回滚子代理；错误信息点名角色。
- `applyRoleRoute` 与 `installPersonaSection` 移入该模块，角色成员与角色子代理共用同一份事实的唯一写入者。

角色工具挂载时同时订阅。`systemPrompt` 加入其 inject 列表，而 `sessions` 与 `sessionQuery` 保持可选读取：`sessionQuery` 是可选宿主 peer，硬性依赖会让缺少它的宿主完全挂不上角色工具。

## Alternatives considered

- **为每张角色卡注册一个 Agent Preset。** 因语义否决。`agentPreset` 在 0.2.1-alpha.3 之前不存在，底层宿主仍需要另一条分支；且预设必须能被 loader 解析，因为注册会挂载插件树。角色卡路径必须在没有 loader 条目时可用。
- **把卡片正文前置到提示词。** 否决。内容变成用户消息，失去系统提示词权威，与任务文本竞争，并且压缩后的存活方式不同。
- **保留请求 `persona` 并做类型转换。** 否决。宿主只复制已知字段，该字段在已安装线上是惰性的；转换会掩盖静默丢失而不是恢复行为。
- **只修前台崩溃，把指令缺口记录下来。** 否决。没有指令的子代理会顶着角色名产出错误结果，比 issue 报告的崩溃更糟。

## Consequences

- 两条宿主线上的每个角色子代理都收到角色卡正文，工具声明的契约重新成立。
- 角色子代理在两条通道上都需要会话持久化。`delivery: 'caller'` 让宿主侧持久化变成可选，但持久绑定让插件侧变成必需；缺少它的宿主会按名字拒绝调用。
- 组合依赖宿主的预设组合不在同一子代理作用域注册 `deployment:persona-prefix`。已安装的 0.2.1-rc.2 宿主配合测试工具不组合该段，真实宿主测试断言卡片正文进入子代理首个系统提示词。若某个部署的预设已注册该名字，创建会被拒绝而不是静默替换。
- `docs/user/agent-roles.md` 与其中文对偶写明该组合与恢复行为。工具描述无需改字：其中"角色指令生效"的陈述重新成立。
- `packages/market-runtime/test/role-composition.test.ts` 端到端驱动已发布宿主包，覆盖首个系统提示词、段安装失败即关闭、绑定无法持久化、持久化服务缺失，以及完整上下文重启后仍只有一条绑定记录。
