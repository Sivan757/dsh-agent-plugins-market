# 自建资源

[English](resources.md) | 简体中文 | [README](../../README.zh.md)

**Guide:** [安装](install.md) · [来源](sources.md) · [自建资源](resources.md) · [服务](services.md) · [翻译](translation.md) · [设置](settings.md) · [工作区](workspace.md)

## 存储与发现

插件状态位于 `~/.dsh/agent-plugins/`；设置 `DSH_HOME` 后改为 `$DSH_HOME/agent-plugins/`。

| 根目录下的路径           | 内容                                                 |
| ------------------------ | ---------------------------------------------------- |
| `state.json`             | 已配置来源和安装状态                                 |
| `.sources/<sourceId>/`   | 来源 checkout                                        |
| `data/`                  | 覆盖配置、套件 `${PLUGIN_DATA}` 目录、反馈限流时间戳 |
| `translation-cache.json` | 按内容与 provider 键控的译文缓存（保留至手动清空）   |

你自己创作的内容位于共用的 Agent 布局根目录 `~/.agents/`（`$DSH_AGENTS_HOME` 可覆盖）——与项目管理维度读取的 `.agents/` 目录形态一致：

| 路径                   | 内容                                                      |
| ---------------------- | --------------------------------------------------------- |
| `skills/`              | 自建技能：`<name>.md`，或其它工具创作的 `<name>/SKILL.md` |
| `commands/`            | 自建命令 Markdown 文件，平铺或放在子目录中                |
| `agents/`              | 自建角色 Markdown 文件，平铺或放在子目录中                |
| `hooks.json`, `hooks/` | 命令 hooks，写在 `hooks.json` 或 `hooks/hooks.json`       |
| `mcp.json`             | 工作区新增的 MCP 服务（`mcpServers`）                     |
| `lsp.json`             | 工作区新增的 LSP 服务（`lspServers`）                     |

自建条目支持 frontmatter `disabled: true`，停止注册但保留文件。技能面板改用宿主自己的 `disable-model-invocation: true` 与 `user-invocable: false` 这对开关来停用技能——这是该文件的所有读取器都认的停用状态——并在首次切换时删掉较早的 `disabled` 键。以 `<name>/SKILL.md` 形态创作的技能保留该文档旁的其它文件；从面板删除只移除该文档，不会动其它工具放在那里的 `references/`、`scripts/` 等文件。技能以其 frontmatter 声明的 `name` 注册，面板也用这个名字显示条目；宿主读取器会拒绝的文件以文件名列出、显示为已停用并给出原因，不进入技能目录。命令把正文转交给模型，并在其中填入调用文本：`$ARGUMENTS` 是整段文本，`$1` 到 `$9` 是按顺序的各个词；frontmatter 声明了 `arguments: system target_stack` 的命令，用同样的顺序绑定这些声明的名字（`$system`、`$target_stack`）。文本按空白切分，带引号的短语算作一个词。声明了但文本没有填的名字展开为空，回复里会点名它。正文完全没有占位符时，文本会在一个空行之后附上，写作 `User input: <text>`。放在子目录里的命令或角色以路径命名（`git/commit`），或在 frontmatter 声明了 `name` 时以该名字命名；命令按该名字注册并把每个 `/` 压平成 `-`，因此用 `/git-commit` 调用。自建角色进入动态[子代理目录](agent-roles.zh.md)，不再进入技能或斜杠命令菜单。`mcp.json` 与 `lsp.json` 按本地声明文件读取：`mcp.json` 不需要 `$schema`，其它工具写在那里的服务原样读取。在那里声明的服务以自己的键直接挂载（`mcp__<服务>__<工具>`，中间不套套件命名空间）——就是同一份声明在其它 MCP 客户端里得到的名字。

项目维度的状态和 checkout 位于 `<project>/.dsh/agent-plugins/`。[项目布局](#项目布局)列出的原生布局直接读取，无需安装状态。同名时，项目技能优先于已安装的用户套件技能，你在 Agent 布局根目录下自建的技能优先于同名套件技能。条目被遮蔽时可通过改名解决。

## 项目布局

**扫描项目 Agent 布局**默认关闭。开启后，会话所在项目会贡献自己的资源；保存为关闭后，下一轮发现即移除下列全部候选。配置源与已安装套件不受影响。文件原位只读，不安装、不改写、不删除。

技能目录在 `.claude`、`.agents`、`.codex`、`.cursor`、`.kimi`、`.zcode`、`.qoder`、`.github` 下读取。除 `.codex` 与 `.kimi` 外启用可移植 Markdown 代理；两者的 TOML/YAML 格式需要独立适配器。角色执行按调用会话确定项目。项目 commands、受支持的 MCP 服务和已映射命令 hooks 注册在各 Agent 独立作用域，会话启动或目录变更通知时刷新。

MCP 读取根 `.mcp.json`、`.agents` 布局自己的 `.agents/mcp.json`、`.cursor/mcp.json`，以及 `.qoder/settings.json`、`.qoder/settings.local.json` 的 `mcpServers` 表（本机配置覆盖同名项目配置）。ZCode 读取 `zcode.json`、`.zcode/config.json` 的 `mcp.servers`。Codex 通过 `smol-toml` 读取 `.codex/config.toml` 的 `[mcp_servers.*]`，保留 stdio/HTTP 配置、环境变量/请求头引用、启停、工具过滤和超时；不支持的服务字段会报诊断。相对可执行路径从项目根解析。

Claude/Qoder 设置 hooks、Agent 布局的 `.agents/hooks/hooks.json` 或 `.agents/hooks.json`（裸事件表或带 `hooks` 键）与明确启用的 ZCode 配置 hooks 使用桥支持的命令事件子集。用户 Agent 布局根目录用同样的两个文件名读取，且没有项目目录：用户级 hook 看到的 `${CLAUDE_PROJECT_DIR}` 是调用会话的工作目录。校验后的 hooks 写入私有运行时临时文件，销毁时删除，项目原文件保持不变。项目 LSP 给出诊断且不挂载，修改宿主不属于本插件范围。

未登记的用户 checkout 不会因为存在于磁盘上就自动参与运行，需要显式收编和安装。没有文件监听；项目发现快照缓存五秒。
