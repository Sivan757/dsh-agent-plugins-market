# Agent Note: The new-service dialog is one short form

Status: implemented

## Problem

新建 MCP 服务弹窗有三层入口：两个快捷按钮（模板、粘贴 JSON）、一个带条数统计、覆盖开关与逐条报告的粘贴框，然后才是表单。快捷入口的存在理由是表单盖不住服务定义里的每个键，但它们把这份复杂度摆在了最常见路径——创建一个表单本就装得下的服务——面前。

## Decision

- **弹窗就是表单。** `McpAddModal` 只渲染名称、传输方式与该传输方式唯一必需的字段，外加编辑器原有的高级设置折叠区。模板列表与粘贴框移除。
- **JSON 是逃生舱。** 表单表达不了的定义在编辑器的 JSON 视图里手写——同一份文档，表单没有字段的键一个不丢，只是从「粘贴解析」变成「直接输入」。
- **导入管线随 UI 一起移除。** `POST /mcp-servers/import`、`Catalog.importMcpServers`、`McpService.importServers`、带逐条结果 wire 的 `importUserMcpServers`、`MCP_TEMPLATES`、`parsePastedServers`/`parsePastedServer`/`normalizePastedServer`，以及对应的 locales 与样式全部删除。新增服务只走 `mcp-servers/add`，它在写入前本就校验完整文档。

## Alternatives considered

- **保留粘贴作为单服务填表。** 拒绝：它保留了「填入表单 vs 导入」的双动作与条数/覆盖开关，而这些正是本次要甩掉的交互；多服务粘贴恰恰是本次移除的批量操作。手上有整份 `mcpServers` 映射的用户可以直接粘进 JSON 视图再删掉不要的条目。
- **把快捷入口挪进高级设置折叠区。** 拒绝：这让第二套交互模型在折叠区后继续活着，却没有复现需求；按钮已上线数周，无遥测的复查结论是用户走的只有表单路径。
- **保留导入路由但下掉 UI。** 拒绝：一个没有任何客户端调用的 API 面是攻击面，不是便利。

## Consequences

- 从其它客户端配置导入的用户现在需要逐条复制，或直接编辑 JSON 视图。逐条跳过报告（名字非法、已存在）不再存在于任何地方。
- wire 契约少了一条路由（`importMcpServers`）；`MarketMutations` 少一个成员。不留弃用垫片：唯一的调用方就是本面板。
- `addUserMcpServer` 仍是唯一写路径，每次写入前的校验故事不变。

## Testing

`tests/mcp-status-render.test.ts` 断言弹窗打开后没有快捷按钮；`tests/routes.test.ts` 移除导入转发；`tests/mcp-direct-config.test.ts` 与 `tests/client-detail-editors.test.ts` 移除粘贴解析用例，后者保留 `rowsFromPastedText` 向 env/headers 行整块粘贴的用例。

## Related

- [所有设置都由这份文档承载](./2026-09-22-document-carries-every-setting.zh.md) —— 为什么 JSON 视图让快捷入口变得多余。
- [MCP 配置开始有回应](./2026-09-22-self-service-mcp-configuration.zh.md) —— 本次退役的逐条导入报告；其中点名字段与失败建议的决策仍然成立。
