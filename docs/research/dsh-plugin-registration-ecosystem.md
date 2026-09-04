# DeepSeek Harness 插件生态注册机制全景分析

- 日期：2026-08-25（只读调查，未修改任何被调查仓库）
- 调查范围：
  - 本项目：`dsh-agent-plugins-market`（插件市场 / 套件编排层）
  - DSH 宿主运行时：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/`（以实际打包 lib 为准）
  - 内容源仓库：`~/workspace/agent-plugins`（13 个 Claude Code 套件）
  - 同类第三方插件：`dsh-workbuddy-connect`、`dsh-workspace-manager`、`dsh-web-ui`（含 `packages/dsh-market`、`packages/dsh-plugin-manager`、`packages/dsh-community-plugins`）
- 证据约定：`文件路径:行号`；凡未在证据中确认的结论均标注「未找到」，不编造。

---

## 0. 结论速览：三层注册模型

| 层            | 角色                                                  | 注册入口                                                                           | 本生态代表         |
| ------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------ |
| L1 宿主插件层 | 一个 npm 包如何成为 DSH 插件（cordis bundle 标准）    | `package.json` 的 `dsh.bundle.patch` → `cordis.patch.yml` → insert 进 profile 层栈 | 全部第三方插件     |
| L2 套件内容层 | 一个 git 市场仓库如何变成可安装、可注入会话的能力集合 | `state.json` sources + 多方言 manifest 发现 + surface 扫描 + 运行时 reconcile      | **本项目独有**     |
| L3 内容源层   | 套件作者如何产出标准格式（零转换供 L2 消费）          | `src/<name>/plugin.config.ts` → 生成 `.claude-plugin/*`                            | agent-plugins 仓库 |

核心判断：**DSH 官方只定义了 L1**；L2 的「任意 git 市场仓库 → 运行时能力注入」目前由本项目唯一完整实现，这是推广叙事的技术地基。

---

## 1. L1 宿主层：一个包如何成为 DSH 插件

### 1.1 profile 与层栈合并

- Profile = `$DSH_HOME/profiles/<name>/package.json`（含 `dependencies` 与 `dsh.profile.bundles`）+ 该目录下的 profile patch 文件。见 `@deepseek-ai/dsh-app-boot/lib/index.js:284-306,335-338`。
- 合并顺序：**各 bundle 自带 patch（按 bundles 声明顺序）→ profile patch → home patch → `--patch`**。每次合并都作用于同一棵嵌套 entry-list。
- 层栈不是「插件实例数组」，而是嵌套的 Cordis Loader entry 列表：entry 形如 `{id, group?, name, config}`。`applyEntryPatches` 建立 id→entry 映射（`:57-85`）；patch 的 `insert` 无 id 时追加到根列表，有 id 时定位目标 group 并 `target.config.push(...insert)`（`:43-55`）。

### 1.2 激活与生命周期

- 宿主使用 `@deepseek-ai/cordis` + `cordis-plugin-loader`，经 `ctx.plugin(Loader)` 激活 entry（`dsh-app-boot/lib/index.js:7-8,1173`）。插件本体是导出 `name` + `inject?` + `apply(ctx, config)` 的 Cordis 插件，生命周期由 cordis fiber/effect 管理——不是简单的 npm import。
- `dsh plugin --profile <name> add <pkg>` 在 profile 目录跑 pnpm 后 reconcile（`lib/plugin-9h8shc4d.js:101-121`）；**只有 manifest 声明了 `dsh.bundle.patch` 的依赖才会进入 `dsh.profile.bundles` 成为 layer**（`:25-33,35-78,60-67`），普通依赖仅作依赖存在。
- 卸载/失去 `dsh.bundle.patch` 声明的包会在下次 boot 从 bundles 移除、不再挂载；MCP 等运行期资源靠 `ctx.effect` 清理回调回收（见 §4）。

### 1.3 Web 客户端注册（可选）

- 包声明 `"dsh.client": { platform: "web", ... }` 并导出 `./client` bundle；client 侧同样是 cordis 插件，通过 `inject(['slots','locale',...])` 注册 `settings.section`、shell slots 等扩展点（对比证据：`dsh-workbuddy-connect/src/client/index.tsx:19-57`、`dsh-workspace-manager/lib/client.js:570-636`）。

### 1.4 最小注册模板（新作者视角）

1. ESM `package.json`：主入口 + `"dsh.bundle.patch": "./cordis.patch.yml"`；`files` 含构建产物与 patch。
2. `cordis.patch.yml` 至少一条 `- insert: [{id, name}]`（config 可空）。
3. 主入口导出 `{ name, apply(ctx, config) }`，按需 `inject` 宿主服务；宿主依赖以 peer/dev 声明（至少 `@deepseek-ai/cordis`）。
4. 有 UI 再加 `./client` 导出与 `dsh.client` 字段。

> 推广含义：本项目的 `cordis.patch.yml`（insert `dsh-agent-plugins-market`）与 workbuddy/workspace-manager/dsh-market 完全同构——**它是按官方标准写的「标准公民」**，可作为社区模板示范。

---

## 2. L2 内容层：本项目的套件注册管线（8 阶段）

### 阶段 1 — 源注册

- 根目录约定：用户维度 `~/.dsh/agent-plugins`（或 `$DSH_HOME`），项目维度 `<project-git-root>/.dsh/agent-plugins`；源 checkout 在 `.sources/<sourceId>/`（`src/catalog/paths.ts`）。
- sources 由 cordis config 种子化并在每次 boot 补齐缺失 id，持久化于 `state.json.sources[]`（`src/catalog/source-catalog.ts`、`src/model/state.ts`）；`local: true` 源直接读工作树（含未提交变更）。

### 阶段 2 — 扫描发现

- `src/catalog/suite-scanner.ts` 递归 ≤4 层，识别 `plugins/`、`external_plugins/`、`skills/` 容器、根套件、平铺 `<name>/SKILL.md` 收集。

### 阶段 3 — manifest 身份判定（六方言 + 合成）

优先级：根 `plugin.json`(agent-plugins.org v1) > `.plugin/plugin.json` > `.claude-plugin/plugin.json` > `.cursor-plugin/plugin.json` > `.kimi-plugin/plugin.json` > `.codex-plugin/plugin.json`；无 manifest 但有 SKILL.md 则生成 synthetic skill-collection（`src/catalog/manifests.ts`）。一仓多方言并存时身份取最高优先级 manifest，surface 仍全目录扫描。

### 阶段 4 — 校验（fail-closed / lenient 分级）

- v1 `plugin.json`：内置 AJV schema（vendored `schemas/1.0.0/plugin.schema.json`）严格校验：`$schema` 必须精确 v1 URL、`name` 必填、禁止额外字段（`src/catalog/validate.ts`）。
- v1 `mcp.json`：必须 `$schema`+`mcpServers`；server 仅 stdio/streamable-http/sse 三种形态，额外字段拒绝；另有路径 containment（必须 `./` 开头、解析后不得逃逸 plugin root、symlink 逃逸拒绝）与 `${PLUGIN_ROOT}`/`${PLUGIN_DATA}` 语义校验。
- 非 v1 方言仅轻解析不 schema 校验；`.mcp.json` 宽容解析（server-map 简写、type 归一化、`${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_PLUGIN_DATA}`/`${NAME:-default}` 占位符）。

### 阶段 5 — surface 盘点

`src/catalog/surfaces.ts` 扫 skills/mcp/hooks/commands/agents/LSP 六类能力面。

### 阶段 6 — 安装状态机

- `Catalog.install` 写 `state.installed[<sourceId>/<suiteId>] = { enabled: true, lockCommit, installedAt, surface overrides }`（**安装即启用**），原子写（temp+rename）；uninstall 删条目、disable 仅翻 enabled（`src/application/catalog.ts`、`src/model/state.ts`）。
- 每次 install/uninstall/disable/set-surface 都 `notifyChanged` 触发运行时 reconcile。
- 项目 native（`.claude/`、`.agents/`）免安装直接启用，无 state 条目；同名技能 project 优先遮蔽 suite 技能。

### 阶段 7 — 运行时注入（四通道）

| 通道 | 实现 | 会话内表现 |
| --- | --- | --- |
| Skills | `ctx.skills.registerProvider`（`SuiteSkillProvider`，project rank 250 > user rank 450），剥 frontmatter、替换 `${CLAUDE_PLUGIN_ROOT}`、按名去重（`src/runtime/skills-provider.ts`） | `/` 菜单可见；经宿主 `dsh-tool-skill` 进入系统提示 catalog 与 user-message 注入 |
| MCP servers | reconciler 对 enabled 且 surface 未关的每个 server 动态 `import('@deepseek-ai/dsh-mcp-client')` 后 `ctx.plugin(mcpClient, config)` 挂载；串行防竞态、按 server 隔离错误（`src/runtime/mcp-mounts.ts`、`reconciler.ts`） | 工具名 `mcp__<suite>__<server>__<tool>`；`${ENV_NAME}` 凭据走 Host credentials 服务，缺凭据 → `needs-credentials` 阻断启动 |
| Hooks | `hooks/hooks.json`（或根 `hooks.json`）→ 动态挂 `@deepseek-ai/dsh-hooks-claude-code`，config `{configPath, pluginRoot}`（`src/runtime/hooks-mounts.ts`） | SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop/SubagentStart/SubagentStop 映射子集 |
| Commands/subagents | `commands/*.md` → `ctx.commands.register` 斜杠命令（执行时 `$ARGUMENTS` 替换转 agent.followup）；`agents/*.md` → `agent-<name>` skills（`src/runtime/commands-mounts.ts`） | 斜杠菜单 + 子代理 |

### 阶段 8 — Web 呈现与 API

- `./client` bundle 是纯市场 UI：fetch `/api/agent-plugins/*` 路由（GET overview/config/suite/skill/mcp-status/mcp-overrides/progress；POST sources/add·update·remove·refresh·install·uninstall·set-enabled·set-surface·set-mcp-override），same-origin POST、body ≤64KiB（`src/routes.ts`、`src/contracts/market.ts`）。UI 不参与运行时注入。
- 元数据层与运行层的边界：本包已在 `f0e9fdf` 移除冗余的 `agent_plugins` 上下文工具，模型侧能力完全由 skills catalog + MCP 工具自然暴露，套件库存只在 Web 市场页呈现。

---

## 3. L3 内容源层：agent-plugins 仓库

- 真源是 `src/<name>/plugin.config.ts`（必填 name/version/description/category，可选 build/surfaces/artifact 等，`scripts/plugin-config.ts:16-41`）；release 流水线生成 `plugins/<name>/.claude-plugin/plugin.json` 与根 `.claude-plugin/marketplace.json`（Claude schema，本地条目字段 `name/version/source:'./plugins/<name>'/description`，AGENTS.md:57-85）。
- 当前规模：13 个本地套件，合计 **16 个 skills、1 个 hook（dsh-agent-notes）、0 MCP / agents / commands**。
- 关键映射事实：marketplace 条目**不声明** mcp/skills 能力清单——本项目的目录扫描补齐能力面，因此源仓库无需为 DSH 改造任何格式（零转换成立）；两仓库间无同步脚本，git URL 即集成。

---

## 4. 同类第三方插件横向对比（L1 视角）

| 包 | patch insert id | 注入的宿主服务（host inject/apply） | client 扩展点 | 启停语义 |
| --- | --- | --- | --- | --- |
| dsh-workbuddy-connect | `llm-workbuddy` | `['llm']` provider adapter；可选 webServer 状态路由 | `settings.plugin.item` 卡片 | cordis dispose 随插件生命周期 |
| dsh-workspace-manager | `dsh-workspace-manager` | `webServer` API 路由、workspaceRegistry/sessions 等可选服务 | `shell.overlay`、`conversation.session.header.utilities`、`settings.section` | 同上 |
| @linxin666/dsh-client-ui-market（dsh-web-ui/packages/dsh-market） | `ui-market` | 无 host 逻辑（远端 manifest + 可选 `pluginManager` service bridge） | `settings.section`(dsh-web-ui-market)；资产安装走本机 `/api/market/install-*`，插件安装走 `pluginManager.install(spec)` 或降级复制命令 | 取决于 plugin-manager |
| packages/dsh-plugin-manager（同仓库） | — | 官方 RPC `/plugin-installer` list/install/update/uninstall/set-enabled + `/plugin-control`；HTTP fallback `/api/plugin-manager`，job 轮询 | 市场卡片 + 管理页 | **启用/禁用写入 profile patch 的 next-start 状态，不能立即停止已运行进程**（`src/host/routes.ts:194-231,285-367`） |
| **dsh-agent-plugins-market（本项目）** | `dsh-agent-plugins-market` | `ctx.skills` provider + MCP mounts + hooks bridge + commands 注册 | Web 内置市场页（settings.section，legacy shell 顶层回退） | **reconcile 实时 dispose：禁用/卸载即卸载 MCP 子进程与 hooks 桥，串行防竞态，有单测与真实 DSH 生命周期证据** |

差异化结论：

1. **能力面覆盖第一**：唯一同时注入 skills + MCP + hooks + commands/subagents 的方案（官方原语 `dsh-mcp-client`/`dsh-hooks-claude-code`/`dsh-tool-skill` 只提供单通道，本项目是其编排者）。
2. **生命周期语义第一**：同类管理器的启停多为 next-start；本项目做到实时进程回收（`ctx.effect` dispose + generation 同步，`dsh-mcp-client/lib/index.js:135-172,585-586,678-697`），且有 `docs/promotion/lifecycle-evidence.md` 截图证据链。
3. **安全模型**：安装期不执行第三方代码、execFile 无 shell、fail-closed schema、路径 containment、凭据 write-only 不落盘、同源 POST 上限。

---

## 5. 证据边界（诚实披露）

- `agent_plugins` 工具的字面量实现**未在已装 DSH 运行时 lib 中检索到**（grep 全 runtime 为 0）；它可能位于宿主注入层或更新版本组件中。可确认的相关事实只有：本包曾自带该工具并已于 `f0e9fdf` 移除；skills 的系统提示注入由 `dsh-tool-skill/lib/index.js:13-20,123-178,222-251` 提供。
- DSH 源码仓库未见「第三方插件开发教程」文档；官方推荐路径只能从 examples 与 bundle 标准反推（`examples/README.zh.md:5-29`、`packages/examples/README.zh.md`）。→ 这正是本项目文档站可以补位的机会点。
- dsh-workspace-manager README 所称 session context-menu 扩展在当前 `lib/client.js` 中未找到对应 slot 实现（仅 `shell.overlay` 等），引用其能力时需谨慎。
