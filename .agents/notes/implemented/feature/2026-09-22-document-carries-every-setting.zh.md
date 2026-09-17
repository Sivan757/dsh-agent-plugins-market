# Agent Note: 所有设置都由这份文档承载

Status: implemented

## Problem

配置编辑器是一个表单，表单没有控件的地方就是够不到的地方：可移植 `mcp.json` 没有位置的超时、工具拒绝清单、别的 MCP 客户端引入的键。每一处缺口最后都变成一条"给表单加控件"的需求，而每加一个控件都会让所有人的常用路径变长。

## Decision

- **一份文档，两处载体。** 编辑器的 JSON 就是 Agent Plugins 规范已经为一个服务定义好的那份文档：`mcpServers` 下的可移植定义，加上 `com.deepseek.harness` 命名空间里本客户端的策略（`toolCallTimeoutMs`、`startupTimeoutMs`、`disabledTools`、`auth`）。没有发明新形状：可移植那一半保持规范固定的形状，策略那一半正是 §8 完全交给本客户端的位置。
- **表单是视图，不是模型。** `ServerConfigEditor` 解析文档，表单只写自己那一半，另一半原样带过，因此表单不认识的键在表单编辑与 JSON 编辑之后都还在。
- **只提交改动过的项。** `policyRequestOfDocuments` 只提交用户动过的项；从文档里删掉的项表示恢复继承。这样在一个挂载后端设的值不会顺带带到另一个后端，在那里同样的值可能被拒绝。
- **用户自有声明属于本地数据。** `validateUserMcp` 与用户自有服务的保存路径以 `packageRules: false` 调用 `validateMcpJson`：未知键原样保留，仅属于分发包的规则（闭集的服务形状、裸命令名、插件相对路径）关闭，各传输的形状与必需字段仍然校验。套件随包发布的 `mcp.json` 保留全部包规则。

## Alternatives considered

- **发明一种平铺形状**（把 `toolCallTimeoutMs` 与 `command` 并列）。拒绝：规范按传输方式把服务对象设为闭集，那样文件会声明一个它并不满足的 schema。
- **继续往表单加控件。** 拒绝：每个不常用设置都会让常用路径变长，而需求队列不会因此清空。
- **对所有文件都放宽 schema。** 拒绝：套件随包发布的 `mcp.json` 是分发包契约，接受本客户端挂载不了的字段，等于报告一个不可能成立的挂载。
- **把策略留在另一份文档里。** 拒绝：只能从一个视图够到的设置，在另一个视图里会被静默丢弃。

## Consequences

- 编辑器的 JSON 是一份服务文档而不是裸定义，所以从其它客户端粘贴过来的内容需要把定义放在 `mcpServers` 下。
- `ServerConfigPayload` 带上声明键；没有它客户端无法为文档定键。
- 用户自有文件里可以有桥接在挂载时忽略的字段。它们被忽略，永远不会被丢弃。

## Testing

`tests/mcp-direct-config.test.ts` 让用户文件里的未知键留存；`tests/server-config.test.ts` 保存一个带未知键的用户自有服务，同时仍然拒绝分发包上的未知键；`tests/client-detail-editors.test.ts` 证明一次表单编辑会保留表单没有控件的键；`tests/client-server-config-policy.test.ts` 提交写进文档的策略，且只提交改动过的项。

## Related

- [MCP 配置开始有回应](./2026-09-22-self-service-mcp-configuration.zh.md) —— 这些回应说了什么。
- [MCP 用户策略走覆盖记录](./2026-09-21-mcp-user-policy-in-overrides.zh.md) —— 策略落在磁盘的哪里。
