# MCP OAuth：现状与整改方案

> 2026-09-01 · 针对"dsh-mcp-client OAuth 支持被错误实现到 deepseek-harness 上游"的整改决策文档。结论先行：**采用方案 C** —— 回退上游改动，OAuth 客户端在 dsh-agent-plugins-market 插件内自建。

---

## 一、问题背景

用户安装的 Cloudflare MCP 套件（`builds/bindings/observability/api` 四个服务器）在连接时收到 HTTP 401 + OAuth 质询，导致持续挂载失败。根因排查确认：

- 这四个端点均要求 OAuth 2.1 授权（RFC 9728 发现 → RFC 7591 动态客户端注册 → PKCE → 浏览器授权），服务器本身工作正常（无授权的 `docs.mcp.cloudflare.com` 一直正常）。
- 宿主的 `@deepseek-ai/dsh-mcp-client`（0.1.1-rc.2 / rc.8）在创建 `StreamableHTTPClientTransport` 时只传 `headers`，未实现 MCP 授权规范，遇到 401 只能报泛化的 "initial connection or tool synchronization failed"。

## 二、已发生但违规的实现（待整改）

应"根治 OAuth"的要求，OAuth 支持被直接实现在了 harness 上游仓库（`~/workspace/deepseek-harness`），产生两个**仅本地、未推送**的提交：

| 提交         | 内容                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `7a62f20452` | 浏览器授权环节保持：OAuth 等待用户批准期间 supervisor 不因 initialize 60s 超时销毁连接代；`serverName` 折叠进凭证键语法；浏览器 opener 可注入 |
| `a6df20cbc4` | streamable-http OAuth 默认静默尝试：401 质询才激活，静态 `Authorization` 头或 `auth.enabled: false` 显式退出                                  |

改动范围 16 文件 / 约 1239 行，核心是：

- `packages/mcp/mcp-client/src/oauth.ts`（432 行）：`LoopbackOAuthClientProvider`，实现 MCP SDK 的 `OAuthClientProvider`；token/客户端信息持久化到 `ctx.credentials` 的 `mcp-auth/<serverName>` grant 记录；一次性 127.0.0.1 回调 + 系统浏览器；PKCE verifier 仅进程内。
- `transport.ts` / `connection.ts` / `index.ts`：provider 接线、浏览器环节的连接代保持、 `auth` 配置块（`enabled`/`scope`/`storage.callbackPort`）。
- 测试 449 行（`oauth.spec.ts` 16 例、`auth-config.spec.ts` 12 例 + 既有用例适配），全部通过。

**违规点**：项目决策明确"DSH LSP/tool 改进一律留在 market 插件层实现，不改 deepseek-harness 上游"。该实现必须在 `dsh-mcp-client` 内部才能生效（transport 由它创建，宿主 rc.8 无任何注入缝），执行时应停下确认，而不是默认动上游——这是决策失误。

**额外违规产物**：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/` 被替换为含 OAuth 的自建版本（环境手术），使本机 OAuth 暂时可用，但与上游 binary 不一致。

## 三、关键技术事实（决定了方案的边界）

1. **宿主 rc.8 的 mcp-client 没有任何扩展缝**：`exports` 只有 `Config/apply/inject/name`，Config 不接受自定义 transport，也没有 authProvider 支持。插件无法从外部给它注入授权。
2. **market 通过 `await import('@deepseek-ai/dsh-mcp-client')` 挂载宿主包**（`src/runtime/mcp-mounts.ts`）。因此"把实现搬进 market 的其他文件"不可行——搬了也注入不到宿主的 transport 里。
3. **唯一合规路径**：market 对 streamable-http 服务器**自建 MCP 客户端** （自己 `new Client` + `StreamableHTTPClientTransport(authProvider)` + 连接管理）， `@modelcontextprotocol/sdk` 成为 market 的正式 dependency。stdio 服务器不需要 OAuth，继续走宿主 apply，不受影响。
4. SDK 目前不在 web profile 的 node_modules 中；market 把它声明为 dependency 后，pnpm 安装（profile 用 `file:` 依赖）会一并装入，解析路径成立。

## 四、方案对比

### 方案 A：完全回退，OAuth 下线

harness reset 回上游、恢复装机 lib、方案文档存档。

- ✅ 合规彻底、工作量最小（半小时）
- ❌ Cloudflare 等所有 OAuth 型 MCP 回到连不上；后续 Figma 等同类需求每次都要重新面对

### 方案 B：保留违规产物

- ❌ 本地仓与装机态分裂；`dsh` 每次升级都会覆盖回上游版本，功能随时消失；违规状态持续存在
- **不推荐**

### 方案 C：插件层自建 MCP 客户端（选定）

market 对 streamable-http 自建客户端（含 OAuth），stdio 继续用宿主 apply。

- ✅ 上游零改动，完全符合"实现必须在插件内"
- ✅ 产出可发布：所有 market 用户装完即得 OAuth 能力，Figma 等同类服务器零配置直连
- ✅ 1239 行中约 700 行（`oauth.ts` 全部、supervisor 浏览器环节保持、全部测试）可从 harness提交搬运——代码已写好测过
- ⚠️ 需新写：market 侧的 `streamable-http` 客户端插件（约 300–400 行：Client 构造、provider 接线、连接保持、与 `mcp-mounts` 的挂载协议对齐）、SDK dependency 接入、测试适配
- ⚠️ harness 侧仍需回退 + 恢复装机 lib（与 A 相同的清理动作）

## 五、方案 C 执行计划

1. **留档**：`git format-patch b150a551b8..HEAD` 导出两个提交到 market 仓 `docs/upstream-proposal/`（作为将来向上游提案的完整素材，也作为搬运蓝本）。
2. **回退 harness**：`reset --hard b150a551b8`，工作树与上游一致。
3. **恢复装机**：从 npm 缓存/重装恢复 `/opt/homebrew/.../dsh-mcp-client/lib` 原版，校验 sha 与上游 rc.2 一致。
4. **market 自建**：
   - `deps`：`@modelcontextprotocol/sdk` 加入 dependencies（^1.29.0）
   - `src/runtime/mcp-client/`：`oauth.ts`（搬运）、`streamable-http-client.ts` （Client + transport + 浏览器环节保持的轻量 supervisor）、`mount.ts` （对齐 `mcp-mounts` 的 `McpMountRequest` 协议；stdio 仍委托宿主 apply）
   - 测试：搬运 `oauth.spec.ts`，新增挂载协议测试
5. **验证**：market 全量测试 + typecheck + lint + build；web profile 重装后实测 Cloudflare 四服务器重新授权转绿、Figma 式无声明服务器静默连上。

## 六、本机数据的善后说明

`~/.dsh/.credentials.yaml` 中已有 4 条 `mcp-auth/*` grant 记录（3 条含有效 token），由违规期间的实现写入。格式与方案 C 的插件兼容（同一套存储设计），方案 C 落地后可直接复用，无需清理；若最终走方案 A，可手动删除这些条目。

---

**决策**：方案 C。本文档作为整改依据留档；harness 侧回退与 market 侧实现见后续提交。

## 七、整改完成记录（2026-09-01）

- **harness 侧**：两个提交已 `reset --hard b150a551b8` 回退，patch 系列留档于本目录 `patches/`（已验证可在基线上干净重放）；装机 lib 已恢复并经 npm 上游 rc.2 逐字节校验一致。
- **market 侧（最终取"全自建"形态，方案 C 的超集）**：`src/runtime/mcp-client/` 自建完整 MCP 客户端桥——stdio、Streamable HTTP（OAuth 2.1 默认静默激活）与 legacy SSE 三传输，运行时零依赖宿主 `dsh-mcp-client`。工具经 `ctx.tools.register` 以 `mcp__<serverName>__<rawName>` 命名契约直桥宿主 ToolRuntime；凭证复用 `mcp-auth/*` grant 记录。仅新增 `@modelcontextprotocol/sdk` 与 `zod` 两个依赖；`scrubbedParentEnv`、credential key 语法、schema 子集校验等宿主小缝就地 port（见 `host-seams.ts`、`json-schema-subset.ts` 内的上游参照注释）。
- **验证**：typecheck + lint + build + 255 全量测试通过（含移植的 oauth 16 例、桥接 25 例）；真实 stdio MCP 服务器 E2E 冒烟在开发仓与 web profile 安装副本上均通过。
