# 2026-09-17 — Agent Plugins v1 一致性与 com.deepseek.harness 命名空间

## 决定

`agent-plugin-v1` 套件只读三类输入：规范的固定位置（`skills/`、`mcp.json`），以及本客户端的 §8 扩展命名空间 `com.deepseek.harness`（清单数据在 `extensions` 下，文件在同名顶层目录下）。共用根目录约定（`commands/`、`agents/`、`hooks/`、`hooks.json`、`lsp.json`、`.lsp.json`、`.mcp.json`）不再作用于该方言，出现时写入扫描备注。清单内联组件键按 §5.2 报告后忽略。两个已发布版本（1.0.0、1.1.0）都受识别，各自按内置 schema 校验。

命名空间承载可移植格式装不下的内容：命令、代理角色、hooks、LSP 声明，以及按 `mcp.json` 服务器名索引的逐服务器客户端策略（`auth`、`enabledTools`、`disabledTools`、`startupTimeoutMs`、`toolCallTimeoutMs`）。OAuth 从被手工改写的 vendored `mcp.schema.json` 迁入命名空间，该文件已恢复上游原文；§10.1 禁止把已发布的 schema 标识指向不同内容。可移植 `mcp.json` 的值严格按 §9.2 处理：只有 `${PLUGIN_ROOT}`/`${PLUGIN_DATA}` 替换，其余保持字面量，凭据解析器不参与可移植包。用户自有的 MCP 数据（`~/.agents/mcp.json`、项目原生配置、逐服务器覆盖配置）保留 `${NAME}` 解析与自身的宽容度；覆盖配置是用户数据，不属于包数据。

## 被否决的替代方案

- **为 v1 保留共用目录回退。** 否决：套件会读到规范没有定义的文件，悄悄改变上游合规包的含义。加备注并要求命名空间声明让边界可见且须显式加入。
- **继续在 vendored `mcp.schema.json` 里加 `auth`（先前状态）。** 否决：vendored 文件必须与规范标识逐字节一致；客户端专属字段属于命名空间，§8 正是为此存在。
- **可移植 `mcp.json` 做凭据展开。** 否决：§9.2 要求保持字面量；客户端管理的凭据路径是逐服务器覆盖配置（设置卡片）与命名空间策略。
- **命名空间只凭目录即可读（不要求清单声明）。** 暂时否决：要求 `extensions["com.deepseek.harness"].schemaVersion` 让两个位置保持耦合、命名空间严格加入制。§8 允许两个位置各自独立；若真出现只带目录的套件，再拆开门禁并在此记录。
- **逐服务器策略用派生 serverName（`suiteId__serverKey`）索引。** 否决：命名空间由套件作者书写，作者知道 `mcp.json` 里的名字，不知道本客户端的派生规则；挂载期的重名已由 `duplicate-mount` 处理。

## 后果

- 未声明命名空间的 v1 套件只贡献技能与 MCP——这是设计使然。本仓库自己的套件样本已声明命名空间。
- vendored schema 的更新重新变回纯粹的上游复制；`schemas/com.deepseek.harness/` 按自己的 `schemaVersion` 演进。
- `PLUGIN_DATA` 在任何 stdio 启动前创建，两个变量在配置 env 叠加之后注入（§9.1），数据目录的 `cwd`/`args` 引用首次启动即可用。

## 相关

- [MCP 用户策略走覆盖记录](../feature/2026-09-21-mcp-user-policy-in-overrides.zh.md) —— 命名空间声明是套件给出的默认值：服务配置的高级设置可以覆盖两个超时，用户的工具拒绝只让声明好的过滤收得更紧，套件白名单不可放宽。
