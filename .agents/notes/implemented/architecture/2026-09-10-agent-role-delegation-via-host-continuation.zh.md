# Agent Note: 基于宿主 continuation seam 的角色委派

Status: implemented

## Problem

`subagents_run` 自带了一整套宿主子代理路由逻辑的副本：裸模型 id 解析、父级选项合并、路由感知的强度规则、适配器预检，以及同步结果收集。它还把每张卡片的 `tools` / `disallowedTools` 当作宿主的 `toolFilter` 下发。

按本机实际安装的语料（663 张 agent 卡片）实测，这些全都没有生效。**0 张**卡片声明 `provider`，因此裸 id 解析器一张都服务不到，却拒绝了其中 407 张。声明 `tools` 的 556 张里有 **555 张**写的是 Claude Code 工具名，被宿主大小写敏感的 `tools.restrict()` 直接拒绝，这些委派在子代理创建之前就失败了。而真正跑起来的那次限制也不是保护，而是漏的：一张声明 `allow: ["write","read"]` 的卡片，最终产出的子代理持有五个工具——`subagent`、`list_agents`、`send_message` 都逃了出去。

与此同时，宿主把同一项能力做得更好：`ctx.subagents` 提供精确路由契约、带持久恢复与转向的可继续生命周期与结算机制，随附的 `subagent` 工具还读取按 Session 快照的用户授权。在它旁边再实现一份更弱的副本，没有换来任何东西。

## Decision

`subagent_run(agent, prompt)` 是宿主 continuation seam 之上的一层薄角色封装。它解析目录中的角色，把卡片正文作为子代理 persona，并在 `spawn` 后端用 `ctx.subagents.startContinuable` 启动一个可继续子代理，在 inbox 接受时返回 `{ subagentId }`。它**不等待结果**：运行时投递 `subagent-settled` 通知，携带结果与收尾消息；运行期间可用 `send_message` 追加指令，`list_agents` 可列出它。

路由只有"精确"或"继承"两种结果。只有当卡片**同时**声明 `provider` 与 `model` 时，它才贡献子代理 LLM 选项；该组合连同可选的 `reasoning_effort`，在子代理启动前经 `llm.resolveCallConfig` 校验一次。其余任何写法——单独模型 id、`provider/model` 字符串、`sonnet` 这类 Claude 别名、只写 `provider`、不受支持的强度——都会经诊断出口上报，子代理改为继承父代理路由。裸 id 解析器与 `provider/model` 语法糖均已删除。

工具过滤整体移除。`tools` 与 `disallowedTools` 仍是原始编辑器保留的 frontmatter，但执行器不再读取它们，因此卡片既不能收窄也不能放宽子代理的工具集。角色编辑器同步跟进：不再为一个不生效的字段渲染控件，并在保存的路由声明会被执行器忽略时给出提示。

目录只为精确的 `provider` + `model` 组合展示路由，因此不会承诺一条执行器会降级掉的路由。工具保留 3 的硬深度上限，并依赖宿主的 `agents`、`tools`、`llm`、`subagents` 与会话持久化服务。

## Alternatives considered

**翻译 Claude 工具方言并保留过滤。** 不采用：映射表要为 26 个不同的 Claude 名称、带参形式（`Bash(git:*)`）和 MCP 命名空间名（`azure-mcp/*`）发明语义，白名单本身仍然漏掉三个委派工具，而且这些字段名属于另一个产品的工具注册表。一张无法被精确兑现工具列表的卡片，用父代理的工具集比用一个猜出来的子集更合适。

**保留裸模型 id 解析器作为便利功能。** 不采用：它服务 0 张卡片，却拒绝 407 张。

**路由不可解析时硬失败而非降级。** 不采用：语料中三分之二的卡片声明的模型在本部署无法解析。让这些调用失败，会留下一个模型看得见却永远用不了的目录——而这正是本次改动要消除的缺陷。降级始终有诊断上报，绝不静默。

**保留同步前台委派。** 由负责人否决，宿主自身的设计也一致：角色工作是长时的，而恢复、转向与结算本就属于 continuation manager。同步执行器必须自己承担子代理释放与 stop-reason 映射，而宿主做得更好。

**对卡片路由套用宿主的 `subagent-model-selection` 白名单。** 不采用：宿主豁免 config-owned 路由——`assertAllowedModelSelection` 在模型未提供路由字段时提前返回——因此卡片声明的路由与 `Config.agentOptions` 同类。套用它只会给本就失败的卡片再加一条拒绝路径，而且该设置默认关闭。

**不改成可继续，只让角色子代理出现在 `list_agents` 中。** 不可行：列表工具会丢弃所有 mode 不是 `continuable` 的条目。让它们可见的正是可继续委派，因此异步决策已经包含了那个可见性诉求。

## Consequences

- 分工变得明确：宿主负责路由授权、生命周期、转向与结算；本插件负责角色注册表、目录发布与每角色 persona。
- 会话持久化成为硬性要求。缺少它时宿主的 `startContinuable` 会抛 `PERSISTENCE_UNAVAILABLE`；随附 profile 在 base bundle 中装载 `session-persistence-jsonl`，因此这是已声明的依赖，而不是新增的部署负担。
- 555 张卡片从必然失败变为可用父代理工具集运行；另外 328 张同时声明了不可解析模型的卡片，现在继承父代理路由而不是中止。
- 既有的 `subagents_run(role=…)` 调用方会在三个维度上断裂：工具名、`agent` 参数，以及不再有可等待的结果。
- 我们放弃的东西：frontmatter 不再能表达每角色的最小权限。一张想只读的卡片无法声明这一点，子代理会拿到父代理的工具集。
- 测试固定了：不含工具字段的严格解析、精确路由经预检生效、每种非精确声明都降级并给出诊断、预检期间触发的取消、`startContinuable` 的请求形状（含不携带 `toolFilter`）、以 `agent` 参数注册 `subagent_run`、目录条目省略非精确路由，以及编辑器在无 `tools` 控件时的忽略路由提示。

## Related decisions

部分取代[持久子代理目录与角色执行](2026-09-09-subagent-catalog.zh.md)：目录发布、角色身份与严格解析继续有效；同步一次性执行、工具过滤与内部路由解析不再有效。本次对齐的宿主侧决策记录在 `deepseek-harness` 的 model-selected subagent routes 与 user-authorized subagent model routes 两篇 note 中。
