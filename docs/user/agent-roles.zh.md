# 代理角色与存储

技能、命令和代理角色 Tab 同时展示已安装 suite 与用户条目。来源筛选区分二者，同名条目仍有独立身份。托管 suite 条目只读——内容修改会被拒绝，文件归 suite 所有，上游刷新可随意替换。代理角色是唯一例外：卡片上的编辑只打开路由表单（供应商、模型、思考强度），服务端只接受这部分 frontmatter 差异；技能与命令卡片仅提供启用开关。外部本地 source 文件同样只读展示，需要定制时新建用户条目。

代理角色详情顶部使用供应商与模型联动下拉，从 DSH 当前 LLM 注册表获取供应商，只读取选中供应商的模型。选择继承时沿用主会话；已保存但暂不可用的值会保留，目录加载失败可重试。当文件中保存的路由声明不会被执行器采用时，表单会给出提示；表单也不再编辑 `tools` / `disallowedTools`——这些键仍留在 frontmatter 中并由原始编辑器保留，但表单不为一个不生效的字段提供控件。未知字段、数组和注释保持不变。例如：

```yaml
---
name: reviewer
description: 审查实现变更
model: my-provider/my-model
reasoning_effort: high
tools: [read_file, search_files]
---
检查正确性并提供具体证据。
```

路由只有"精确"或"继承"两种结果。省略 `model` 或填写 `inherit` 表示子代理沿用父代理路由。同时写出 `provider` **和** `model` 才会选中该精确路由，并在启动子代理前经宿主 LLM 适配器校验。其余任何写法——单独模型 ID、`provider/model` 字符串、`sonnet` 这类 Claude 别名、只写 `provider`——都会被忽略并给出诊断，子代理改为继承父代理路由。`tools` 与 `disallowedTools` 保留在文件中、仍可编辑，但不会生效。

`reasoning_effort` 设置模型思考强度，也接受 `reasoningEffort`，但两者值冲突时拒绝执行。思考强度选择框从 DSH 读取所选模型声明的等级及默认值。选择“自动”移除显式强度；通过控件切换供应商或模型时清除旧强度，暂不可用的已保存值保留显示直到修改。继承或尚未解析的模型仅提供“自动”和已保存值，不猜测可用等级；加载失败可重试。选定等级后写入 `reasoning_effort` 并移除 camelCase 别名，保留其余 frontmatter 和 Markdown。未声明强度时，只有最终供应商/模型路由不变才继承父代理最近一次请求的强度；切换路由则采用新模型默认值。启动子代理前由宿主 LLM 校验最终供应商、模型与强度；当声明的路由或强度不受支持时，整份路由声明被丢弃，子代理继承父代理路由，并给出诊断。

`subagent-catalog` 采用 DSH skills catalog 的机制：每次 `agent/pre-step` 读取当前角色快照，对发布条目计算摘要，与会话日志中最近可见的目录比较。首次非空目录注入一次；变更时发布完整替换目录；全部移除时发布明确的空目录。恢复和 fork 从持久化条目恢复状态，压缩隐藏目录后会补发。读取不完整时不发布部分替换。模型看到的目录是一段提醒，逐行用反引号给出可读角色名称与描述，仅此两项；角色标题、配置的路由和角色指令正文都不在其中。变更检测覆盖名称、持久化角色身份、描述与配置的路由，因此只改标题不会重新发布。不透明的来源 ID 仅保留在持久化来源中，用于执行，不进入模型看到的正文。

`GET /api/agent-plugins/model-catalog?provider=<id>&model=<id>` 通过 `llm.resolveModelInfo` 只解析指定模型。响应增加 `reasoning: { efforts: [{ id, name, description? }], defaultEffort? }`，未声明思考强度的模型返回空等级列表。省略 `model` 时保持原有供应商/模型列表行为。适配器等待上限为十秒，失败返回 HTTP 503。

## 委派模式

未启用 Agent Teams 时，调用 `subagent_role`，提供目录中的准确 `agent` 与独立完整的 `prompt`。省略或传 true 的 `run_in_background` 立即返回 `{ kind: 'continuable', subagentId }`；false 等待 `{ kind: 'foreground', runId, output }`。没有受跟踪作业通道或 action 参数，子代理不继承父对话。

启用 Agent Teams 后，调用 `spawn_teammate_role(agent, name, description, prompt)`。可选 `provider`、`model`、`reasoning_effort` 沿用调用优先于卡片的路由规则；provider 指 LLM 路由而非 Team 传输后端。只有 Lead 在用户明确要求 Team 工作后才能创建成员。成员始终从全新上下文启动，没有前台／fork 参数。结果包含 `target`、角色身份与有效模型路由；通信、中断、名册和共享任务由原生 Team 工具管理。后续任务复用成员；同一角色可用于多个成员，但成员名称不可复用。

两种模式下模型可见的目录标题都为 `subagent-catalog`，角色工具参数明确引用这个标题。Team 模式下目录继续作为精简的发现与选择列表：先匹配专业角色再用增强入口，无匹配或需要 fork 时使用原生创建。目录和增强创建工具仅对 Lead 可见，成员及非 Team 子代理不可见也不可调用该工具，执行时仍保留 Lead 身份检查；即使角色名称不变，模式或指导文案变化也会在下一步发布一次替代说明，保留此前历史。Team 服务后到时撤下独立入口；增强创建仍需要 sessions、会话查询与系统提示词服务。缺少依赖时不回退到 Team 看不见的独立子代理。

独立的 **Team coordination** 系统段面向原生和角色成员，即使角色目录为空或被过滤也可用；它只依赖 agents、Agent Teams 和系统提示词服务。用户授权 Team 工作后，提示引导 Lead 尽早分派独立调研、广泛探索、实现与验证，同时保留需求沟通、范围决策、方向更新和最终验收。成员收到自己的真实 Team 名称、保留的 Lead 通信地址 `target: "lead"` 及回报阻塞、证据和结果的说明。这是协作指导，不新增权限，也不替代宿主策略。

协调段在每次提示组装时按准确的活跃 Agent 身份解析，因此压缩或成员恢复后仍可用，无需再追加目录消息。它不鼓励轮询状态或仅为收结果而阻塞：阶段性反馈不等于完成声明，最终交付仍需要必要的成员结果与验证。用户纠正通过共享任务和消息传给已有成员；重叠工作需要明确交接。增强创建还会在初始上下文消息中给出可读角色名和 Team 身份；内部角色 ID 留在持久元数据中。

角色指令与已验证路由在首个请求前固定，通过宿主 inbox 保存到插件自有消息来源。冷恢复和插件重载使用创建时快照，不读取后来编辑的角色卡。恢复这份配置需要继续安装本插件。不要把原生 rc.2 名册当作路由依据：角色成员在活跃期间由插件把角色路由写入其自身 Agent，运行中的行因此一致，成员空闲后没有活跃 Agent 则回退为 Lead 的模型。有效路由以本工具结果为准，不要读 `list_agents`。调用产生供应商正常用量。

角色不是技能或斜杠命令。项目发现遵循调用目录及 `scanProjectLayouts`。编辑与启停影响后续 step／新成员，不改变已接受任务或成员快照。外部发现使用扫描缓存 TTL 或手动刷新，没有文件监听。`tools` 与 `disallowedTools` 保留但不执行权限限制。转述前应核对子代理报告。

插件状态位于 `$DSH_HOME/agent-plugins`，默认 `~/.dsh/agent-plugins`：`.sources` 保存 checkout，`state.json` 保存安装状态，`data` 保存 suite 可变数据与配置。自建资源位于共用的 Agent 布局根目录 `~/.agents/{skills,commands,agents}/`，与 `~/.agents/mcp.json`、`~/.agents/lsp.json` 的服务声明同级。旧 `userRoot`、`dataRoot` 仅作为迁移来源。启动时迁移旧目录、`agent-plugins-data`、`data/user`、`user/<kind>` 条目，以及旧的 `mcp-servers.json` / `lsp-servers.json` 声明；冲突文件保留原位，并报告路径、阻止激活，解决后重启。项目级和显式外部本地 source 仍按原有就地读取约定处理。

模型路由参考 [DSH Subagent Model Router](https://github.com/CypherNaught-0x/DSH-Subagent-Model-Router)，frontmatter 遵循 [Claude Code subagent 定义](https://code.claude.com/docs/en/sub-agents)。
