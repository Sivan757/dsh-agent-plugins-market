# PR 待审核稿 · dsh-web (原 dsh-web-ui) 社区插件索引登记

- 仓库：https://github.com/zhu1090093659/dsh-web （仓库已由 dsh-web-ui 改名为 dsh-web，产品名同步改为 dsh-web）
- 分支：`register-agent-plugins-market`（基于 `origin/dev` `76e92e5`）
- Base：**dev**（该仓库要求一律以 dev 为 base，不以 main 为 base）
- Commit：`chore(community-plugins): register dsh-agent-plugins-market in the community plugin index`
- 改动文件（共 +23 行，与已合并先例 #1055 同构）：
  - `packages/dsh-community-plugins/community.json`（+11，追加第 38 条）
  - `market/dist/manifest/plugins.json`（+12，market-build 派生生成物）
- 本地门禁全绿：`node scripts/community-index --check` → OK (38 entries)；`pnpm market:build` → wrote 1009 files (38 plugins)；`pnpm market:check` → dist up to date (233 files)。

---

## PR 标题

```
chore(community-plugins): register dsh-agent-plugins-market in the community plugin index
```

## PR 描述（全文，直接粘贴到 PR body）

````markdown
# 社区插件索引登记：dsh-agent-plugins-market

在社区插件索引中加入 `dsh-agent-plugins-market`（Sivan757/dsh-agent-plugins-market），使其出现在 dsh-market.com 创意工坊插件目录与应用内「创意工坊 → 插件」。

## 变更内容

- `packages/dsh-community-plugins/community.json` 新增一条记录（`id` / `name` / `nameEn` / `author` / `repo` / `description` / `descriptionEn` / `npm` / `category`）；
- `node scripts/market-build` 重新生成 `market/dist/manifest/plugins.json`（37 → 38 entries）。

插件信息：仓库 https://github.com/Sivan757/dsh-agent-plugins-market（MIT）；npm `dsh-agent-plugins-market`（0.5.0）；分类 tools。插件把 Claude Code 插件市场生态接入 DSH：任意 Claude Code / Codex / Cursor / Kimi 市场 git 仓库加为源即可一键安装 suite，skills、MCP 服务器、hooks 与斜杠命令在运行时注入会话；Web GUI 内置市场页面。实现遵循官方 cordis bundle 标准，与 dsh-web 插件体系互补、互不冲突。

## 涉及包（Affected Packages）

- [x] 其他（请说明）：`packages/dsh-community-plugins`（数据登记，无代码逻辑变更）

## PR 类别（PR Category）

- [x] 社区插件索引

## PR 类型（PR Type）

- [x] 其他（社区插件索引数据登记，非代码逻辑变更）

## 最新代码确认（Latest Codebase Confirmation）

- [x] 我已基于最新 `dev` 分支开发，或在提交前已 rebase / 合并最新 `dev`。

同步命令：`git fetch origin && git rebase origin/dev`（本分支基于 upstream/dev `76e92e5` 建立）

## 测试证据与上游同步（Test Evidence & Upstream Sync）

- [x] 我提供了自己本地测试的证据（执行的命令 / 测试结果 / 运行截图）。

- `node scripts/community-index` → OK (38 entries)
- `node scripts/community-index --check` → 通过
- `pnpm market:build`（`node scripts/market-build`）→ wrote 1009 files (19 skins, 2 pets, 38 plugins)
- `pnpm market:check` → tryon/ verified against hash manifest (756 files)；dist up to date (233 files)

- [x] 我已同步上游最新 `dev` 分支（`git fetch origin && git rebase origin/dev`），并附上同步后重新测试通过的证据（视觉 / 用户可见变更附截图）。

本分支基于 upstream/dev `76e92e5` 建立，上述验证均在该基础之上执行；文本 / 数据类改动，不附截图。

## 视觉修复要求（Visual Fix Requirements）

纯文本 / 数据类改动，跳过本节。

## AI 编码披露（AI Coding Disclosure）

- [x] 完全 AI 编码：全部编程改动由 AI 产出，并由贡献者接受 / 审查。

使用的 AI 模型：多款 AI 编码模型

使用的编码 Agent 工具：多款 AI 编码 Agent 工具

## 仓库规范检查（Repo Rules）

- [x] 未修改 DSH 官方源码，仅基于官方 NPM SDK（`@deepseek-ai/*`）开发。（被登记插件即按此标准实现；本 PR 对本仓库仅改数据文件与派生清单）
- [x] 未新增指向 DSH 源码 checkout 的 tsconfig `extends` / `paths` / `references`。（本 PR 未触碰任何 tsconfig）
- [x] 新增包目录以 `dsh-` 前缀命名。（不适用：本 PR 未新增包目录）
- [x] 所有新增 / 修改文件不含任何 emoji 字符。
- [ ] 改动包 README 时同步维护中英双语三件套并运行 `pnpm docs:check`。（不适用：本 PR 未改任何 README）

## 贡献者版权声明（Contributor Copyright）

不适用：社区插件索引只收录链接与元数据，不搬运代码。

## 社区插件索引登记（Community Plugin Index）

插件 GitHub 仓库链接：https://github.com/Sivan757/dsh-agent-plugins-market

插件详细说明：

- **功能与用途**：DSH bundle 标准插件。用户在 Web GUI「设置 → Agent Plugins Market」把任意市场 git 仓库配置为源后，可浏览并一键安装 / 卸载 / 启停 suite；安装的 skills 注入 `ctx.skills` 并进入 `/` 菜单，套件内 `mcp.json` 的 MCP 服务器挂载为 `dsh-mcp-client` 子进程，hooks 经官方 `@deepseek-ai/dsh-hooks-claude-code` 桥接，斜杠命令与子代理自动注册。支持 Claude Code（`.claude-plugin`）、Codex、Cursor、Kimi、universal（`.plugin`）、agent-plugins.org v1 共六种清单方言及无清单技能集合；`${CLAUDE_PLUGIN_ROOT}` 自动替换，Claude Code 技能原样可用。
- **依赖**：必需 `ctx.skills`（dsh-skill）；可选 peer `@deepseek-ai/dsh-mcp-client` 与 `@deepseek-ai/dsh-hooks-claude-code`，缺失时优雅降级。Node >= 22。
- **已知限制**：项目维度不挂载 MCP（DSH 无会话级工具作用域）；技能发现无文件监听，变更经管理操作或重启后生效；Claude Code hooks 仅支持桥接映射子集；LSP 仅计数预览不执行。
- **兼容性验证**：仅基于官方 `@deepseek-ai/*` NPM SDK 开发，未修改 DSH 源码；已在本地 dsh web 上实际挂载运行——市场设置页可用，多个市场源的技能与 MCP 注入正常生效。

- [x] 已按 [docs/plugins.md](../docs/plugins.md) 的登记说明在 `packages/dsh-community-plugins/community.json` 追加条目，并运行 `node scripts/community-index` 校验；同时按登记说明第 3 步用 `node scripts/market-build` 重新生成 `market/dist/manifest/plugins.json` 并一并提交（当前 dev 的脚本不产出 `src/client/generated/community.ts`，派生生成物以 `market/dist` 为准，与 docs/plugins.md 一致）。
- [x] 已确认插件与 dsh-web 插件体系兼容：遵循官方 cordis bundle 独立标准（package.json 声明 `dsh.bundle.patch` 指向 `cordis.patch.yml`、`dsh.client` 浏览器半区），类型仅基于官方 `@deepseek-ai/*` NPM SDK，未修改 DSH 源码；已在本仓库最新代码所运行的 dsh web 上验证插件可被正常挂载运行。
- [x] 承诺负责后续更新跟进：插件与 DSH / dsh-web 生态保持同步，生态升级导致不兼容时主动跟进修复；条目信息（description / npm 等）变动或插件停更时，及时更新索引登记或提交移除。

## 本地验证（Local Validation）

执行的命令：

```bash
node scripts/community-index
node scripts/community-index --check
pnpm market:build
pnpm market:check
```

结果摘要：community.json 由 37 条增至 38 条；`community-index --check` 通过（38 entries）；`market-build` 重新生成 `market/dist/manifest/plugins.json`（确定性构建，其余 1000+ 文件零漂移）；`market:check` 通过（dist up to date, 233 files）。全部通过，无失败项。

## 用户可见变更证据（Local Feature Evidence）

纯索引数据登记，无面向用户的代码行为变更：N/A（条目合并后将出现在创意工坊插件目录与应用内「创意工坊 → 插件」）。
````

---

## 给审核人的备注（不进 PR）

1. **改名影响**：仓库/产品已改名 dsh-web，但收录机制、community.json 字段、market-build 流程不变；PR 措辞已用新名。
2. **模板陈旧点**：PR 模板勾选项提到生成 `src/client/generated/community.ts`，当前 dev 已无此产物；实际流程以 docs/plugins.md 与先例 #1055 为准（提交 market/dist/manifest/plugins.json）。描述里已如实注明，避免维护者困惑。
3. **已确认的作者决定**：中文名逐字确认；AI 披露勾「完全 AI 编码」，模型 / Agent 工具字段按模板硬性要求（不得留空）填通用表述，不列具体型号；维护承诺已确认。
4. 提交动作（经你批准后执行）：`gh repo fork` → push 分支到 fork → `gh pr create --repo zhu1090093659/dsh-web --base dev --head Sivan757:register-agent-plugins-market`。
