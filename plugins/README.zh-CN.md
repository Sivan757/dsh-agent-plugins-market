# dsh-agent-plugins

[dsh-agent-plugins-market](https://github.com/Sivan757/dsh-agent-plugins-market) 的第一方插件集合。market 是 DeepSeek Harness 的插件，负责按原样安装 agent 插件。`plugins/` 下每个目录都符合 [Agent Plugins v1 规范](https://agent-plugins.org/specification)：根 `plugin.json`、`skills/` 技能、`mcp.json` MCP 服务器，以及 DeepSeek Harness 专属面（命令、代理角色、hooks、LSP 声明）放在 `com.deepseek.harness/` 扩展命名空间。

本仓库是这些插件的创作地，market 插件预置了一条指向本仓库的来源记录——全新安装即可在市场里看到这个集合，不需要任何人粘贴地址。

## 插件

### `plugin-dev` — 创作工具集

移植自参考生态的插件开发工具集，并融合技能创建器与评估套件。8 个技能、1 条命令、3 个代理角色。

| 面 | 资产 |
| --- | --- |
| 技能 | `plugin-structure`、`agent-development`、`command-development`、`hook-development`、`mcp-integration`、`plugin-settings` |
| 创建 + 评估 | `skill-creator`（创建、改进、基准测试与触发优化）、`plugin-evals`（评估套件：评分器与无插件基线） |
| 命令 | `/create-plugin` |
| 代理角色 | `agent-creator`、`plugin-validator`、`skill-reviewer` |

### `toolkit` — 内置工具集

项目会话的日常能力。7 个技能、5 条命令、2 个代理角色。

| 面 | 资产 |
| --- | --- |
| 技能 | `init`、`explore`、`verify`、`simplify`、`insight`（本地回顾已记录的会话：自包含的 HTML 仪表盘与 JSON 报告，离线、无需额外安装）、`agents-md-audit`（按质量标准审计并改进 AGENTS.md）、`automation-recommender`（读代码库，推荐它需要的 hooks、技能、代理与 MCP 服务器） |
| 命令 | `/code-reviewer`、`/revise-agents-md` |
| 代理角色 | `code-reviewer`、`code-simplifier` |

技能不需要另配命令：每个技能本身就是以自己名字命名的斜杠入口，`/init`、`/explore`、`/verify`、`/simplify`、`/insight`、`/agents-md-audit`、`/automation-recommender` 都直接调用该技能。上面两条命令之所以单独存在，是因为它们做了单个技能做不到的事——`/code-reviewer` 对当前变更调度两个审查代理，`/revise-agents-md` 把本次会话的经验落成 AGENTS.md 的补充。

### `engineering` — 工程工作流

面向系统开发与改造的工作流。2 个技能、11 条命令、12 个代理角色，以及它们驱动的工作流脚本。

| 面 | 资产 |
| --- | --- |
| 技能 | `playground`（自包含的交互式 HTML 探索页）、`frontend-design`（视觉设计取向） |
| 特性开发 | `/feature-dev` 搭配 `code-explorer`、`code-architect`、`code-reviewer` 三个代理角色 |
| 遗留系统改造 | `/modernize-preflight`、`/modernize-assess`、`/modernize-map`、`/modernize-extract-rules`、`/modernize-brief`、`/modernize-reimagine`、`/modernize-transform`、`/modernize-uplift`、`/modernize-harden`、`/modernize-status`，由六个工作流脚本驱动，配八个专用代理角色 |
| 安全 | `security-reviewer` —— 审查变更，只报高置信度的可利用缺陷 |

## 安装

安装 [dsh-agent-plugins-market](https://github.com/Sivan757/dsh-agent-plugins-market) 即可：market 已预置指向本仓库的来源记录，刷新该来源即可拉取插件并安装。手动把本仓库添加为来源同样可行——开发中的插件走这条路，或用于记录已被删除的 market。

## 仓库规则

- `plugins/<name>/` 就是一个插件：目录本身是 market 安装的东西，手工编写。
- `plugin.json` 遵循 Agent Plugins v1 schema（`$schema` 指明版本）；`com.deepseek.harness` 命名空间在 `extensions` 里声明后，命名空间目录才会被读取——见[命名空间指南](../docs/reference/harness-namespace-authoring.md)。
- 技能位于 `skills/<name>/SKILL.md`——一层深度，与规范固定的发现规则一致。
- 命名空间扩展面：`com.deepseek.harness/commands/*.md`、`com.deepseek.harness/agents/*.md`、`com.deepseek.harness/hooks/hooks.json`、`com.deepseek.harness/lsp.json`。
- 移植内容以上游原文为基底；适配仅限机械映射——工具名、文件名、路径、前置字段、厂商字样。
- 凭证绝不写成字面值；用户级 `~/.agents/mcp.json` 条目用 `${NAME}` 引用凭证。

## 许可

[MIT](../LICENSE)。`plugins/plugin-dev` 与 `plugins/engineering` 移植的内容以 Apache-2.0 分发——两者都随插件保留该[许可](plugin-dev/LICENSE)，内置的 `skill-creator` 技能保留[自己的副本](plugins/plugin-dev/skills/skill-creator/LICENSE.txt)。
