# 安装与环境要求

[English](install.md) | 简体中文 | [README](../../README.zh.md)

**Guide:** [安装](install.md) · [来源](sources.md) · [自建资源](resources.md) · [服务](services.md) · [翻译](translation.md) · [设置](settings.md) · [工作区](workspace.md)

## 宿主要求

- Node.js 22 或更高版本、DSH Web profile 和宿主技能服务（`ctx.skills`）。Git 来源需要 Git。
- 当前包声明的 DSH 宿主包版本范围为同一个支持窗口 `>=0.2.0-rc.2 <0.3.0-0`。这是依赖声明，不代表已验证所有功能或历史 Web 外壳的最低支持版本。
- 斜杠命令需要宿主命令服务。角色委派需要 agents、tools、LLM、subagents 与持久化。无 Agent Teams 时，`subagent_role` 默认返回可继续子代理（省略或 true），false 等待前台报告。启用 Agent Teams 后，`spawn_teammate_role` 与精简角色目录替代该入口及说明；按角色指令和模型配置创建全新 Team 成员，通信与任务由原生 Team 工具管理。Team 模式还需要会话查询和系统提示词服务，以及用户明确的 Team 使用意图。
- MCP 默认使用内置桥接。宿主客户端兼容模式还需要 `@deepseek-ai/dsh-mcp-client`。会话级 hooks 使用已发布的 hook 协议，需要宿主 shell 与会话投影服务。
- LSP 支持会随插件安装 `@deepseek-ai/dsh-lsp`、`dsh-lsp-stdio`、`dsh-tool-lsp`，并在启用的套件声明语言服务器时自动挂载，无需额外 profile 配置。只有语言服务器的可执行程序需要本机可用。
- 宿主凭据服务是可选的。缺失时环境变量引用从启动环境解析，变更后需要重启。

## 其他安装方式

在 DSH 图形界面中打开侧边栏的**插件**页，点**添加插件**，填入 `dsh-agent-plugins-market`，然后重启 DSH。同一个对话框也接受仓库地址或本地目录。如果想用终端安装，可以在 profile 中安装：

```sh
pnpm add dsh-agent-plugins-market
```

当前 DSH 外壳中，市场是设置页的一个区块（**设置 → Agent 扩展**）；未提供插件设置席位的旧版外壳会把它显示为顶层页面入口。

从 GitHub 安装：

```sh
dsh plugin --profile <name> add github:Sivan757/dsh-agent-plugins-market
```

npm 包包含构建后的 `lib/` 和 `client/`。GitHub 安装通过 `prepare` 构建，安装机器需要 Node.js 和 pnpm。

手动管理 profile 时，安装包后，将 `dsh-agent-plugins-market` 加入 profile 的 `dsh.profile.bundles` 数组，保留已有 bundles。包中的 `cordis.patch.yml` 提供插件配置行。依赖版本沿用包管理器写入的值。
