# Agent Note：`.agents` 布局读取它能承载的每一个运行面

Status: implemented

## 问题

`~/.agents/` 与 `<project>/.agents/` 是本插件原位读取的跨工具 Agent 配置位置。`~/.agents/skills/` 与项目级 `.agents/skills/` 是数十个客户端共用的事实约定（[生态调研](../../../../docs/developer/discussion/2026-09-02-agent-config-compat-ecosystem.md)），本插件也早已把用户自建资源放在用户根目录下。两个根目录由不同的代码路径读取——用户面板加 MCP、LSP 直接声明加载器，对照项目原生合成套件——这种不对称让真实内容读不到：

- `<project>/.agents/mcp.json` 只被 ZCode 项目布局的空表兜底读到。它的服务器被算在 `.zcode` 套件名下，而该套件的根目录可能根本不存在；一旦 `zcode.json` 或 `.zcode/config.json` 自己声明了一个服务器，这个文件就被彻底丢掉。
- `~/.agents/hooks/hooks.json` 与 `~/.agents/hooks.json` 没有任何读取路径。项目布局承载命令 hooks，用户根目录一个都不承载。
- `~/.agents/commands/*.md` 与 `~/.agents/agents/*.md` 只按平铺文件读取，而项目里的同名目录是递归读取的。
- 手写的 `~/.agents/mcp.json` 只要不带 DSH 专有的 `$schema` 键就会被拒绝，尽管该文件的契约写明它是放在其它 Agent 工具也会看的位置上的普通 `mcpServers` JSON。
- 用户维度直连套件在只承载一个运行面时把全部运行面声明为启用，因此只要 `~/.agents/mcp.json` 里有服务器，套件命令注册表就会在用户命令面板之外把 `~/.agents/commands/**` 再读一遍。

## 决策

**`mcp.json` 归 `.agents` 项目布局自己所有。** `PROJECT_LAYOUTS` 给该条目加上 `mcpFiles: ['.agents/mcp.json']`，ZCode 的空表兜底删除。两个布局不再读同一个文件：每个原生套件只承载自己目录里的声明。

**命令 hooks 进入用户根目录。** `~/.agents/hooks/hooks.json` 与 `~/.agents/hooks.json` 使用与项目 `.agents` 布局相同的文件名、顺序与追加合并语义，裸事件表与带 `hooks` 键两种形态都接受。`ProjectHooks.projectRoot` 改为可选：项目级或套件声明的 hook 集合携带自己的根目录并作为 `projectDir` 传给桥，用户级集合不携带，于是由桥自己的默认值把 `${CLAUDE_PROJECT_DIR}` 解析为调用会话的工作目录，而不落到一个配置目录上。用户声明是直连 MCP 套件旁边的直连合成套件，只有声明了事件时才并入 `enabledUserSuites()`。

**用户面板条目增加相对路径名。** `commands/` 与 `agents/` 面板按任意深度读取子目录，自身没有声明名字的条目按相对该 kind 目录的路径寻址（`git/commit`）；frontmatter 声明的 `name` 一如既往优先。每一段沿用原有条目文法；`..`、绝对路径、反斜杠与空段在每一个文件系统关口都被拒绝，而不是只在 HTTP 边界拒绝；遍历永不跟随符号链接目录。新建仍然写扁平的 `<name>.md` 写法，删除只移除该条目自己服务的那个文档。技能面板保持原有的两种顶层形态，因为同样映射 `~/.agents/skills` 的宿主读取器不会读得更深——分类嵌套的技能放在那里是死内容。

**嵌套命令按可调用名注册。** 宿主的命令文法只有一段，因此 `git/commit` 通过与套件、项目原生命令挂载早就采用的同一条 `commandCallName` 规则注册为 `git-commit`，面板也渲染这个名字。压平后重名的两个文档产生一次注册加另一条诊断，绝不静默遮蔽。

**`~/.agents/mcp.json` 不再要求 `$schema`。** 缺少该键时按基线方言校验用户自己的文件，因此每条逐服务器规则照旧生效，而其它工具写的文件仍然可读。套件自己的 `mcp.json` 仍然必须声明它声明的版本：那个文件是可分发包。

**直连用户套件只声明自己承载的运行面。** MCP 套件启用 `mcp`，hooks 套件启用 `hooks`。

## 已考虑的替代方案

**保留 ZCode 兜底，另加一个 `.agents` 读取器。** 否决：同一个文件会以两个套件 id 被读两遍、挂两遍，而归属问题——MCP 状态面板里一个服务器属于哪个套件——会一直没有答案。

**把用户 hooks 做成第四个面板。** 否决：面板的存在意义是按条目创作单个文档并增删改；hook 文件是工具整体写入的一张共享事件表，正是直连配置加载器已经处理的形态。

**用户 commands 与 personas 保持平铺。** 否决：项目的 `.agents/commands/` 是递归读取的，那么同一个目录在 checkout 里和在家目录里会是两种含义，其它工具写在那里的内容会不可见。

**要求用户 `mcp.json` 带 `$schema` 并写进文档。** 否决：用户根目录与写普通 `mcpServers` JSON 的工具共用，该文件自己的契约已经这么写了。要求一个 DSH 专有键，等于让本插件成为它刻意共享的这个文件的唯一读取器。

**让技能面板也读嵌套技能。** 否决：`dsh-skill-filesystem` 把 `~/.agents/skills` 映射为一个根，只读直接子目录与直接 `*.md` 文件，面板列出的嵌套技能是任何会话都用不到的内容。

## 后果

两个 `.agents` 根目录现在覆盖同一组运行面，共享目录里不再有任何内容被两个所有者读取。

用户 hooks 挂载没有项目目录，因此命令里写 `${CLAUDE_PROJECT_DIR}` 的 hook 看到的是会话工作目录。想要指向自己所在目录的 hook 文件写 `${CLAUDE_PLUGIN_ROOT}`，桥收到的是 Agent 布局根目录。

带路径的面板条目在 HTTP 层是不透明字符串，渲染命令名的两处客户端标题用与注册相同的规则压平。条目名在磁盘上保持稳定：`git/commit` 就是路径，可调用名在各边界派生而不落盘。

不带 `$schema` 的读取用与严格路径相同的规则集校验，因此手写文件按同样的逐服务器规则判定；本客户端拒绝的文档不贡献任何服务器，并把原因报到套件记录上，也就是这个文件一直以来走的空表分支。代价是缺少 `$schema` 会被当作基线方言读取，而不作为错误。

直连用户套件继续上报自己的 `surfaces` 计数，已安装套件的运行面默认停用行为不受影响。

## 验证

`tests/project-mcp.test.ts` 钉住归属划分：`.agents/mcp.json` 解析到 `.agents` 原生套件，ZCode 只读自己的文件，两者可各自声明服务器而互不重叠，畸形的 `.agents/mcp.json` 让该套件失败关闭。`tests/user-hooks.test.ts` 覆盖规范化、合并、去重、畸形文件失败关闭、套件形状，以及一次 `HooksMountRegistry` 挂载断言桥收到 `pluginRoot` 且没有 `projectDir`。`tests/mcp-direct-config.test.ts` 覆盖不带 `$schema` 的读取、被拒文件报出的点名原因，以及它保留的写入路径拒绝。`tests/user-panels.test.ts` 与 `tests/user-commands.test.ts` 覆盖嵌套列出、寻址、新建、删除、名字守卫，以及带重名诊断的压平注册。
