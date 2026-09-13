# 发版材料：v0.7.0

> 基准：`dsh-agent-plugins-market-v0.6.2`（2026-09-10）之后 dev 上的 92 个提交（7 个 `feat:`，0 个 breaking）→ release-please 按 semver 自动升 **minor：0.7.0**。状态：`dev` 已推送（`ade79f1`），领先 `origin/main` 91 个提交。

---

## 一、发版清单

### 1. 代码与质量门禁

- [x] `pnpm run check:refactor`（typecheck + lint + format:check + contract + dependency-cruiser）✅ 143 模块 0 违规
- [x] `pnpm run test` ✅ **77 个文件 / 575 个测试全绿**（31.1s）
- [x] `pnpm run build` ✅ `lib/` + `client/`
- [x] `pnpm --dir docs-site exec astro build` ✅ 4 页
- [x] `pnpm run check:host-alignment` ✅ 基线 `0.1.5-rc.2`（`next`），11 个包全部对齐
- [x] `pnpm install --frozen-lockfile` + `prepare`（typecheck + build）✅
- [x] `npm pack --dry-run` ✅ 212 个文件，含 `lib/`、`client/`、`schemas/`、`cordis.patch.yml`、双语 README
- [ ] 推送后 CI（quality / CodeQL / Windows / docs-pages）全绿

### 2. 交付面

- [x] PR 清理：7 个 dependabot PR 全部关闭，有效升级折叠为一个 `chore(deps)` 提交
- [x] 分支清理：3 个已合并本地分支删除
- [x] `dependabot.yml`：删掉冗余的 `/docs-site` 条目（pnpm workspace 只有一个锁文件，该条目把每次升级拆成 manifest PR + lockfile PR，两者都过不了 `--frozen-lockfile`），补 `@types/node >=23` ignore
- [x] 安全公告：main 上 12 条 dependabot 告警涉及的 6 个包全部落到已修补版本（见下）
- [x] 依赖对齐：`@types/react-dom` `^19.2.4` → `~18.3.0`（与 `react-dom` 18.3.1 及宿主 `dsh-ui-primitives` 一致）
- [ ] 删除两个已合并的远端分支（`chore/host-fs-seam`、`fix/windows-path-containment`）——**需你确认后执行**

### 2.1 安全公告（GitHub Advisory）

main 的锁文件上 12 条告警、6 个包。**全部已在 dev 的锁文件里修掉**（范围内升级，无 manifest 变更）：

| 包       | 修复前 → 修复后 | 已修补版本 | 是否进入发布产物                    |
| -------- | --------------- | ---------- | ----------------------------------- |
| fast-uri | 3.1.5 → 3.1.7   | 3.1.6      | **是**（经 `ajv`，直接依赖）        |
| qs       | 6.15.3 → 6.16.0 | 6.16.0     | **是**（经 MCP SDK 的 express）     |
| hono     | 4.13.2 → 4.13.7 | 4.13.5     | **是**（经 MCP SDK 的 node-server） |
| js-yaml  | 4.3.1 → 4.3.2   | 4.3.2      | 否（docs-site 工具链）              |
| sharp    | 0.35.4          | 0.35.4     | 否（docs-site 构建）                |
| astro    | 7.3.2（已达标） | 7.2.8      | 否（docs-site 构建）                |

三个进入运行时的包都来自两个直接依赖（`ajv`、`@modelcontextprotocol/sdk`），插件自身的调用路径不可利用（ajv 解析的是本仓库自带 schema 的 `$id`，MCP SDK 的 HTTP server 只作客户端用），但发布 tarball 不应携带已知漏洞的传递依赖——尤其当补丁只差一个范围内小版本。

### 3. 行为变更确认

- [ ] **升级路径必测**：profile 里还留着旧版手工 LSP 层时，LSP 面板出现一次性升级横幅 → 点击移除 → 备份生成 → 语言服务器恢复挂载
- [ ] 手工冒烟（真机）：
  - 市场页六个页签、搜索/筛选/网格切换
  - 新装一个 LSP 套件（或直配一条 `lspServers`）→ 状态从 `starting` 落到 `mounted`
  - MCP 服务详情：连接 / 断开 / 重新授权
  - 把技能、命令、角色分别放到 `~/.agents/` 与项目目录，确认优先级
  - 设置页开启「后台刷新来源」，确认来源条目的进度提示

### 4. 发布流程（release-please 内嵌于 `npm-publish.yml`，详见 [release-process.md](release-process.md)）

- [x] `git push origin dev` ✅（`ade79f1`）
- [ ] 开 dev → main 的 PR，CI 绿后合并
- [ ] 确认 release-please 开出 **0.7.0** 的 Release PR（head 固定为 `release-please--branches--main--components--dsh-agent-plugins-market`，base 为 main），核对 `package.json` / CHANGELOG 小节 / `.release-please-manifest.json` 三处一致
- [ ] quality + CodeQL 绿后合并 Release PR（**合并前需你确认**）
- [ ] 合并后同 workflow 自动：打 tag `dsh-agent-plugins-market-v0.7.0`、建 GitHub Release、OIDC 发布 npm
- [ ] 抽查 `npm view dsh-agent-plugins-market dist-tags` 与 `@latest` 安装冒烟

### 5. 发布后

- [ ] 无需手动写 Release 正文（release-please 自动生成）；如需 Highlights，追加下方英文草稿
- [ ] 中文公告按需投放

---

## 二、发版内容草稿

### English

## dsh-agent-plugins-market 0.7.0

This release makes LSP self-contained and gives existing installs a one-click way onto it, then hardens the runtime boundaries that the previous release opened up.

### ✨ Highlights

- **LSP ships with the plugin.** `@deepseek-ai/dsh-lsp`, `dsh-lsp-stdio` and `dsh-tool-lsp` are installed with the plugin and mounted on demand — the first enabled language server mounts `ctx.lsp` and the `lsp` tool, the last one releases them. No profile step, and no `lsp` tool for a profile that never enables a server.
- **One-click upgrade off the old hand-added LSP layer.** Releases up to 0.6.2 told users to expose LSP from their profile. That layer now claims the same seam, so the LSP panel names the profile and the file and removes the rows for you, keeping a timestamped backup and verifying the rewrite before it lands.
- **Your own resources live in one place.** Hand-authored skills, commands and personas keep working from the shared `~/.agents/` root.
- **Background source refresh.** Sources can refresh on a schedule instead of only on demand.
- **Agent personas delegate through the host continuation seam**, so a role card runs as a durable background child with its saved provider, model and reasoning effort.

### 🛠 Fixes & hardening

- **One server identity per suite/server.** MCP, LSP, hooks, commands and the status panels are keyed by source-qualified suite id, so two sources shipping the same suite name mount independently and a diagnostic never lands on the wrong row.
- **Path containment by path relations, not text prefixes** — a sibling directory sharing a prefix is no longer treated as inside the root.
- **Bounded work.** Zip extraction bounds concurrent entry writes, and the change pipeline and request waits are bounded so a slow source cannot hold the page.
- **Declared wire types.** Mutation routes require the type they document instead of coercing, so `String({})` can no longer be stored as a source URL.
- **Manifest fallback.** An invalid higher-priority manifest falls through to the next one instead of failing the suite.
- Plugin state is written through the harness file utilities; the build clears `lib/` before emitting; plugin-authored decorators no longer leak into injected session text.

### 🔧 Refactors

- `Catalog` is split behind one declared port set; one mount lifecycle is shared across the MCP, LSP and hooks registries; `src/` gained an enforced layering with `check:architecture` covering 143 modules.
- The test suite runs under a type checker and on Windows CI.

### 📦 Upgrade notes

- **If your profile exposes LSP itself**, the plugin now reports a seam conflict there. Open the LSP panel and use the removal action; the profile's `cordis.patch.yml` is edited with a backup kept beside it. The plugin does not run pnpm, so stale profile dependencies stay until you remove them yourself — they register nothing once the rows are gone.
- Node ≥ 22 unchanged. No breaking API changes.

**Full changelog**: https://github.com/Sivan757/dsh-agent-plugins-market/compare/dsh-agent-plugins-market-v0.6.2...dsh-agent-plugins-market-v0.7.0

---

### 中文公告版

**dsh-agent-plugins-market 0.7.0 发布**

- **LSP 成为插件自带能力**：三个 LSP 包随插件安装，第一个语言服务器启用时才挂载 `ctx.lsp` 与 `lsp` 工具，最后一个移除时释放。不需要改 profile。
- **旧版手工 LSP 层一键清理**：0.6.2 及更早的说明要求你在 profile 里自己暴露 LSP；那层现在会抢占同一个接缝。LSP 面板会指出是哪个 profile、哪个文件，并代为移除，同时留一份带时间戳的备份。
- 自建资源统一在共享的 `~/.agents/` 根目录；来源支持后台刷新；代理角色走宿主续接机制委派。
- 修复与加固：套件身份按来源限定（两个来源的同名套件可共存）、路径包含改按路径关系判断、zip 解压与变更管线加界、路由要求声明的字段类型、无效清单回退到下一个。
- 升级注意：若 profile 里还留着 LSP 层，升级后会报接缝冲突——打开 LSP 面板点一次移除即可。插件不会运行 pnpm，因此 profile 里过期的依赖需要你自己删（行删掉后它们不注册任何东西）。Node ≥ 22 不变，无破坏性 API 变更。

---

## 三、版本判定

- 92 个提交中 `feat:` 7 个、`fix:` 19 个、其余为 docs/test/refactor/chore，无 `feat!` / `BREAKING CHANGE:` → **0.6.2 → 0.7.0（minor，自动）**。
- 无需 `Release-As` 页脚强制版本：本次提交分类与目标版本一致。
- 若希望把「profile LSP 层需要清理」当作破坏性变更宣传，可保持 0.7.0 并在 Upgrade notes 中强调；API 层面无破坏。
