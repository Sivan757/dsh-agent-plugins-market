# 代理角色与存储

技能、命令和代理角色 Tab 同时展示已安装 suite 与用户条目。来源筛选区分二者，同名条目仍有独立身份。编辑托管 suite 条目会修改对应 Markdown 文件及 YAML metadata；上游刷新可能覆盖这些修改。外部本地 source 文件只读展示，需要定制时新建用户条目。

代理角色详情顶部使用供应商与模型联动下拉，从 DSH 当前 LLM 注册表获取供应商，只读取选中供应商的模型。选择继承时沿用主会话；已保存但暂不可用的值会保留，目录加载失败可重试。工具配置仍保存于同一份 frontmatter，未知字段、数组和注释保持不变。例如：

```yaml
---
name: reviewer
description: 审查实现变更
model: my-provider/my-model
tools: [read_file, search_files]
---
检查正确性并提供具体证据。
```

工具名应填写当前 DSH profile 实际提供的名称；不会自动转换 Claude Code 工具名或模型别名。省略 `model` 或填写 `inherit` 表示继承父代理模型。单独模型 ID 必须能从已注册供应商中唯一确定；也可使用 `provider` 配合 `model`，或 `provider/model` 明确指定供应商。`tools` 和 `disallowedTools` 支持逗号分隔字符串或 YAML 数组，通过宿主子代理请求实际执行限制。

`market_agent` 工具通过 `action: list` 列出可用角色，通过 `action: run`、`role`、`prompt` 执行角色。使用列表返回的准确身份。每次执行重新读取角色文件和安装状态，将正文作为 persona，等待子代理结果。需要宿主提供 `tools`、`llm`、`subagents` 服务；模型不可用、metadata 无效或角色禁用时返回错误。调用会产生所选供应商的正常模型用量。

插件管理的用户级存储统一位于 `$DSH_HOME/agent-plugins`，默认 `~/.dsh/agent-plugins`：`.sources` 保存 checkout，`state.json` 保存安装状态，`user/{skills,commands,agents}` 保存自建资源，`data` 保存 suite 可变数据与配置。旧 `userRoot`、`dataRoot` 仅作为迁移来源。启动等待旧目录、`agent-plugins-data` 以及 `data/user` 迁移完成；冲突文件保留原位，并报告路径、阻止激活，解决后重启。项目级和显式外部本地 source 仍按原有就地读取约定处理。

模型路由参考 [DSH Subagent Model Router](https://github.com/CypherNaught-0x/DSH-Subagent-Model-Router)，frontmatter 遵循 [Claude Code subagent 定义](https://code.claude.com/docs/en/sub-agents)。
