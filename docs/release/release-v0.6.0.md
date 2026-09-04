# 发版材料：v0.6.0（草稿）

> 基准：`dsh-agent-plugins-market-v0.5.3`（2026-08-28）之后 main 上的 17 个提交。有大量 `feat:` 提交 → release-please 按 semver 规则将升到 **minor：0.6.0**。状态：`main` 领先 `origin/main` 17 个提交，尚未推送。

---

## 一、发版清单（Release Checklist）

### 1. 代码与质量门禁

- [x] 本地全量校验通过：`pnpm run check:refactor`（typecheck + lint + format:check + contract tests + dependency-cruiser）✅ 已验证（2026-08 本地）
- [x] 全量测试通过：`pnpm run test` ✅ 已验证：41 个测试文件 / 263 个测试全绿（含 mcp-bridge / mcp-oauth / mcp-backend / mcp-mounts / lsp-status / routes）
- [ ] `pnpm run build` 产物正常（`lib/` + `client/`，`prepack` 钩子可复现）
- [ ] CI（GitHub Actions）在推送后全绿

### 2. 文档同步（本次改动大，README 需要更新）

- [ ] `README.md` / `README.zh.md`：MCP 一节改为"内置 MCP 客户端桥（默认，含 OAuth）+ 宿主 dsh-mcp-client 兼容模式（设置页可切换）"，不再把 dsh-mcp-client 描述为唯一挂载方式
- [ ] 两个 README 的支持矩阵：补 **LSP 服务器** 行（inline `lspServers` 声明发现 + `dsh-lsp-stdio` 挂载 + 直配表 + 状态面板）
- [ ] Optional peers 说明：`@deepseek-ai/dsh-mcp-client` 从"MCP 注入"改为"仅宿主兼容模式需要"
- [ ] `package.json` keywords 可考虑补 `lsp` / `language-server`
- [ ] docs-site 同步：新功能页（LSP surface、MCP backend switch、OAuth 授权/重授权）

### 3. 行为变更确认

- [ ] 新增运行时依赖 `@modelcontextprotocol/sdk`（`dependencies`）与 `zod`，已入 `pnpm-lock.yaml`
- [ ] 数据根迁移：`~/.dsh/agent-plugins-data` → `<userRoot>/data`（启动时一次性幂等迁移，需真机验证旧目录被正确折叠/清理）
- [ ] `mcp.json` schema 新增：streamable-http / sse server 支持 `auth`；legacy SSE 从"unsupported-transport"变为可挂载
- [ ] `mcp__<serverName>__` 命名空间被宿主原生客户端或其他插件占用时：跳过挂载并给出诊断（不报错中断）
- [ ] 手工冒烟（建议列成 issue 核对）：
  - 安装一个带 OAuth 的 MCP 套件 → 浏览器授权 → 工具以 `mcp__<server>__<tool>` 注册
  - 设置页切换 MCP backend（bridge ↔ host）→ 重挂载生效，`<dataRoot>/settings.json` 持久化
  - 重新授权（Re-authorize）放宽 scope 的恢复路径
  - LSP 面板：声明显示、启动中状态轮询、宿主缺失诊断、直配表保存后下一 reconcile 生效
  - 安装确认对话框显示 `lsp` surface 标签

### 4. 发布流程（npm-publish.yml 内嵌 release-please，详见 docs/release/release-process.md）

- [ ] 提交本地未推送的变更并 `git push origin main`（当前领先 17+ 个提交；`docs/release/**` 在 paths-ignore 内，纯文档推送不触发 release-please）
- [ ] npm-publish.yml 在 main 上运行后，确认 Release PR（0.5.3 → 0.6.0）被开/更新：核对 PR 内 package.json version、CHANGELOG 小节、.release-please-manifest.json 三处一致（PR head 分支固定为 `release-please--branches--main--components--dsh-agent-plugins-market`，base 是 **main**，没有 npm-release 分支）
- [ ] quality + CodeQL 绿后人工合并该 Release PR（历史上由仓库所有者合并，如 #26）
- [ ] 确认合并后的 npm-publish 运行自动完成：打 tag `dsh-agent-plugins-market-v0.6.0`、创建 GitHub Release（正文自动生成）、OIDC trusted publishing 发布 npm（远端会再跑 check:refactor + test）
- [ ] 若 npm 报该版本已存在，参照 v0.5.1 先例在 npm-publish job 的 `if` 中排除该 tag

### 5. 发布后

- [ ] GitHub Release 正文为 release-please 自动生成的 CHANGELOG 小节（历史 4 个 Release 均未人工编辑）；如需 Highlights / Upgrade notes，手动追加 `release-v0.6.0.md` 的英文草稿到自动正文之后
- [ ] 中文公告版（见下）投放 README / docs-site / 社区渠道（docs/promotion）
- [ ] 发布后抽查：`npm view @deepseek-ai/dsh-agent-plugins-market dist-tags`、安装 `@latest` 冒烟

---

## 二、发版内容草稿（Release Notes）

### English

## dsh-agent-plugins-market 0.6.0

This minor release ships two big surfaces: **first-class LSP server support** and a **self-built MCP client bridge with OAuth** — plus a batch of reliability fixes to MCP status, credentials, and source scanning.

### ✨ Highlights

**LSP servers are now a managed surface** (parity with skills/MCP/hooks):

- Discovery of Claude Code–style inline `lspServers` declarations on marketplace entries and plugin manifests, with fail-closed validation (case-variant extensions like `.c`/`.C` collapse cleanly). Declaration-only entries (e.g. the official typescript-lsp plugins) are recognized as suites.
- Enabled suites mount their whole `lspServers` table as one `dsh-lsp-stdio` child plugin, with derived provider keys, suite-granular lifecycle, bounded retry (1.5s–120s), and classified seam-conflict diagnostics. A missing host package reports `host-missing` without burning retries.
- A direct `lspServers` table (Claude Code shape, so upstream snippets paste as-is) can be configured by the user and shares the exact mount/retry/diagnostic lifecycle of suite declarations.
- New **LSP status panel** (settings section) mirroring the MCP panel: summary chips, state pills, filters (all/plugin/direct/blocked), a detail dialog with launch command and extension map, and a `starting` verdict with polling while the mount pass is in flight.
- The `lsp` surface joins the per-surface toggles and the install confirmation dialog.

**MCP client bridge with OAuth — no host dsh-mcp-client runtime dependency:**

- A market-owned bridge (`src/runtime/mcp-client/`) mounts servers over stdio, Streamable HTTP, and legacy SSE via the MCP SDK, with **OAuth 2.1 active by default** on the first 401 (static `Authorization` headers or `auth.enabled: false` opt out). Grants persist as `mcp-auth/<serverName>`, compatible with the existing credentials surface.
- Tools register on the host ToolRuntime under the `mcp__<serverName>__<rawName>` contract, with a two-phase sync that swaps generations only after a successful `tools/list`.
- Legacy SSE servers now mount instead of reporting unsupported transport; `auth` is accepted on streamable-http and sse servers.
- New **MCP backend switch** on the settings page: built-in bridge (default, OAuth + SSE) vs. host `dsh-mcp-client` compatibility mode (probed live with version). The choice persists in `settings.json` and remounts on switch.
- Mounts into a foreign `mcp__<serverName>__` namespace (host-native client or another plugin) are skipped with a per-server diagnostic and retried on a later reconcile pass.
- **Re-authorize** action drops a stored grant and re-runs the mount so a too-narrow approved scope can be widened; the connect/re-authorize labels and the override note on healthy rows were cleaned up.

### 🛠 Fixes & reliability

- Re-authorize resolves the credentials store lazily, fixing the permanent "credentials service is not mounted" failure when provisioning happens after `apply()`.
- MCP status: the "modified by override" note no longer decorates healthy rows.
- Legacy-root migration now writes overrides to the directory overrides resolution actually reads (previously one level apart — an override file could be silently ignored and the server mounted without auth).
- LSP status reports `starting` instead of a frozen `host-missing` during startup.

### 🔧 Refactors

- Source scanning runs through a strategy chain with layered fallback: parseable-but-empty marketplaces fall through to rooted/flat strategies, Claude `{ source: 'github' }` shorthand resolves, multi-dialect marketplaces (Claude Code + Codex) no longer shadow each other, and self-references fold back onto the configured source. Scan notes surface in the source tab with a ⚠ badge — no more silent "normal but empty". (Verified: agent-skills 0 → 1 suite / 25 skills, zero drift on the other nine sources.)
- Plugin data persists under the user root (`<userRoot>/data` instead of a sibling `~/.dsh/agent-plugins-data`), with a one-time idempotent migration that merges and cleans the legacy root.

### 📦 Upgrade notes

- New runtime dependency: `@modelcontextprotocol/sdk` (+ `zod`). Node ≥ 22 unchanged.
- `@deepseek-ai/dsh-mcp-client` is now an **optional** peer used only by the host compatibility mode; the built-in bridge needs nothing from the host.
- First start after upgrade migrates data from `~/.dsh/agent-plugins-data` into `<userRoot>/data` (merge, non-destructive; the emptied legacy directory is removed only when nothing else remains in it).
- If your suite's MCP server is already mounted by a native host MCP client, the plugin skips it with a diagnostic instead of failing the mount.

**Full changelog**: https://github.com/Sivan757/dsh-agent-plugins-market/compare/dsh-agent-plugins-market-v0.5.3...dsh-agent-plugins-market-v0.6.0

---

### 中文公告版（社区渠道用）

**dsh-agent-plugins-market 0.6.0 发布**

两大新能力：

1. **LSP 服务器一等公民支持**：识别 Claude Code 风格的内联 `lspServers` 声明（官方 typescript-lsp 等声明式插件可直接安装），按套件挂载为 `dsh-lsp-stdio` 子插件；支持用户直配 `lspServers` 表；新增 LSP 状态面板（汇总芯片、状态徽标、筛选、详情对话框、启动中轮询）。
2. **自研 MCP 客户端桥 + OAuth**：内置桥默认启用，stdio / Streamable HTTP / legacy SSE 全覆盖，首次 401 自动发起 OAuth 2.1 浏览器授权；不再强依赖宿主 dsh-mcp-client。设置页可一键切换"内置桥 ↔ 宿主兼容模式"；新增"重新授权"放宽 scope；宿主已占用命名空间时跳过并给诊断而非报错。

其他：源扫描策略链重构（空 marketplace 回退、多方言共存、自引用解析，扫描备注带 ⚠ 透出）；插件数据统一迁移到 `<userRoot>/data`（自动幂等迁移）；若干 MCP 状态/凭据修复。

升级注意：新增运行时依赖 `@modelcontextprotocol/sdk`；dsh-mcp-client 变为可选 peer（仅兼容模式需要）；升级后首次启动自动迁移旧数据目录，无破坏性变更。

---

## 三、版本判定说明

- 17 个提交中 `feat:` 12 个（含多个新 surface），无 `feat!`/`BREAKING CHANGE:` → **0.5.3 → 0.6.0（minor）**。
- 若你希望把"数据目录迁移 + MCP 桥替换宿主挂载"宣传为破坏性变更（行为变化但 API 兼容），可保持 0.6.0 并在 notes 中以 Upgrade notes 强调，无需升 major。
