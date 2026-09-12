<img src="docs-site/public/favicon.svg" alt="" width="48" height="48" />

# dsh-agent-plugins-market

**[DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness)的插件市场与 Agent 能力管理工作区。**

复用 Claude Code、Codex、Cursor、Kimi 等已识别布局中支持的内容，在 DSH Web 界面管理自己的技能、命令、代理角色、MCP 服务和 LSP 服务。

如果这个插件帮到了你，欢迎在 [GitHub](https://github.com/Sivan757/dsh-agent-plugins-market) 点个 Star ⭐。

[English](README.md) | 简体中文 | [文档站](https://sivan757.github.io/dsh-agent-plugins-market/) | [npm](https://www.npmjs.com/package/dsh-agent-plugins-market)

[![npm version](https://img.shields.io/npm/v/dsh-agent-plugins-market)](https://www.npmjs.com/package/dsh-agent-plugins-market) [![License](https://img.shields.io/github/license/Sivan757/dsh-agent-plugins-market)](LICENSE)

[快速开始](#快速开始) · [日常使用](#日常使用) · [兼容性](#兼容性与运行边界) · [常见问题](#常见问题)

## 页面

<table>
  <tr>
    <td align="center" width="33%">
      <img src="docs/screenshots/market.png" alt="插件市场" width="100%" /><br />
      <b>插件市场</b><br />添加来源、预览并安装套件。
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/skills.png" alt="技能" width="100%" /><br />
      <b>技能</b><br />浏览技能，编写自建技能。
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/commands.png" alt="命令" width="100%" /><br />
      <b>命令</b><br />管理以 /名称 调用的提示词模板。
    </td>
  </tr>
  <tr>
    <td align="center" width="33%">
      <img src="docs/screenshots/personas.png" alt="代理角色" width="100%" /><br />
      <b>代理角色</b><br />角色与精确的供应商、模型和思考强度。
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/mcp.png" alt="MCP 服务" width="100%" /><br />
      <b>MCP 服务</b><br />凭据、授权与连接状态。
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/lsp.png" alt="LSP 服务" width="100%" /><br />
      <b>LSP 服务</b><br />语言服务器配置与运行状态。
    </td>
  </tr>
</table>

## 你可以用它做什么

- **十种套件布局。** Claude Code、Codex、Cursor、Kimi Code、ZCode、Qoder CLI、GitHub Copilot CLI、Universal `.plugin/`、[agent-plugins](https://agent-plugins.org) 与无清单技能集合。
- **来源。** 添加 Git 仓库、本地目录或压缩包（`.zip` / `.tar.gz` / `.tgz` / `.tar`）；收编自己克隆的目录；按需刷新；删除来源时可一并删除受管目录。
- **适合你网络的下载方式。** 下载区域设置（默认 `auto` 跟随界面语言，也可显式选择全球或中国大陆）决定 `github.com` 克隆走的镜像前缀；代理与单次调用调优在宿主配置里。
- **运行时能力。** 启用套件会注入会话：技能进入目录与斜杠菜单，命令以 `/名称` 调用，代理角色进入子代理目录，MCP 工具以 `mcp__` 前缀注册，hooks 挂到宿主生命周期事件，语言服务器通过 `lsp` 工具使用。
- **MCP。** 内置桥接无需宿主 MCP 客户端，支持 stdio、带 OAuth 的 Streamable HTTP 和旧式 SSE。`${VAR}` 引用从宿主凭据服务或启动环境解析；按服务覆盖可禁用或修补声明，不必修改源文件；也可选用宿主客户端兼容模式。工具名为 `mcp__<套件>__<服务>__<工具>`。
- **LSP。** 随插件自带：安装插件即完成全部设置，`lsp` 工具只在确有语言服务器需求时挂载；语言服务器可执行文件本身需在 `PATH` 中。
- **代理角色与委派。** 角色卡片保存精确的供应商、模型与思考强度；角色出现在会话目录中，通过 `subagent_run` 运行，立即返回可继续的后台子代理 ID。
- **项目维度。** 项目自身的技能、代理、命令、MCP 服务与 hooks 无需安装即被发现。
- **自建资源。** 技能、命令和代理角色以 Markdown 保存在 `~/.agents/` 下，可随时编辑或禁用而不删除文件。
- **后台自动更新来源。** 可选：按定时器刷新全部已配置来源；默认关闭。
- **Web 工作区。** 六个页签——插件市场、技能、命令、代理角色、MCP 服务、LSP 服务——每个页签都有搜索、过滤与网格/列表切换，并提供带诊断的状态面板、凭据编辑，以及可在启用可执行第三方内容前提示风险的安装确认。
- **双语界面与反馈。** 工作区文案与注入提示跟随宿主语言；启用反馈后，模型可通过 `gh` 命令或 GitHub token 提交 `report_market_issue` 报告；两者都没有时，会打开预填好的 GitHub 新建 issue 页面并把完整 issue 文本交给你。

## 快速开始

将 `<name>` 替换为你的 profile 名称后安装：

```sh
dsh plugin --profile <name> add dsh-agent-plugins-market
```

1. 重启 DSH，打开 **设置 → Agent Plugins 市场**。
2. 在**插件市场**添加来源，例如 `https://github.com/anthropics/claude-plugins-official`。插件不预置来源。
3. 打开套件查看内容，确认后安装，并确保套件已启用。
4. 如果套件提供技能，先在**技能**页签查看，再在聊天中输入 `/` 查找允许手动调用的技能。如果提供 MCP，前往 **MCP 服务**检查状态，处理凭据或连接提示后再使用工具。

环境要求、profile 配置与其他安装方式见[使用指南](docs/guides/usage.zh.md#其他安装方式)。

## 日常使用

工作区包含六个页签：

| 页签     | 可以做什么                                                                                 |
| -------- | ------------------------------------------------------------------------------------------ |
| 插件市场 | 添加来源、预览套件、安装 / 卸载、启用 / 禁用和刷新。                                       |
| 技能     | 浏览技能，创建或编辑自己的可复用指令。                                                     |
| 命令     | 管理通过 `/名称` 调用的提示词模板。                                                        |
| 代理角色 | 管理角色指令并为每个角色保存精确的供应商、模型与思考强度；通过 `subagent_run` 在后台委派。 |
| MCP 服务 | 自行新增服务或配置已安装的服务及其凭据与授权，查看连接状态并重试失败的服务。               |
| LSP 服务 | 新增并配置语言服务器，查看运行状态。                                                       |

**来源（source）**表示内容来自哪里，**套件（suite）**是从中发现的可安装单元。添加来源用于发现套件；安装并启用套件决定其运行时能力是否生效。

你自己创作的内容都放在共用的 Agent 布局根目录：技能、命令和角色是 `~/.agents/` 下的 Markdown 文件，工作区里新增的 MCP 与 LSP 服务分别保存在 `~/.agents/mcp.json` 与 `~/.agents/lsp.json`。项目原生资源继续保留在项目中。路径和优先级见[存储与发现](docs/guides/usage.zh.md#存储与发现)。

六个页签共用持久化的卡片/列表偏好。新增、刷新统一位于页头；资源状态条为绿色时表示生效中。

## 兼容性与运行边界

支持的**布局方言（layout dialect）**描述文件如何组织。[统一优先级表](#布局识别优先级)并列列出套件清单与 Marketplace 目录索引。[`schemas/`](schemas/README.md) 中十种布局契约均有独立读取测试；[布局审计](docs/layout-coverage.zh.md)把它们对应到固定提交号的仓库快照。

支持的**运行时能力（runtime surface）**描述 DSH 能使用什么：

| 能力  | 支持情况与条件                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------- |
| 技能  | 接入宿主技能目录，允许手动调用的技能出现在斜杠菜单；展开支持的根路径占位符。                                            |
| 命令  | 通过宿主命令服务注册斜杠命令。                                                                                          |
| 代理  | 动态子代理目录与 `subagent_run`；需要宿主 agents、tools、LLM、subagents 与会话持久化服务。                              |
| MCP   | 默认使用内置桥接，支持 stdio、带 OAuth 的 Streamable HTTP 和旧式 SSE；也可切换宿主客户端兼容模式。                      |
| Hooks | 运行 `dsh-hooks-claude-code` 桥接映射支持的 command-hook 子集。                                                         |
| LSP   | 随插件自带：安装插件即安装 LSP 支持包，`lsp` 工具只在确有语言服务器需求时挂载；语言服务器可执行文件本身需在 `PATH` 中。 |

代理角色显示在会话目录中，并通过 `subagent_run(agent, prompt)` 执行。角色可以保存精确的 `provider` + `model` 与 `reasoning_effort`；其余声明一律忽略，子代理改为继承父会话路由。`tools` 与 `disallowedTools` 会保留在文件中但不会生效。frontmatter 字段与边界见[代理角色](docs/guides/agent-roles.zh.md)。

### 布局识别优先级

**同一个套件目录**同时存在多个清单时，按下表顺序选择第一个存在的文件来确定布局：

| 优先级 | 布局 | 套件清单 | Marketplace 目录索引 |
| --- | --- | --- | --- |
| 1 | [agent-plugins](https://agent-plugins.org) / 根兼容清单 | `plugin.json` | 无专属索引 |
| 2 | Universal 兼容布局 | `.plugin/plugin.json` | `.plugin/marketplace.json` |
| 3 | Claude Code | `.claude-plugin/plugin.json` | `.claude-plugin/marketplace.json` |
| 4 | Cursor | `.cursor-plugin/plugin.json` | `.cursor-plugin/marketplace.json` |
| 5 | Kimi Code | `kimi.plugin.json`，其次 `.kimi-plugin/plugin.json` | `.kimi-plugin/marketplace.json` |
| 6 | Codex | `.codex-plugin/plugin.json` | `.agents/plugins/marketplace.json`，其次 `.agents/plugins/api_marketplace.json` |
| 7 | ZCode | `.zcode-plugin/plugin.json` | 无专属索引 |
| 8 | Qoder CLI | `.qoder-plugin/plugin.json` | `.qoder-plugin/marketplace.json` |
| 9 | GitHub Copilot CLI | `.github/plugin/plugin.json` | `.github/plugin/marketplace.json` |
| 回退 | 技能集合 / 共享索引 | 无已知清单时按技能集合约定发现 | 根 `marketplace.json` |

- **清单按顺序尝试：** 读不出或校验不通过的清单会给出诊断，然后尝试下一优先级，直到回退项；全部失败时给出诊断，不会加载半个套件。
- **组件补充：** 根 `plugin.json` 未声明受识别的 agent-plugins `$schema` 时，缺失的组件声明可以从 `.claude-plugin/plugin.json` 补齐；根清单中的显式声明优先，marketplace 条目声明补充剩余缺项。
- Marketplace 索引遵循同一顺序：第一个能产出套件的索引胜出，无效或空索引允许继续尝试后续候选。

顺序定义见 [`src/model/layouts.ts`](src/model/layouts.ts)，选择与根清单补充逻辑见 [`src/catalog/manifests.ts`](src/catalog/manifests.ts)。

### 布局支持矩阵

表中说明本插件是否读取该布局的对应能力。**支持**表示读取该布局自己的文件并注入；**部分**表示只理解其中一部分格式，或上游布局本身没有对应定义——具体见下表说明。依据见[兼容性报告](docs/compat-report.md)与[布局审计](docs/layout-coverage.zh.md)。

| 布局                                                                                                          | 技能 | 代理 | 命令 | MCP  | Hooks  | LSP    |
| ------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- | ---- | ------ | ------ |
| [Claude Code](https://code.claude.com/docs/en/plugins-reference)                                              | 支持 | 支持 | 支持 | 支持 | 部分   | 支持   |
| [Codex](https://developers.openai.com/plugins/build/plugins)                                                  | 支持 | 支持 | 支持 | 部分 | 部分   | 支持   |
| [Cursor](https://cursor.com/docs/reference/plugins)                                                           | 支持 | 部分 | 部分 | 部分 | 不支持 | 支持   |
| Kimi Code                                                                                                     | 支持 | 支持 | 支持 | 支持 | 部分   | 部分   |
| [ZCode](https://zcode.z.ai/en/docs/plugin) `.zcode-plugin/`                                                   | 支持 | 支持 | 支持 | 支持 | 部分   | 部分   |
| [Qoder CLI](https://docs.qoder.com/cli/plugins-reference) `.qoder-plugin/`                                    | 支持 | 支持 | 支持 | 部分 | 部分   | 部分   |
| [GitHub Copilot CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference) | 支持 | 支持 | 支持 | 支持 | 部分   | 支持   |
| Universal 兼容布局 `.plugin/`                                                                                 | 支持 | 支持 | 支持 | 支持 | 部分   | 支持   |
| [agent-plugins](https://agent-plugins.org)                                                                    | 支持 | 部分 | 部分 | 支持 | 部分   | 部分   |
| 无清单技能集合                                                                                                | 支持 | 支持 | 支持 | 支持 | 部分   | 部分   |
| 项目原生目录                                                                                                  | 支持 | 支持 | 支持 | 支持 | 部分   | 不支持 |

- **技能**读取清单声明的路径与约定的 `skills/` 目录，也支持平铺的 `SKILL.md` 文件。
- **代理与命令**按 Markdown 读取（`agents/*.md`、`commands/*.md`）。Cursor 命令只读 `.md`，不读 `.mdc`、`.markdown`、`.txt`；Codex 与 Kimi 的原生代理/命令格式（TOML、YAML）尚未适配。
- **MCP** 支持声明的文件、内联表与数组。Cursor 的无 schema `mcp.json` 与 agent-plugins 的严格 `mcp.json` 都能读取；Kimi Code 只读内联声明。Codex 的 app 连接器不在适配范围内。
- **Hooks** 只映射 DSH 有对应点的命令类事件；没有对应点的事件（例如 `afterFileEdit`）给出诊断而不伪造执行。Cursor 的原生事件不读取。
- **LSP** 支持声明的文件、数组、内联表，以及约定的 `.lsp.json` / `lsp.json` 位置。项目内的 LSP 声明只给诊断、不挂载：宿主 LSP 注册表是全局的。部分布局只提供目录预览。
- **agent-plugins** 规范只定义可移植的技能与 MCP；该布局的代理、命令与 hooks 按本插件的共用目录约定读取，不是规范能力。
- **Universal** 是本插件使用的兼容布局名称：[OpenHands SDK](https://docs.openhands.dev/sdk/guides/plugins)文档同样使用 `.plugin/plugin.json`，[Vercel 仓库](https://github.com/vercel/vercel-plugin/blob/main/.plugin/plugin.json)也在使用，但不存在跨厂商规范。

能读取一种布局，并不保证复现原平台的全部行为。无效声明会被诊断并跳过。

### 项目布局开关

插件设置卡提供**扫描项目 Agent 布局**（`dsh-agent-plugins-market.scanProjectLayouts`，默认开启）。它只控制一件事：当前项目是否把自己目录（`.claude`、`.agents`、`.codex`、`.cursor`、`.kimi`、`.zcode`、`.qoder`、`.github`）里的技能、命令、代理角色、MCP 服务与 hooks 贡献到会话里。关闭后立即移除这些候选；配置源与已安装套件不受影响。

每种布局读取哪些目录与文件、如何挂载，见[项目布局](docs/guides/usage.zh.md#项目布局)。

### 抽样验证

README 中的仓库在 [`tests/fixtures/real-layouts/`](tests/fixtures/real-layouts/) 保留了离线快照（含提交号、哈希与许可证），且每种布局都有独立的读取测试。[兼容性报告](docs/compat-report.md)记录抽样仓库、schema 结论与扫描器输出，[布局审计](docs/layout-coverage.zh.md)记录独立的资源核验。这些是文档、源码与抽样核验，并非每个平台的端到端兼容认证。

启用第三方套件前请检查其内容：启用的服务和 hooks 可以执行程序。详见[运行时与安全边界](docs/guides/usage.zh.md#运行时与安全边界)。

## 常见问题

**安装后为什么找不到技能或工具？**

检查套件及对应能力是否启用。技能可能限制手动调用；MCP / LSP 面板显示用户服务故障。项目资源还需要开启项目扫描；不支持的原生字段与项目 LSP 声明进入扫描诊断。

**在哪里配置 MCP token？**

在 **MCP 服务**中打开对应服务。缺失环境变量引用时显示 `needs-credentials`。宿主管理的凭据只写不读；启动环境中的凭据需要修改环境后重启 DSH。

**套件没有声明的服务怎么添加？**

在 **MCP 服务**或 **LSP 服务**中点击新增并填入声明。声明会先校验，保存到 `~/.agents/mcp.json` 或 `~/.agents/lsp.json`，并与套件服务走同一套挂载生命周期。从宿主配置观察到的服务保持只读。

**来源会自动更新吗？**

只有开启**后台自动更新来源**后才会：开启后每 6 小时刷新一次全部已配置来源，第一次刷新在开启满一个周期之后。该开关默认关闭，刷新按钮始终可用。

**来源下载失败怎么办？**

可以使用本地目录、收编手动克隆的仓库，或配置代理与镜像，见[配置市场源](docs/guides/usage.zh.md#配置市场源)。

**本地修改什么时候生效？**

没有文件监听。本地来源的发现结果最多缓存 30 秒，刷新来源可立即使缓存失效。项目发现有独立的五秒缓存。已经打开的页面不会自动刷新。

**删除来源会删除文件吗？**

只有勾选确认框里的「同时删除市场目录」才会删除。它删除该源在 `~/.dsh/agent-plugins/.sources/<id>` 下的目录——包括你手动克隆后被收编的目录。指向 `.sources/` 之外的本地目录源永不删除。

## 更多文档

- [使用指南](docs/guides/usage.zh.md)：安装、来源配置、存储、宿主要求、项目布局、MCP / LSP 和反馈设置。
- [插件规范](schemas/README.md)：各布局的参考 schema 与依据，以及内置的 agent-plugins v1.0.0 契约。
- [兼容性报告](docs/compat-report.md)：每个 schema 一个真实仓库，含提交号、schema 结论与扫描器输出。
- [贡献指南](CONTRIBUTING.md)：开发环境、检查命令和 PR 流程。
- [安全政策](SECURITY.md) · [版本记录](CHANGELOG.md) · [MIT 许可](LICENSE)。
- [领域词汇](CONTEXT.md) · [架构设计](docs/adr/0001-catalog-centered-modular-refactor.md)。
- [代理角色与存储](docs/guides/agent-roles.zh.md)：已安装资源编辑、角色模型路由与目录迁移。
