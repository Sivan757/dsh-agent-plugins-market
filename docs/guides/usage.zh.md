# 使用指南

[English](usage.md) | 简体中文 | [README](../../README.zh.md)

## 宿主要求

插件配置卡承载本插件的全部开关：**扫描项目 Agent 布局**（`scanProjectLayouts`，默认开启，见[项目布局](#项目布局)）、**MCP 增强**、**下载区域**、**后台自动更新来源**（`autoUpdateSources`，默认关闭，每 6 小时刷新一次全部已配置来源）与**体验反馈工具**。

Codex 项目 MCP 从 `.codex/config.toml` 读取，保留启停、环境变量引用、工具白名单/黑名单及超时；不支持的字段给出诊断。宿主 LSP 注册表是全局的，因此项目 LSP 不挂载，本插件不修改宿主 API。

- Node.js 22 或更高版本、DSH Web profile 和宿主技能服务（`ctx.skills`）。Git 来源需要 Git。
- 当前包声明的 DSH 宿主包版本范围为 `^0.1.5-rc.2`。这是依赖声明，不代表已验证所有功能或历史 Web 外壳的最低支持版本。
- 斜杠命令需要宿主命令服务。`subagent_run` 角色委派需要 agents、tools、LLM、subagents 与会话持久化服务；它启动一个可继续的后台子代理，应用已保存的角色指令与角色声明的精确路由，并立即返回子代理 ID 而不等待结果。
- MCP 默认使用内置桥接。宿主客户端兼容模式还需要 `@deepseek-ai/dsh-mcp-client`，hooks 需要 `@deepseek-ai/dsh-hooks-claude-code`。
- LSP 支持会随插件安装 `@deepseek-ai/dsh-lsp`、`dsh-lsp-stdio`、`dsh-tool-lsp`，并在启用的套件声明语言服务器时自动挂载，无需额外 profile 配置。只有语言服务器的可执行程序需要本机可用。
- 宿主凭据服务是可选的。缺失时环境变量引用从启动环境解析，变更后需要重启。

## 其他安装方式

推荐的 CLI 命令见[快速开始](../../README.zh.md#快速开始)。也可以在 profile 中安装：

```sh
pnpm add dsh-agent-plugins-market
```

当前 DSH 外壳中，市场是设置页的一个区块（**设置 → Agent Plugins 市场**）；未提供插件设置席位的旧版外壳会把它显示为顶层页面入口。

从 GitHub 安装：

```sh
dsh plugin --profile <name> add github:Sivan757/dsh-agent-plugins-market
```

npm 包包含构建后的 `lib/` 和 `client/`。GitHub 安装通过 `prepare` 构建，安装机器需要 Node.js 和 pnpm。

手动管理 profile 时，安装包后，将 `dsh-agent-plugins-market` 加入 profile 的 `dsh.profile.bundles` 数组，保留已有 bundles。包中的 `cordis.patch.yml` 提供插件配置行。依赖版本沿用包管理器写入的值。

## 配置市场源

发布包不预置来源。以下仅为你自己的 profile 可选配置示例。

源持久化在 `~/.dsh/agent-plugins/state.json`，也可用 cordis 配置预置（也是“持久种子”，启动时自动补齐缺失源）：

```yaml
- id: dsh-agent-plugins-market
  config:
    sources:
      - { id: agent-plugins, url: 'https://github.com/Sivan757/agent-plugins.git' }
      - { id: claude-plugins-official, url: 'https://github.com/anthropics/claude-plugins-official' }
      - { id: knowledge-work-plugins, url: 'https://github.com/anthropics/knowledge-work-plugins' }
```

`local: true` 的源直接读取本地目录（实时反映工作树，移除源时不会删除目录）。扫描结果会缓存最多 30 秒，并在安装/启用/面板切换等操作间复用，因此本地源的工作树改动会在下一次缓存刷新时可见（任何源变更、刷新按钮，或 30 秒 TTL 到期）。启动挂载和用户技能枚举只扫描包含已启用安装的源；浏览市场仍发现全部配置源。并发读取共享扫描任务。启动不会拉取 Git 更新；来源刷新需显式触发，除非开启**后台自动更新来源**。`archive` 源下载 HTTPS 压缩包（`.zip` / `.tar.gz` / `.tgz` / `.tar`，256 MiB 上限，可选 `sha256` 完整性校验）并解压为 checkout。

### 手动克隆、收编与网络调优

界面上克隆超时？你可以自己把仓库克隆到 checkout 根（`~/.dsh/agent-plugins/.sources/<id>/`）——市场页会在「未登记的本地仓库」中列出它，并提供一键**收编**：原样登记、不重新克隆、不改名；只有你之后删除该源并勾选「同时删除市场目录」时，目录才会被删除。在 UI 里添加 URL 时，若已存在 `origin` 匹配的 checkout，也会自动收编而不是二次克隆。收编源在界面上与普通源完全一致，不带额外徽标。

市场页顶部的源胶囊是等宽网格：默认折到两行、底部渐隐，鼠标悬停或键盘聚焦时以浮层展开，卡片区不会跳动；选中某个源后立即折回。选中的源会移到 `全部` 之后，折叠状态下依然可见，其余源保持 id 顺序。

git/压缩包获取可通过宿主配置调优：

```yaml
- id: dsh-agent-plugins-market
  config:
    git:
      proxy: 'http://127.0.0.1:7890' # 以 git http/https 代理注入
      insteadOf: { 'https://github.com/': 'https://mirror.example/https://github.com/' }
      timeoutMs: 300000 # 每次 git 调用超时（默认 120000）
      cloneRetry: true # 失败自动重试一次（默认开）
      fallbackTarball: false # github.com 克隆失败时回退为 codeload tarball 下载
      allowHttpArchives: false # 允许明文 http 压缩包地址（内网镜像）
```

## 存储与发现

插件状态位于 `~/.dsh/agent-plugins/`；设置 `DSH_HOME` 后改为 `$DSH_HOME/agent-plugins/`。

| 根目录下的路径         | 内容                                                 |
| ---------------------- | ---------------------------------------------------- |
| `state.json`           | 已配置来源和安装状态                                 |
| `.sources/<sourceId>/` | 来源 checkout                                        |
| `data/`                | 覆盖配置、套件 `${PLUGIN_DATA}` 目录、反馈限流时间戳 |

你自己创作的内容位于共用的 Agent 布局根目录 `~/.agents/`（`$DSH_AGENTS_HOME` 可覆盖）——与项目管理维度读取的 `.agents/` 目录形态一致：

| 路径        | 内容                                  |
| ----------- | ------------------------------------- |
| `skills/`   | 自建技能 Markdown 文件                |
| `commands/` | 自建命令 Markdown 文件                |
| `agents/`   | 自建角色 Markdown 文件                |
| `mcp.json`  | 工作区新增的 MCP 服务（`mcpServers`） |
| `lsp.json`  | 工作区新增的 LSP 服务（`lspServers`） |

自建条目支持 frontmatter `disabled: true`，停止注册但保留文件。命令将正文转交给模型，并把 `$ARGUMENTS` 替换为调用时的文本。自建角色进入动态[子代理目录](agent-roles.zh.md)，不再进入技能或斜杠命令菜单。

项目维度的状态和 checkout 位于 `<project>/.dsh/agent-plugins/`。[项目布局](#项目布局)列出的原生布局直接读取，无需安装状态。同名时，项目技能优先于已安装的用户套件技能，自建面板技能优先级低于套件技能。条目被遮蔽时可通过改名解决。

### 项目布局

开启**扫描项目 Agent 布局**后，会话所在项目会贡献自己的资源。关闭该开关会立即移除下列全部候选；配置源与已安装套件不受影响。文件原位只读，不安装、不改写、不删除。

技能目录在 `.claude`、`.agents`、`.codex`、`.cursor`、`.kimi`、`.zcode`、`.qoder`、`.github` 下读取。除 `.codex` 与 `.kimi` 外启用可移植 Markdown 代理；两者的 TOML/YAML 格式需要独立适配器。角色执行按调用会话确定项目。项目 commands、受支持的 MCP 服务和已映射命令 hooks 注册在各 Agent 独立作用域，会话启动或目录变更通知时刷新。

MCP 读取根 `.mcp.json`、`.cursor/mcp.json`，以及 `.qoder/settings.json`、`.qoder/settings.local.json` 的 `mcpServers` 表（本机配置覆盖同名项目配置）。ZCode 读取 `zcode.json`、`.zcode/config.json` 的 `mcp.servers`，原生表为空时回退到 `.agents/mcp.json`。Codex 通过 `smol-toml` 读取 `.codex/config.toml` 的 `[mcp_servers.*]`，保留 stdio/HTTP 配置、环境变量/请求头引用、启停、工具过滤和超时；不支持的服务字段会报诊断。相对可执行路径从项目根解析。

Claude/Qoder 设置 hooks 与明确启用的 ZCode 配置 hooks 使用桥支持的命令事件子集。校验后的 hooks 写入私有运行时临时文件，销毁时删除，项目原文件保持不变。项目 LSP 给出诊断且不挂载，修改宿主不属于本插件范围。

未登记的用户 checkout 不会因为存在于磁盘上就自动参与运行，需要显式收编和安装。没有文件监听；项目发现快照缓存五秒。

## 运行时与安全边界

MCP 详情仅为失败的托管服务或残留挂载显示重试；当前后端支持时才显示 OAuth 重新授权。重试检查所有托管服务但保留凭据。重新授权需确认清除授权记录及可能中断服务的影响。未保存配置时禁用连接操作；结果以刷新后的状态为准，不将接口成功当作连接成功。缺少凭据时应先补齐凭据。

### MCP 配置

在 **MCP 服务**中配置服务、凭据、覆盖、授权和重试。套件详情仅用于只读预览。

**MCP 增强**设置（`mcpEnhanced`，默认 `true`）选择内置桥接，支持 stdio、Streamable HTTP / OAuth 和旧式 SSE。关闭后使用宿主客户端兼容后端，该接入方式不提供 OAuth 或 SSE。切换会重新挂载服务。

使用 `"env": { "FOO_TOKEN": "${FOO_TOKEN}" }` 这样的引用。缺失引用时阻止启动并显示 `needs-credentials`。宿主凭据只写不读，不会将字面 token 写入套件状态或 override JSON。只读的启动环境值需要修改后重启 DSH。

`mcp.json` 使用严格 schema 校验。`.mcp.json` 支持常见兼容形式：顶层 server map、`http` / `local` transport 别名、省略 type 时通过 `command` 推断，以及 `${CLAUDE_PLUGIN_ROOT}`、`${CLAUDE_PLUGIN_DATA}`、`${NAME:-default}` 占位符。无效服务会诊断并跳过，不会带着部分配置启动。

### Hooks 与 LSP

Hooks 使用桥接映射支持的 command-hook 子集，接入 SessionStart、UserPromptSubmit、PreToolUse、PostToolUse、Stop、SubagentStart、SubagentStop。这不代表完整兼容 Claude Code 运行时。

LSP 的启用套件声明和直接配置的服务使用同一挂载生命周期。LSP 支持包随插件自带，用户只需自备语言服务器可执行程序；可执行程序缺失、声明无效，或安装损坏导致 LSP 支持包无法加载，都会展示诊断。能够预览声明不代表服务已经运行。

### 校验与执行

来源获取和清单扫描不能证明第三方代码可信。安装处于启用状态的套件可能启动服务或注册可执行 hooks，请先检查内容。

Git 获取通过 `execFile` 执行，不经过 shell；刷新使用 shallow fetch/reset。指向 `.sources/` 之外的本地目录源永不删除；`.sources/<id>` 下的 checkout——无论收编还是自克隆——只在删除该源并勾选「同时删除市场目录」时被移除。压缩包默认仅 HTTPS、256 MiB 上限、受保护的解压，可选 SHA-256 校验。便携路径在解析 symlink 后也必须留在套件根目录。无效清单和挂载失败以诊断形式展示。

漏洞报告请遵循[安全政策](../../SECURITY.md)。

### 体验反馈

`feedbackEnabled` 默认 `true`。宿主提供 tools 和 settings 时，启用面向模型的 `report_market_issue` 工具，在本插件的 GitHub 仓库提交 issue：装有并已登录 `gh` 命令时用 `gh`，否则用 `GITHUB_TOKEN` / `GH_TOKEN`。两者都不可用时不会提交任何东西：工具会在浏览器中打开预填好的「新建 issue」页面，并把完整 issue 文本与链接返回给模型转交给你。成功提交后 60 秒内不会再次提交。在插件配置卡片中关闭该设置即可注销工具。

工作区 Tab 共用持久化的卡片/列表偏好，搜索与筛选按资源独立。新增、刷新统一位于页头。MCP 新增入口校验 JSON 服务配置，写入 `~/.agents/mcp.json`，再通过插件自己的 bridge 挂载；LSP 新增写入 `~/.agents/lsp.json`。非法配置和重名服务会被拒绝。宿主自行管理的 MCP 服务仍只读观察。

### 资源详情编辑

详情使用统一宽屏窗口，最大 1120px，并受视口宽高约束。Markdown 预览将 YAML frontmatter 与渲染正文分开展示；原文编辑保留未知字段和注释。MCP 表单包含传输协议、命令、参数、工作目录、环境变量、URL、请求头及 OAuth；LSP 表单包含命令、参数、环境变量、扩展名映射、初始化选项和配置。非法 JSON 与未完成的键值行保留为可修改草稿，但不能保存。

`GET /api/agent-plugins/server-config?kind=mcp|lsp&id=...` 获取完整可编辑配置；`POST /api/agent-plugins/server-config/save` 替换对应服务配置。插件 MCP 配置写入已有覆盖文件，插件 LSP 配置写入 `data/lsp-overrides.json`，不会修改 checkout。未修改的 `[redacted]` 字段保留原凭据。配置修改通过插件运行时重新挂载。宿主自行管理的 MCP 服务保持只读。`POST /api/agent-plugins/lsp-servers/add` 独立新增一个服务，不覆盖其他服务。

## 格式细节与开发

### 操作遮罩

视觉遮罩延迟 200ms 出现，出现后至少展示 400ms；结束时保留 100ms 缓冲，衔接连续请求。操作锁立即生效，短请求在视觉遮罩出现前完成，不再闪烁。

工作区请求、凭据修改和设置修改共用 `withBusyOperation`（`src/client/ui/busy-operation.ts`）。操作还包含刷新时应包裹完整流程；嵌套计数确保全部操作结束才撤掉遮罩。唯一的 `BusyOverlay` 挂载在 body 下，跟随当前窗口边界，设置 inert，阻止背景点击和键盘操作，并在结束后恢复焦点。提示每 3.2 秒轮换，尊重减少动态效果设置。来源进度、模型目录后台加载和 LSP 自动轮询不显示遮罩。遮罩不占列表行，也不虚构百分比进度。

一个来源可以包含多种布局方言。套件清单与 Marketplace 目录索引遵循[同一布局优先级](../../README.zh.md#布局识别优先级)。清单按优先级逐个尝试：读不出或校验不通过的会给出诊断并尝试下一项，全部失败则拒绝该套件。索引扫描采用第一个能产出套件的索引，并按支持的规则补充发现；无效或空索引允许继续尝试后续候选。根 `marketplace.json` 是最后的共享回退。远程引用卡片不能直接安装，需要先添加对应仓库为来源。

`schemas/1.0.0/` 的 schema 内置自 [agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec)，校验时不在线下载。领域用语和开发检查见[领域词汇](../../CONTEXT.md)与[贡献指南](../../CONTRIBUTING.md)。
