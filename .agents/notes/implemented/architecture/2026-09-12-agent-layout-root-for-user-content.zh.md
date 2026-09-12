# Agent Note：自建内容放入 Agent 布局根目录

Status: implemented

## 问题

自建技能、命令和角色原本保存在 `$DSH_HOME/agent-plugins/user/{skills,commands,agents}`，工作区新增的服务保存在 `data/mcp-servers.json` 与 `data/lsp-servers.json`。这把用户自己拥有的内容埋进了插件私有状态：其它 Agent 工具读不到，服务声明也没有使用本插件在项目 `.agents/` 目录上已经采用的布局。[生态调研](../../../../docs/research/2026-09-02-agent-config-compat-ecosystem.md)记录了项目级 `.agents/skills/` 与全局 `~/.agents/skills/` 已是事实上的跨工具约定。

## 决策

自建资源与手写服务声明迁到共用的 Agent 布局根目录 `~/.agents`（测试与特殊家目录可用 `$DSH_AGENTS_HOME` 覆盖）：

- `skills/`、`commands/`、`agents/` —— 仍是原来的扁平 Markdown 条目与 frontmatter 语法，`UserPanelStore` 只改根目录。
- `mcp.json`（`mcpServers`）与 `lsp.json`（`lspServers`）—— 工作区新增按钮的写入位置。

插件状态仍在 `$DSH_HOME/agent-plugins`：`.sources/`、`state.json`、`data/`（覆盖配置、`${PLUGIN_DATA}` 目录、反馈限流时间戳）以及持久化的 LSP 启停集合。两个根刻意分开：缓存与安装状态属于插件，自建内容属于用户。

编辑已安装套件内资源时的包含性判断改为对照 catalog 的用户根目录，而不再对照面板目录——面板已不在托管 checkout 的那棵树里。

宿主自己的 `dsh-skill-filesystem` 把同一个 `~/.agents/skills` 目录映射为它的 `user-agents` 根，rank 500；同名技能由 rank 小者胜。因此面板 provider 定在 440：高到能继续服务它自己拥有的条目——面板的 `disabled` frontmatter 与本地化描述才真正生效——又低到让项目根（100-300）与用户 `~/.dsh` 技能（400）仍然压过它；同时低于 suite 的用户 rank（450），因此用户手写的技能会赢过已安装套件发布的同名技能。

启动时在读取任何存储之前完成迁移：`user/{skills,commands,agents}` 与 `data/user/...` 迁入 `~/.agents/<kind>`，`data/mcp-servers.json` 与 `data/lsp-servers.json` 迁入 `~/.agents/mcp.json` 与 `~/.agents/lsp.json`。搬空的旧面板目录会被删除；内容冲突则保留在原路径并阻止激活，报出该路径。

## 已考虑的替代方案

**继续用单一根目录。** 否决：这正是要修的问题——用户内容对 `.agents/` 约定所服务的那些工具不可读。

**同时把技能改成跨工具的 `skills/<name>/SKILL.md` 目录形态。** 本次否决：面板按条目编辑单个文档，且扁平 `skills/*.md` 也是被接受的写法；目录形态是独立改动，需要独立迁移。

**把 `~/.agents` 当作普通来源发现，而不是面板存储。** 否决：面板需要增删改与 `disabled` frontmatter 控制，catalog 读取器不提供这些。

## 后果

自建内容在卸载插件后仍然保留，这正是迁移的目的。`~/.agents` 是共享目录：插件不得删除它或挪用不认识的条目，迁移只写入自己拥有的子目录与文件。配置出的 `~/.agents` 若与插件存储重叠，启动时直接拒绝。测试会 stub `DSH_AGENTS_HOME`，因此激活过程不会迁移或写入开发者真实家目录。

与宿主自己的读取器共用 `skills/` 的代价是：每个条目多一份被遮蔽的候选，每个被遮蔽的名字多一条宿主 warning——方向由 rank 决定。面板赢下这次取舍，因为它是唯一知道用户已禁用该条目的读取器。

这份代价还是按 profile 有界的：web bundle 关掉了宿主的 `skill-filesystem` 行（`packages/bundle/web-app/cordis.patch.yml`），因为在那一层由 preset 负责本地发现，所以只有 base 系 profile 才同时存在两个读取器。把条目留在这个共享目录仍然是取舍的正确一侧：为了省掉一份重复候选而把它们搬回插件私有存储，等于把用户内容放回"其它 Agent 工具读不到"的地方，而那正是本决策要修的问题。

## 验证

`tests/storage-migration.test.ts` 覆盖面板与服务声明的迁移、搬空目录、冲突与重复执行；`tests/user-panels.test.ts`、`tests/mcp-direct-config.test.ts`、`tests/lsp-direct-config.test.ts` 与 `tests/server-config.test.ts` 覆盖新根目录下的增删改与校验；`tests/panel-resources.test.ts` 覆盖已安装套件的编辑包含性。`tests/user-panels.test.ts` 还钉住面板 provider 的 rank 低于宿主读取器的 500——一旦优先级被悄悄改动，这条断言会失败。
