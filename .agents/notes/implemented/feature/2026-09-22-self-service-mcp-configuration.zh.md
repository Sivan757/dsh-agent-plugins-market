# Agent Note: MCP 配置开始有回应

Status: implemented

## Problem

此前配置一个 MCP 服务是单向的：保存要么成功、要么只给出一句话；粘贴多个服务时要么整体成功、要么整体失败；挂载失败只打印传输层说的话。本次调研了六个开源 MCP 管理器，它们给出的答案高度一致：拒绝时点名字段、导入时逐条报告、失败时附上下一步、多行字段接受键值对粘贴。

## Decision

- **状态载荷带上每个工具的输入结构。** `inspectToolRegistry` 从宿主 `schemas()` 列表里读取 `parameters`，`buildMcpStatus` 只在它不超过 20000 字符时保留，面板从工具名展开参数表。
- **被拒绝的保存点名它的字段。** `McpConfigError` 携带由 schema `instancePath` 折算出的 `{ field, message }`；路由把它们与消息一起返回；编辑器把每条放到对应输入框下。schema 无法归属的原因——URL 协议规则、占位符规则——留在表单级，不猜挂到某个字段上。
- **粘贴按条判定。** `importUserMcpServers` 逐条检查名字形状、冲突与 schema，全部检查完成后只写一次文件，并返回导入了什么、跳过了什么以及各自原因。
- **失败带上下一步。** `mcpGuidanceKey` 把各层实际产出的措辞归成一行建议——凭据、授权、传输方式、后端、DNS、TLS、连接被拒、超时、命令缺失、进程提前退出、握手失败；认不出来的原因不给建议，而不是给一句通用话。
- **多行字段接受整块粘贴。** `rowsFromPastedText` 识别 `KEY=VALUE` 与 `Key: Value`，剥离一对引号，每行追加成一条记录。

## Alternatives considered

- **只在前端做字段校验。** 拒绝：schema 才是权威，在面板里重新实现一遍规则必然与它漂移。面板负责呈现服务端的答复，不负责自造答复。
- **把被跳过的条目合并成一条消息。** 拒绝：用户需要知道每条原因属于哪一条。
- **为无法归类的原因给一句默认建议。** 拒绝：一句对什么失败都成立的话，等于什么都没说。

## Consequences

- 状态载荷按每个工具的 schema 增长，单工具上限 20000 字符；面板只渲染顶层，模型侧的工具清单仍是完整定义。

## Testing

`tests/client-mcp-detail.test.ts` 覆盖参数展开与建议分类；`tests/mcp-status.test.ts` 锁定 schema 传递与大小上限；`tests/server-config.test.ts` 断言被拒绝的保存点名字段；`tests/mcp-direct-config.test.ts` 覆盖逐条导入结果与覆盖；`tests/client-detail-editors.test.ts` 覆盖整块粘贴。

## Related

- [MCP 用户策略走覆盖记录](./2026-09-21-mcp-user-policy-in-overrides.zh.md) —— 高级设置折叠区里放了什么。
- [服务详情先当档案来读](./2026-09-21-service-detail-skeleton.zh.md) —— 这些回应所填充的骨架。
