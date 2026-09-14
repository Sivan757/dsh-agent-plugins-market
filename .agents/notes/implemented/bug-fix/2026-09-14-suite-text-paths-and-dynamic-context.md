# Agent Note: 套件文本里的路径变量与动态上下文

Status: implemented

## Problem

用户在会话里调用套件斜杠命令时，模型报 `CLAUDE_PLUGIN_ROOT` 是空的。

复现很直接：装好的 `codex-plugin` 套件在 `commands/setup.md`、`agents/codex-rescue.md` 里写 `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs"`，而同一套件的技能（`skills/codex-cli-runtime/SKILL.md`）却能正常跑。差别在替换面：技能正文会替换，命令正文与子代理 persona 不会，于是模型拿到字面量占位符，bash 把它展开成空字符串，命令去找 `/scripts/codex-companion.mjs`。

Claude Code 的契约（Plugins reference 的 "Environment variables" 表与 Skills 的 "Available string substitutions"）是：`${CLAUDE_PLUGIN_ROOT}`、`${CLAUDE_PLUGIN_DATA}`、`${CLAUDE_PROJECT_DIR}` 在「技能与子代理内容」和「hook、monitor 命令」里处处替换，在 MCP 的 `command`/`args`/`env` 与 LSP 的 `command`/`args`/`env`/`workspaceFolder` 里替换；`${CLAUDE_SKILL_DIR}` 只在技能内容里替换。本插件此前只覆盖了插件根变量的一部分（技能正文、MCP 声明、扫描期 hooks 命令），另外三个变量一个都没实现，而且运行期的替换正则各写各的。

同一份契约还有第二个面没实现：技能与命令里的 `` !`command` `` 动态上下文——Claude Code 会执行该命令并把输出替换掉占位符。已装套件里用它很多（本机 214 个技能文件、10 个命令文件），此前全部带着字面量到达模型。

## Decision

作者写在套件文本里的占位符，全部由注入层解析。

`src/catalog/plugin-variables.ts` 是唯一的实现：`expandPluginPaths(text, context)` 按四组变量分别解析——`PLUGIN_ROOT_VARIABLES`（`PLUGIN_ROOT` 与各方言拼写）、`PLUGIN_DATA_VARIABLES`、`PROJECT_DIR_VARIABLES`、`SKILL_DIR_VARIABLE`，调用方只传自己手里的值，没有值的变量原样保留（`${NAME:-default}` 之类的作者意图不会被清空）；`pluginRootOf(suite)` 对 `project-native` 布局返回 `undefined`，因为那些文件是仓库自己的原生目录，没有插件根（Claude Code 同样只在插件技能里替换插件根变量）。数据目录由 `suiteDataDir(dataRoot, sourceId, suiteId)` 统一定义，MCP 走的是同一个函数。

各面的取用时机按「谁在什么时候知道值」选择：

- 技能：`SuiteSkillProvider.get` 在加载时用套件根、数据目录、技能自身目录与 `options.cwd`（会话目录）展开。
- 斜杠命令：`CommandMountRegistry` 在注册时把套件根与数据目录记在 spec 上，转发时才展开，并用调用会话的 cwd 解析项目目录；注册指纹因此仍用原文。
- 子代理：`AgentRoleEntry` 携带 `suiteRoot`/`suiteData`，`readAgentRole` 与 `agentRoleCatalog` 再补上调用者的 cwd，展开 persona、标题与描述——目录摘要与执行读同一份结果。
- 启动指令：`suiteInstructions` 按套件展开，数据根由挂载点传入，项目目录取该 agent 的 cwd。
- LSP：声明在挂载前展开（`expandLspServerConfig`），因此 `suite.lsp` 里保留的是作者原文，预览看到的是声明、挂载拿到的是绝对路径。
- MCP：沿用既有的凭据感知展开器，它已经处理数据目录与凭据引用。
- hooks：命令串的插件根与项目目录由宿主桥替换。`${PLUGIN_DATA}` 在 hooks 里不解析——桥的 Config 没有 env 口子，这一层我们改不了。

动态上下文在 `src/runtime/dynamic-context.ts`：一次扫描同时识别行首或空白后的 `` !`cmd` `` 与 ` ```! ` 代码块，命令按顺序在会话目录中运行（120s 上限、32 KiB stdout 上限），输出作为纯文本插入且不再被扫描。两个流合并后注入，截断带一行说明。退出码 1 对 `grep`、`rg`、`find`、`diff`、`test`、`[`、`git diff`、`git grep` 算结果而非失败（与宿主 shell 消费者一致），其余失败、超时、取消都抛出带命令与输出的错误：命令处理器把它转成 `kind: 'error'`，技能加载直接失败——模型永远不会只看到注入了一半的文本。shell seam 按结构读取（`ctx.shell`），profile 里没有这个服务时占位符保持字面量，绝不猜测。

## Alternatives considered

- **只实现插件根变量，其余三个变量与动态上下文留待以后。** 否决：四个变量是同一份契约里的同一类占位符，分两次做等于让作者再踩一次「有的面替换、有的面不换」；数据目录在 MCP 里已经存在，只是没被别的面复用。
- **在扫描期就把数据目录展开进 `suite.lsp` 等声明。** 否决：扫描层（`scanSource`）拿不到插件存储根，把存储路径塞进纯扫描结果会让快照依赖 profile 位置；运行期的挂载点本来就知道这两个值。
- **在 `PanelResources.list` 里直接替换 `rawText`。** 否决：`rawText` 是面板预览与编辑器写回源文件的原文，替换会污染预览，还可能把替换后的路径写回作者的套件文件。
- **不区分布局，项目原生目录也替换插件根变量。** 否决：`.claude/commands/x.md` 这类文件没有插件根，解析成 `.claude` 目录会给出一个看似合理却错误的路径——静默地比报错更难查。
- **动态上下文只在斜杠命令上实现。** 否决：已装套件里 214 个技能文件用到它、命令只有 10 个，而 Claude Code 里两者本就是同一个能力。
- **让动态上下文失败时降级为字面量。** 否决：Claude Code 的行为是中止整次调用，而半注入的提示词会让模型按残缺上下文行动；`kind: 'error'` 至少把命令自己的输出交给用户。
- **给动态上下文加一个开关设置。** 未采纳：本仓库的设置面在宿主设置服务与客户端卡片里，加开关是一次独立改动；已启用套件本来就能通过 hooks、MCP 起进程，这里只是把同一信任面延伸到技能与命令，因此先按 Claude Code 的默认行为实现并在用户文档里写明。
- **在 hooks 里自行重写临时 hooks.json 来补 `${PLUGIN_DATA}`。** 否决：只能替换命令串里的文本，修不了脚本里读 `process.env`，还要把文件型配置复制一份，收益不抵复杂度；这属于宿主桥的能力缺口。

## Consequences

- 四个路径变量在技能、命令、子代理、启动指令、LSP 与 MCP 上按作者预期解析；hooks 拿到插件根与项目目录，但没有数据目录。
- 技能与命令里的动态上下文现在会真的执行 shell 命令，输出进入提示词。已安装并启用的套件由此可以在技能加载或命令调用时运行其自带脚本——与 hooks、MCP 同一信任级别，用户文档已写明要检查套件内容。
- 命令处理器改为异步（宿主命令注册表本来就接受 `Promise<CommandResult>`），失败以 `kind: 'error'` 结算。
- 文件类文本的预览与编辑仍是作者原文（技能、命令、子代理卡片）；LSP 声明同样保留原文，展开发生在挂载前。
- 面板条目的 HTTP 契约多了可选的 `suiteRoot` 与 `suiteData`，客户端不使用它们。
- 项目原生目录只解析项目目录变量：那里的插件根与数据目录没有意义。
- 已知缺口：hook 子进程拿不到 `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` 环境变量（脚本里读 `process.env` 仍为空，已装套件中 `understand-anything`、`promptbook` 就这么写），这要宿主桥支持；MCP/LSP 子进程同样没有这两个环境变量，只有声明里的占位符被替换。

## Testing

`tests/plugin-variables.test.ts` 覆盖四组变量的展开与缺失值保留、`project-native` 守卫、命令转发、子代理 persona 与目录描述、技能正文（含技能目录与项目目录）、启动指令、LSP 挂载前展开与声明原文保留。`tests/dynamic-context.test.ts` 覆盖行首/空白后/非空白后三种识别、围栏多行、输出不再扫描、多占位符顺序、双流合并、截断、失败/超时/取消三种报错、退出码 1 的白名单，以及命令与技能两条注入路径（含没有 shell seam 时保持字面量）。既有 `tests/mcp-mounts.test.ts`、`tests/project-commands.test.ts` 已改为 await 异步处理器。
