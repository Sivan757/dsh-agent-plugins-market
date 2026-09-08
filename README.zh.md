<img src="docs-site/public/favicon.svg" alt="" width="48" height="48" />

# dsh-agent-plugins-market

**[DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness)的插件市场与 Agent 能力管理工作区。**

复用 Claude Code、Codex、Cursor 套件中支持的内容及社区兼容布局，在 DSH Web 界面管理自己的技能、命令、代理角色、MCP 服务和 LSP 服务。支持的布局原地读取，无需转换清单或手动将文件复制到 DSH。各格式的具体限制见能力矩阵。

[English](README.md) | 简体中文 | [文档站](https://sivan757.github.io/dsh-agent-plugins-market/) | [npm](https://www.npmjs.com/package/dsh-agent-plugins-market)

[![npm version](https://img.shields.io/npm/v/dsh-agent-plugins-market)](https://www.npmjs.com/package/dsh-agent-plugins-market) [![License](https://img.shields.io/github/license/Sivan757/dsh-agent-plugins-market)](LICENSE)

[快速开始](#快速开始) · [日常使用](#日常使用) · [兼容性](#兼容性与运行边界) · [常见问题](#常见问题)

![当前六页签 Agent Plugins 工作区](docs/screenshot-workspace.png)

## 你可以用它做什么

- **复用生态套件。** 添加 Git 仓库、本地目录或压缩包作为来源，浏览、预览、安装和启用其中的套件，让支持的能力在 DSH 运行时生效。
- **建立自己的工具集。** 创建技能、可复用的斜杠命令和代理角色；随时编辑，也可以保留文件而暂时禁用。
- **沿用项目资源。** 直接发现项目 `.claude/`、`.agents/` 中的技能与代理，无需安装或复制文件。
- **集中管理服务。** 配置 MCP 凭据与授权，查看 MCP / LSP 状态，在同一工作区定位服务不可用的原因。

## 快速开始

需要 Node.js 22+、启用了技能服务的 DSH Web profile；使用 Git 来源还需要 Git。当前仓库声明的 DSH peer 包版本范围为 `^0.1.2-rc.1`，各项能力还取决于 profile 提供的宿主服务，详见[宿主要求](docs/guides/usage.zh.md#宿主要求)。

将 `<name>` 替换为你的 profile 名称后安装：

```sh
dsh plugin --profile <name> add dsh-agent-plugins-market
```

1. 重启 DSH，打开 **设置 → Agent Plugins 市场**。旧版外壳可能显示为顶层页面入口。
2. 在**插件市场**添加来源，例如 `https://github.com/anthropics/claude-plugins-official`。插件不预置来源。
3. 打开套件查看内容，确认后安装，并确保套件已启用。
4. 如果套件提供技能，先在**技能**页签查看，再在聊天中输入 `/` 查找允许手动调用的技能。如果提供 MCP，前往 **MCP 服务**检查状态，处理凭据或连接提示后再使用工具。

GitHub 安装和 profile 配置方式见[使用指南](docs/guides/usage.zh.md#其他安装方式)。

## 日常使用

工作区包含六个页签：

| 页签     | 可以做什么                                                                      |
| -------- | ------------------------------------------------------------------------------- |
| 插件市场 | 添加来源、预览套件、安装 / 卸载、启用 / 禁用和刷新。                            |
| 技能     | 浏览技能，创建或编辑自己的可复用指令。                                          |
| 命令     | 管理通过 `/名称` 调用的提示词模板；`$ARGUMENTS` 替换为命令后输入的文本。        |
| 代理角色 | 从 DSH 下拉选择供应商和模型，管理角色指令与工具；通过 `market_agent` 委派任务。 |
| MCP 服务 | 配置服务、凭据与授权，查看连接状态并重试失败的服务。                            |
| LSP 服务 | 配置语言服务器，查看运行状态。                                                  |

**来源（source）**表示内容来自哪里，**套件（suite）**是从中发现的可安装单元。添加来源用于发现套件；安装并启用套件决定其运行时能力是否生效。套件详情用于预览文件，MCP 凭据和覆盖配置在 **MCP 服务**中编辑。

自建技能、命令和角色以 Markdown 保存于 `~/.dsh/agent-plugins/user/`，项目原生资源继续保留在项目中。路径和优先级见[存储与发现](docs/guides/usage.zh.md#存储与发现)。

## 兼容性与运行边界

支持的**布局方言（layout dialect）**描述文件如何组织：

| 布局方言             | 清单或目录约定                                                    |
| -------------------- | ----------------------------------------------------------------- |
| Claude Code          | `.claude-plugin/marketplace.json` 与 `.claude-plugin/plugin.json` |
| Codex                | `.codex-plugin/plugin.json`                                       |
| Cursor               | `.cursor-plugin/plugin.json`                                      |
| Kimi 命名兼容布局    | `.kimi-plugin/plugin.json`，非 Kimi 官方工具插件格式              |
| Universal 兼容布局   | `.plugin/plugin.json`，非 agent-plugins.org 标准                  |
| agent-plugins.org v1 | `plugin.json`，使用内置的 1.0.0 schema 校验                       |
| 技能集合             | 包含 `SKILL.md` 的目录，无需插件清单                              |

支持的**运行时能力（runtime surface）**描述 DSH 能使用什么：

| 能力  | 支持情况与条件                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------- |
| 技能  | 接入宿主技能目录，允许手动调用的技能出现在斜杠菜单；展开支持的根路径占位符。                       |
| 命令  | 通过宿主命令服务注册斜杠命令。                                                                     |
| 代理  | 代理指令作为技能接入；角色委派需要宿主 tools、LLM 和 subagents 服务。                              |
| MCP   | 默认使用内置桥接，支持 stdio、带 OAuth 的 Streamable HTTP 和旧式 SSE；也可切换宿主客户端兼容模式。 |
| Hooks | 运行 `dsh-hooks-claude-code` 桥接映射支持的 command-hook 子集。                                    |
| LSP   | 宿主具备 LSP 包时实际挂载；Agent 调用还需要 profile 暴露 LSP 工具。                                |

### 布局能力支持矩阵

按官方文档与本插件源码逐项核验（2026-09-08）。表中描述的是**本插件接入范围**：“通用”表示仅按本插件共用目录规则读取，不代表该平台定义了对应能力；“部分”须结合下方限制阅读。

| 布局 | Skills | Agents | Commands | MCP | Hooks | LSP |
| --- | --- | --- | --- | --- | --- | --- |
| [Claude Code](https://code.claude.com/docs/en/plugins-reference) | 支持 | 部分：`agents/*.md` | 部分：`commands/*.md` | 部分：文件 / 内联 | Claude command-hook 子集 | 部分：内联 |
| [Codex](https://developers.openai.com/plugins/build/plugins) | 支持 | 通用 | 通用 | 部分：`.mcp.json` | 兼容事件子集 | 通用内联 |
| [Cursor](https://cursor.com/docs/reference/plugins) | 支持 | 部分：仅 `.md` | 部分：仅 `.md` | 部分：见下方限制 | 原生事件不支持 | 通用内联 |
| Kimi 命名兼容布局 `.kimi-plugin/` | 通用 | 通用 | 通用 | 通用 | Claude 格式子集 | 通用内联 |
| Universal 兼容布局 `.plugin/` | 通用 | 通用 | 通用 | 通用 | Claude 格式子集 | 通用内联 |
| [agent-plugins.org v1](https://agent-plugins.org/specification) | 支持 | 通用，非标准 | 通用，非标准 | 标准 `mcp.json` | 通用，非标准 | 仅目录预览，非标准 |
| 无清单技能集合 | 支持 | 通用 | 通用 | 通用文件 | Claude 格式子集 | 仅目录预览 |
| 项目原生 `.claude/`、`.agents/` | 支持 | 技能指令 | 仅计数，不注册 | 不挂载 | 不挂载 | 不挂载 |

- **共用读取规则：**根 `SKILL.md`、`skills/` 或清单 `skills` 路径，以及直接位于 `agents/*.md`、`commands/*.md` 的文件。暂不读取清单自定义 agents / commands 路径，不能完整复现原平台 frontmatter、调用和工具语义。无清单目录须先被技能发现识别为套件。
- **MCP：**依次读取 `mcp.json`、`.mcp.json`、清单内联 `mcpServers`；不跟随清单中的自定义 MCP 文件路径。根 `mcp.json` 必须通过 agent-plugins.org schema 校验，因此 **Cursor 官方常见的无 schema `mcp.json` 不受支持**；`.mcp.json` 同时接受 `mcpServers` 包装和顶层直接服务器表，覆盖 Codex 官方文档的形式；Codex 的 `.app.json` 连接器映射不读取。无效的优先文件不会回退到后续文件。
- **Hooks：**只读取 `hooks/hooks.json` 或根 `hooks.json`，通过 Claude Code 桥运行其支持的 command-hook 事件；不读取清单内联 hooks 或自定义路径。Cursor 的 `afterFileEdit` 等原生事件不能据此接入。
- **LSP：**只挂载校验通过的内联 `lspServers`（含 Claude marketplace 条目）；**不读取 Claude 官方的根 `.lsp.json` 或清单指向的 LSP 文件**。`.claude-plugin/lsp/*.json` 与反向域名 `*/lsp/` 仅计数、预览。
- **规范边界：**agent-plugins.org v1 的可移植核心只有 skills 与 MCP，不能把通用 agents / commands / hooks 扫描称为标准能力。Universal 是本插件识别的兼容布局名称：[OpenHands SDK](https://docs.openhands.dev/sdk/guides/plugins)文档同样使用 `.plugin/plugin.json`，[Vercel 仓库](https://github.com/vercel/vercel-plugin/blob/main/.plugin/plugin.json)也在使用，但不存在跨厂商规范。
- **Kimi 边界：**[Kimi 官方插件文档](https://github.com/MoonshotAI/kimi-cli/blob/main/docs/en/customization/plugins.md)使用根 `plugin.json` 的 `tools` 定义；[官方 agent 文档](https://github.com/MoonshotAI/kimi-cli/blob/main/docs/en/customization/agents.md)使用 YAML。两者均未接入，未在上述官方文档中确认 `.kimi-plugin/plugin.json` 规范，故不宣称完整支持 Kimi 插件。
- **项目目录：**[Claude 项目技能](https://code.claude.com/docs/en/skills)与 [Codex 的 `.agents/skills`](https://developers.openai.com/codex/skills)有官方依据；`.agents/agents`、`.agents/commands` 是本插件的通用发现约定。

核验依据包括 `src/catalog/manifests.ts`、`surfaces.ts`、`validate.ts`、`native-project.ts` 与 `src/runtime/hooks-mounts.ts`。这是文档与代码核对，并非每个平台的端到端兼容认证。

能读取一种布局，并不保证复现原平台的全部行为。无效声明会被诊断并跳过。项目维度不挂载 MCP 服务；项目原生命令也不注册，因为宿主命令注册表是进程级作用域。

启用第三方套件前请检查其内容：启用的服务和 hooks 可以执行程序。详见[运行时与安全边界](docs/guides/usage.zh.md#运行时与安全边界)。

## 常见问题

**安装后为什么找不到技能或工具？**

检查套件及对应能力是否启用。技能可能限制手动调用；MCP / LSP 面板会显示凭据、依赖和挂载错误。项目维度 MCP 不会挂载。

**在哪里配置 MCP token？**

在 **MCP 服务**中打开对应服务。缺失环境变量引用时显示 `needs-credentials`。宿主管理的凭据只写不读；启动环境中的凭据需要修改环境后重启 DSH。

**来源下载失败怎么办？**

可以使用本地目录、收编手动克隆的仓库，或配置代理与镜像，见[配置市场源](docs/guides/usage.zh.md#配置市场源)。

**本地修改什么时候生效？**

没有文件监听。本地来源的发现结果最多缓存 30 秒，刷新来源可立即使缓存失效。项目发现有独立的五秒缓存。已经打开的页面不会自动刷新。

**删除来源会删除文件吗？**

只有勾选确认框里的「同时删除市场目录」才会删除。它删除该源在 `~/.dsh/agent-plugins/.sources/<id>` 下的目录——包括你手动克隆后被收编的目录。指向 `.sources/` 之外的本地目录源永不删除。

## 更多文档

- [使用指南](docs/guides/usage.zh.md)：安装、来源配置、存储、宿主要求、MCP / LSP 和反馈设置。
- [贡献指南](CONTRIBUTING.md)：开发环境、检查命令和 PR 流程。
- [安全政策](SECURITY.md) · [版本记录](CHANGELOG.md) · [MIT 许可](LICENSE)。
- [领域词汇](CONTEXT.md) · [架构设计](docs/adr/0001-catalog-centered-modular-refactor.md)。

已安装资源编辑、角色模型路由与目录迁移见[代理角色与存储](docs/guides/agent-roles.zh.md)。
