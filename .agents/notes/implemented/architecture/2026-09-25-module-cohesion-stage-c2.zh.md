# Agent Note：模块内聚 Stage C2——错位模块迁移与分层箭头门禁

Status: implemented

## 问题

[模块内聚计划](../../../../docs/developer/design/module-cohesion-plan.md)测得的基线：`src/application/` 在 11 个文件里反向 import `src/runtime/` 40 次，与工程重构计划画的箭头相反，且该方向没有任何门禁。反向边之所以存在，是因为十几个纯模块（存储、投影、校验、区域路由、portable 格式映射器）积累在 `runtime/`，而消费它们的 service 长在 `application/`。

## Decision

把纯模块全部迁入 `application/`，并把箭头变成门禁：

- **存储与持久化**：`state-store`、`storage-migration`、`legacy-root-migration`、`mcp-overrides`、`mcp-direct-config`、`lsp-direct-config`、`lsp-server-state`、`server-config`、`user-store`、`user-hooks`、`profile-seam`。
- **投影与校验**：`mcp-redaction`、`mcp-status`、`lsp-status`。
- **portable 格式映射器**：`mcp-config` 整体迁移。"纯半边"（effective servers、policy 解析、credential refs）与"挂载半边"（`toMcpMounts`）共享类型和 spec 段落；为一个分层技术性拆文件会把 JSDoc 契约切成两半。`runtime/mcp-mounts` 反向引用它——这是箭头的合法方向。
- **桥接配置词汇**：`mcp-client/config.ts` 改为 `application/mcp-bridge-config.ts`。它是扩展 `model` 类型的类型/常量数据，`ReconnectConfig` 的所有权随之迁移。
- **选择器与 seam**：`mcp-backend`（schema 声明 + 宿主探测；node:module/fs 属 application 合法范围）、`regions`、`deadline`，以及 agent-role frontmatter 解析器（从 527 行的 cordis router 抽出为 `application/agent-roles.ts`，执行半边留在 runtime）。
- **结构化 seam 类型声明在 `ports.ts`**：`McpToolSnapshot`、`LspMountStatusSource`、panel-resources 里的 user-panel store 面。线上类型（`McpBackend`、`McpMountDiagnostic`、`LspMountDiagnostic`）迁至 `contracts/mcp.ts` 与 `contracts/lsp.ts`。
- **locale 读取改为端口**：`CatalogPorts` 增加 `localePreference(): string`，由 `index.ts` 以 `readLocalePreference() ?? 'zh'` 接线。组合根持有宿主 seam，service 保持宿主无关。
- `dependency-cruiser` 的 `application-cannot-import-runtime` 由 warn 升为 error；当前零违规。

## Alternatives considered

- **把 `mcp-config.ts` 按纯/挂载两半跨层拆开。** 否决：一个文件对应一份 spec；拆分只为服务门禁。
- **locale 读取继续直接 import `runtime/host-locale`。** 否决：基于设置的偏好正是 `CatalogPorts` 要声明的宿主 seam，且有两个 service 读取它。
- **在旧路径留 re-export 垫片。** 否决：这是 1.0 前的包，内部路径没有外部引用者；测试直接改为引用新位置。

## Consequences

- `src/application/` 不再 import 任何 runtime 模块；`src/runtime/` 以合法方向引用 application（映射器、backend 选择、store 类型、role 解析）。
- `legacy-root-migration.ts` 被迁移而非删除：`storage-migration.ts` 早已吸收 pre-0.5.4 `agent-plugins-data` 的并入逻辑，但该模块在 `src/` 内仍无引用者——删除是独立决策，需要 release note 一行，不该是重构的副作用。
- `inspectToolRegistry` 不再经 `mcp-status` 转出口；消费方（`index.ts`、status 测试）直接 import `runtime/tool-registry-observer`。

## Verification

- `pnpm run check:quick`（四个 tsc 工程 + eslint）、`pnpm run test`（98 个文件、842 个测试）、`pnpm run check:architecture`（零违规，规则为 error）——全部通过。
- 每个迁移模块保持公共 API 不变；仅 import 说明符变化。
