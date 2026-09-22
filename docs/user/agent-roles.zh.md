# 代理角色与存储

技能、命令和代理角色 Tab 同时展示已安装 suite 与用户条目。来源筛选区分二者，同名条目仍有独立身份。编辑托管 suite 条目会修改对应 Markdown 文件及 YAML metadata；上游刷新可能覆盖这些修改。外部本地 source 文件只读展示，需要定制时新建用户条目。

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

使用 `subagent_role`，传入 `agent`（当前目录中的可读名称，只有冲突时才增加套件/来源限定）和 `prompt`（子代理在没有本会话的情况下也能执行的交底：任务、相关文件与已有结论、期望的输出形式、范围边界）。它替代 `market_agent`，没有 `action`、列表调用或旧名别名。目录把这份操作约定与角色名单一起发布，组织方式与宿主自己的子代理提示词一致：使用说明、提示词的写法、以及不该使用角色子代理的场景。这段文本固定为英文，不随界面语言设置变化，模型读到的约定因此不会因为操作者的语言偏好而改变。没有匹配角色时，说明指向宿主的通用委派工具，不再逐一列举与仲裁它们；这些工具的语义由它们自己的描述承载。执行时重新读取角色与安装状态，应用角色指令与有效路由，并通过三条通道之一运行子代理：默认在 `spawn` 后端上启动一个可继续的子代理，在 inbox 接受时立即返回 `{ kind: 'continuable', subagentId }` 而不等待；传 `run_in_background: true` 时把同一个子代理作为受跟踪的后台任务启动，返回 `{ kind: 'background', jobId }` 供 `job_output` 与 `job_kill` 使用；传 `run_in_background: false` 时在前台运行一个子代理并返回 `{ kind: 'foreground', runId, output }` 及其报告。调用传入的 `provider` 与 `model` 覆盖角色卡路由，`reasoning_effort` 覆盖它的思考强度。子代理不继承父会话对话。子代理结束时运行时投递 `subagent-settled` 通知，携带结果与最终答复；运行期间可用 `send_message` 追加指令，`list_agents` 可列出它。在通知到达之前，子代理的发现并不存在；它的答复是一份报告，父代理对外给出的结论，其证据仍由父代理自己核对。目录里没有匹配的角色时，改用宿主的通用委派通道；这些工具的调度方式、参数与限制由它们自己的描述承载。工具与目录需要宿主 `agents`、`tools`、`llm`、`subagents` 与会话持久化服务。调用产生所选供应商的正常模型用量。

角色不再注册为 `agent-*` 或 `persona-*` 技能、斜杠命令。普通技能或命令本身以这些前缀命名的，不受影响。只有本插件的准确 `subagent_role` 工具在当前作用域可见时才展示目录；工具被隐藏或替换后清空已发布目录。项目角色从调用会话的工作目录解析，并遵循 `scanProjectLayouts`。界面编辑、启停变更在下一次模型 step 生效，不会修改已发送的请求。外部文件发现仍使用现有扫描缓存 TTL 或手动刷新，本次没有添加文件监听。

插件状态位于 `$DSH_HOME/agent-plugins`，默认 `~/.dsh/agent-plugins`：`.sources` 保存 checkout，`state.json` 保存安装状态，`data` 保存 suite 可变数据与配置。自建资源位于共用的 Agent 布局根目录 `~/.agents/{skills,commands,agents}/`，与 `~/.agents/mcp.json`、`~/.agents/lsp.json` 的服务声明同级。旧 `userRoot`、`dataRoot` 仅作为迁移来源。启动时迁移旧目录、`agent-plugins-data`、`data/user`、`user/<kind>` 条目，以及旧的 `mcp-servers.json` / `lsp-servers.json` 声明；冲突文件保留原位，并报告路径、阻止激活，解决后重启。项目级和显式外部本地 source 仍按原有就地读取约定处理。

模型路由参考 [DSH Subagent Model Router](https://github.com/CypherNaught-0x/DSH-Subagent-Model-Router)，frontmatter 遵循 [Claude Code subagent 定义](https://code.claude.com/docs/en/sub-agents)。
