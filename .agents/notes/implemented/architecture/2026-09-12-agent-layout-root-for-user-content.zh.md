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

启动时在读取任何存储之前完成迁移：`user/{skills,commands,agents}` 与 `data/user/...` 迁入 `~/.agents/<kind>`，`data/mcp-servers.json` 与 `data/lsp-servers.json` 迁入 `~/.agents/mcp.json` 与 `~/.agents/lsp.json`。搬空的旧面板目录会被删除；内容冲突则保留在原路径并阻止激活，报出该路径。

## 已考虑的替代方案

**继续用单一根目录。** 否决：这正是要修的问题——用户内容对 `.agents/` 约定所服务的那些工具不可读。

**同时把技能改成跨工具的 `skills/<name>/SKILL.md` 目录形态。** 本次否决：面板按条目编辑单个文档，且扁平 `skills/*.md` 也是被接受的写法；目录形态是独立改动，需要独立迁移。

**把 `~/.agents` 当作普通来源发现，而不是面板存储。** 否决：面板需要增删改与 `disabled` frontmatter 控制，catalog 读取器不提供这些。

## 后果

自建内容在卸载插件后仍然保留，这正是迁移的目的。`~/.agents` 是共享目录：插件不得删除它或挪用不认识的条目，迁移只写入自己拥有的子目录与文件。配置出的 `~/.agents` 若与插件存储重叠，启动时直接拒绝。测试会 stub `DSH_AGENTS_HOME`，因此激活过程不会迁移或写入开发者真实家目录。

## 验证

`tests/storage-migration.test.ts` 覆盖面板与服务声明的迁移、搬空目录、冲突与重复执行；`tests/user-panels.test.ts`、`tests/mcp-direct-config.test.ts`、`tests/lsp-direct-config.test.ts` 与 `tests/server-config.test.ts` 覆盖新根目录下的增删改与校验；`tests/panel-resources.test.ts` 覆盖已安装套件的编辑包含性。
