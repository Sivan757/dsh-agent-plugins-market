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

`subagent-catalog` 采用 DSH skills catalog 的机制：每次 `agent/pre-step` 读取当前角色快照，对发布条目计算摘要，与会话日志中最近可见的目录比较。首次非空目录注入一次；变更时发布完整替换目录；全部移除时发布明确的空目录。恢复和 fork 从持久化条目恢复状态，压缩隐藏目录后会补发。读取不完整时不发布部分替换。目录显示可读角色名称、名称、描述、配置的供应商/模型和思考强度，不包含角色指令正文。不透明的来源 ID 仅保留在持久化来源中，用于执行和变更检测，不进入模型看到的正文。

`GET /api/agent-plugins/model-catalog?provider=<id>&model=<id>` 通过 `llm.resolveModelInfo` 只解析指定模型。响应增加 `reasoning: { efforts: [{ id, name, description? }], defaultEffort? }`，未声明思考强度的模型返回空等级列表。省略 `model` 时保持原有供应商/模型列表行为。适配器等待上限为十秒，失败返回 HTTP 503。

使用 `subagent_run`，传入 `agent`（当前目录中的可读名称，只有冲突时才增加套件/来源限定）和 `prompt`（完整任务及必要上下文）。它替代 `market_agent`，没有 `action`、列表调用或旧名别名。执行时重新读取角色与安装状态，应用角色指令与它声明的精确路由，在 `spawn` 后端上启动一个可继续的子代理，并在 inbox 接受时立即返回 `{ subagentId }`，不等待结果；子代理不继承父会话对话。子代理结束时运行时投递 `subagent-settled` 通知，携带结果与收尾消息；运行期间可用 `send_message` 追加指令，`list_agents` 可列出它。工具与目录需要宿主 `agents`、`tools`、`llm`、`subagents` 与会话持久化服务。调用产生所选供应商的正常模型用量。

角色不再注册为 `agent-*` 或 `persona-*` 技能、斜杠命令。普通技能或命令本身以这些前缀命名的，不受影响。只有本插件的准确 `subagent_run` 工具在当前作用域可见时才展示目录；工具被隐藏或替换后清空已发布目录。项目角色从调用会话的工作目录解析，并遵循 `scanProjectLayouts`。界面编辑、启停变更在下一次模型 step 生效，不会修改已发送的请求。外部文件发现仍使用现有扫描缓存 TTL 或手动刷新，本次没有添加文件监听。

插件管理的用户级存储统一位于 `$DSH_HOME/agent-plugins`，默认 `~/.dsh/agent-plugins`：`.sources` 保存 checkout，`state.json` 保存安装状态，`user/{skills,commands,agents}` 保存自建资源，`data` 保存 suite 可变数据与配置。旧 `userRoot`、`dataRoot` 仅作为迁移来源。启动等待旧目录、`agent-plugins-data` 以及 `data/user` 迁移完成；冲突文件保留原位，并报告路径、阻止激活，解决后重启。项目级和显式外部本地 source 仍按原有就地读取约定处理。

模型路由参考 [DSH Subagent Model Router](https://github.com/CypherNaught-0x/DSH-Subagent-Model-Router)，frontmatter 遵循 [Claude Code subagent 定义](https://code.claude.com/docs/en/sub-agents)。
