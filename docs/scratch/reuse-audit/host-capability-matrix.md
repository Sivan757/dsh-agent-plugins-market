# 宿主能力包（0.1.7-rc.2）与本插件功能重叠矩阵

- 日期：2026-09-26
- 判定权威：npm 已发布 `@deepseek-ai/*@0.1.7-rc.2`（registry dist-tag `next` → 0.1.7-rc.2；逐包下载 tarball 并核验 `files`/`exports`，52 个候选包全部已发布）。
- 前瞻参考：宿主 checkout `/Users/sivan/workspace/deepseek-harness`（master@477b4f4205，rc.2 合并点，工作树仅 apps/desktop 等无关脏文件）。**checkout 中 packages/\*/lib 是 gitignore 的本地构建产物，一律不作为判定证据。**
- 宿主包全景：`packages/` 为两层结构（57 个组目录），共 **312 个包**，checkout 内统一标 0.1.7-rc.2。monorepo 版本号不等于发布状态，本矩阵引用的每个包都以 registry tarball 为证。

## 一、候选包发布状态核验（全部 ✅ 已发布 0.1.7-rc.2）

对与本插件功能面相关的 52 个包逐一 `registry.npmjs.org/<pkg>/-/<name>-0.1.7-rc.2.tgz` 下载并解包，`files` 均为 `lib/index.js + lib/types/**/*.d.ts`（ui-* 加 `lib/client.js`），无源码形态发布，与既有认知一致。

| 域 | 包（@deepseek-ai/） | 发布 |
| --- | --- | --- |
| mcp | dsh-mcp-client、dsh-mcp-resources | ✅ |
| 插件管理 | dsh-plugin-manager、dsh-host-plugin-inventory、dsh-client-ui-plugin-manager、dsh-client-ui-settings-plugins、dsh-client-ui-settings-plugin-inventory | ✅ |
| 目录选择 | dsh-host-directory-picker{,-auto,-browse,-native}、dsh-client-ui-directory-picker-{browse,native} | ✅ |
| jobs | dsh-jobs、dsh-jobs-local、dsh-tool-jobs、dsh-client-ui-jobs | ✅ |
| deliverables | dsh-tool-present、dsh-client-ui-deliverables、dsh-workspace-changes、dsh-office-to-pdf | ✅ |
| guard | dsh-repeat-tool-reminder、dsh-tool-call-timeout-policy | ✅ |
| preset | dsh-agent-preset、dsh-agent-preset-registry、dsh-persona、dsh-client-ui-agent-preset | ✅ |
| schedule | dsh-schedule、dsh-client-ui-schedule | ✅ |
| 注入面 | dsh-skill、dsh-skill-filesystem、dsh-skill-badge、dsh-commands、dsh-hook-protocol、dsh-hooks-claude-code、dsh-hooks-codex、dsh-subagent、dsh-agent-instructions | ✅ |
| credentials | dsh-credentials、dsh-credentials-local、dsh-authorization | ✅ |
| feedback/locale | dsh-message-feedback、dsh-command-feedback、dsh-client-ui-message-feedback、dsh-client-locale | ✅ |
| settings | dsh-settings、dsh-client-ui-settings、dsh-client-ui-slots | ✅ |
| observation | dsh-agent-tool-presentation、dsh-fs-observation-policy | ✅ |
| 其他 | dsh-home-paths、dsh-workspace | ✅ |

## 二、功能面逐项对照矩阵

判定取值：**已复用**（在用宿主能力）/ **确凿重复**（宿主已发布导出与本地实现等价）/ **部分重叠**（同目录/同职能但有真实差异，需决策）/ **有意自建**（宿主能力不覆盖，差异在案）/ **无对应**（宿主没有这个能力）/ **前瞻机会**（宿主有而我们没用上）。

### 1. MCP 挂载 + 桥接（我们 `src/runtime/mcp/` 共 ~2557 行）

**dsh-mcp-client rc.2 现状复核**（tarball `lib/index.js` 836 行 + 5 个 d.ts）：

- transport 仅两种：`stdio`（`StdioClientTransport`，env 经 `dsh-subprocess` 的 `scrubbedParentEnv()` 净化）与 `streamable-http`（`StreamableHTTPClientTransport`，仅静态 `headers`）。**无 SSE transport**（`SSEClientTransport` 0 命中），**无 OAuth**（oauth/authorize/pkce/token 0 命中）。
- 提供的积木：连接监督重连（`RECONNECT_DEFAULTS` 500ms/30s/10 次、稳定性窗口重置预算，`startConnection`）、工具命名契约（`publicToolName`，`mcp__<server>__<raw>` + 64 字符/非法字符替换 + 12 hex 身份哈希）、双阶段同步（`syncTools` fetch→swap）、工具适配（`createMcpToolDefinition`，rc.2 起从包根导出）、schema 准入（内部调 `dsh-tools` 的 `assertSupportedJsonSchema`）。
- **OAuth 结论：rc.2 未演进，我们 bridge/oauth.ts（493 行）的差异化理由仍然成立**（streamable-http + legacy SSE + 401 challenge 发现 + PKCE + 动态注册 + loopback 回调，宿主一样都没有）。
- ⚠️ checkout 残留误导项：`packages/mcp/mcp-client/lib/types/oauth.*` 存在，但 `git ls-files packages/mcp/mcp-client/lib` 为空（lib 未跟踪），`src/` 只有 connection/index/server-context/tools/transport 五个文件——那是某次本地实验构建的产物，**不构成前瞻证据**；前瞻观察点改为「未来 rc 是否在 src/ 出现 oauth.ts」。

**逐文件对照**：

| 我们的实现 | 规模 | 宿主对应（rc.2 已发布） | 判定 | 处置建议 | 证据 |
| --- | --- | --- | --- | --- | --- |
| bridge/json-schema-subset.ts | 214 行 | `@deepseek-ai/dsh-tools` 根导出 `assertSupportedJsonSchema` + `JsonSchemaError` + 类型 `JsonSchemaNode/ObjectJsonSchema/JsonSchemaType/JsonSchemaScalar`（`index.d.ts` 明确 re-export，安装的 rc.2 `lib/index.js` 含运行时实现） | **确凿重复** | **改 import，删本地移植**。文件头自述「harness json-schema.ts rc.2 的本地移植，宿主当时未从包根导出」——rc.2 已导出，移植前提消失。注意我们版本收窄到「outputSchema 准入」一个用途，替换时保留调用点语义（宿主函数同时校验 input/output，行为是超集） | 本仓库 node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts re-export 行；宿主 src/json-schema.ts L385 |
| bridge/connection.ts | 410 行 | dsh-mcp-client `connection`（语义同构：重连预算/稳定性窗口/dispose 语义） | 有意自建（随桥接整体） | 维持；重连默认值与宿主保持一致（现已一致），宿主改默认时跟随 | tarball connection.d.ts |
| bridge/transport.ts | 117 行 | dsh-mcp-client `transport`（stdio+streamable-http）+ 我们的 SSE 分支 | 有意自建 | 维持；env 净化已复用 `dsh-subprocess` `scrubbedParentEnv` | 两边 transport.d.ts |
| bridge/tools.ts + projection.ts | 557 行 | dsh-mcp-client `tools`（`publicToolName`/`syncTools`/`createMcpToolDefinition`） | 有意自建 | 维持；命名契约与宿主逐字对齐（注释已声明镜像关系）。`createMcpToolDefinition` 理论上可替代 projection+tools 一半，但它绑定宿主 client 的调用路径，adoption 会把 OAuth 桥绑进宿主包词汇——不做 | tarball tools.d.ts |
| bridge/oauth.ts + mcp-auth-record.ts + mcp-credentials.ts | 577 行 | 无（宿主 0 OAuth） | 有意自建 | 维持；deleteMcpAuthGrant 走宿主 `ctx.credentials` 记录键（已复用 credentials seam） | tarball 全文 grep |
| mcp-mounts.ts | 344 行 | 宿主无「套件 mcp.json → 桥接实例」调停层（dsh-mcp-client 是每服务器一条 cordis.yml 行的手工配置形态） | 有意自建 | 维持 | dsh-mcp-client README |
| （未实现）MCP resources | — | **dsh-mcp-resources**：`McpResourceRuntime.register(server, provider)` + 共享 3 只资源工具（list/read/templates，rc.2 已发布） | **前瞻机会** | 我们 bridge 对 `resources/list | read` 0 处理；即使自研桥接，也可在连接建立后把 provider 注册进宿主共享运行时，免费获得模型可见资源工具。记 backlog，不阻塞 | mcp-resources lib/types/index.d.ts；bridge 全文 grep 0 命中 |

### 2. Web 市场页 / 设置卡片 vs 宿主插件管理面

| 我们的实现 | 宿主对应（rc.2 已发布） | 判定 | 说明与建议 |
| --- | --- | --- | --- |
| market 页（features/market/*，套件目录/就地安装/详情） | `dsh-client-ui-plugin-manager`（侧栏 Plugins 页：**profile bundle** 的 pnpm 安装/启停/行级 patch 写入） | 无对应（职能不同） | 宿主管「装进 profile 的 npm bundle」，我们管「git/archive/local 套件的零转换就地安装」——对象、生命周期、存储都不同。名字相近是最大误报源 |
| MCP/LSP/市场卡片（settings-card/*） | `plugins.item`（summary/page 双视图）+ `plugins.bundle.config`/`plugins.row.config` 槽位；设置服务 `configForms.get`+`whileServed` | 已复用 | client/index.ts 走 `slots.register({ name: 'plugins.item' })`，宿主 README 亦把官方插件卡片指向此槽 |
| market 页座位（settings.section 注入） | `dsh-client-ui-settings-plugins`（`settings.plugins.tab` 列表槽）+ `dsh-client-ui-settings-plugin-inventory`（只读清单 tab） | 已复用/无冲突 | 我们注册 `settings.section` 顶级段；宿主 inventory 是只读 Loader 清单，功能不交叉 |
| 安装注册表探测/镜像（application/regions.ts 下载区域） | `dsh-plugin-manager/registry` 导出 `OFFICIAL_NPM_REGISTRY`/`NPMMIRROR_REGISTRY` + 双 registry 探测 | 无对应（对象不同） | 它选 pnpm registry，我们选 GitHub 下载路由（gh-proxy 前缀）。不构成重复 |
| 面板文档存储（user-panels.ts，文件后端） | 宿主无对应；`dsh-storage*` 是另一族（ADR 2026-09-13 已定不迁） | 有意自建 | 维持 |

### 3. 目录选择（ui-directory-picker-*）

| 我们的实现 | 宿主对应 | 判定 | 建议 |
| --- | --- | --- | --- |
| SourceEditorModal 本地源路径 = **纯文本 input**（src/client/features/market/SourceEditorModal.tsx，120 行，无任何 chooser/browse 代码） | `dsh-host-directory-picker`（native/browse 双后端 + auto 装配）+ `dsh-client-ui-directory-picker-{native,browse}`（填 `ui-workspace` 声明的两个 directory-flow 槽） | **无重复**（我们根本没自建目录选择器）；**前瞻机会** | local 源路径接宿主 picker 可改善体验，但槽位归属 `ui-workspace` 工作区流程，是否适用于 modal 内字段需单独验证 → 弱 backlog |

### 4. jobs / deliverables / document / guard / preset / schedule

| 宿主包（rc.2 ✅） | 职能（README Summary 已核） | 与本插件关系 | 判定 |
| --- | --- | --- | --- |
| dsh-jobs / jobs-local / tool-jobs / ui-jobs | agent 会话作用域后台作业（`<kind>-N` id、job_output/wait/kill、完成唤醒） | 我们 reconcile/snapshot 缓存是插件内部状态，无模型可见作业面 | 有意自建（既有 ADR/账目在案；`ctx.jobs` 语义不同） |
| dsh-tool-present / ui-deliverables / workspace-changes / office-to-pdf | 文件呈报卡、逐轮变更卡、Office 转 PDF | 本插件无对应物 | 无对应 |
| dsh-repeat-tool-reminder / tool-call-timeout-policy | 重复调用提醒、协作超时 | 部署层 guard，本插件不涉及 | 无对应 |
| dsh-agent-preset(-registry) / persona / ui-agent-preset | 预设组合、persona 前后缀 | 我们不产预设 | 无对应 |
| dsh-schedule / ui-schedule | 跨会话墙钟提醒（cron/每日…，重启恢复） | 我们定时器 = 进程内 reconcile 节拍（timer-seat，复用 ctx.interval/timeout） | 有意自建（语义不同，既有判定维持） |

### 5. skills / commands / hooks / agents 注入面

| 我们的实现 | 规模 | 宿主对应（rc.2 ✅） | 判定 | 说明与建议 |
| --- | --- | --- | --- | --- |
| hooks-mounts.ts（每套件 hooks.json → 桥实例） | 153 行 | `dsh-hooks-claude-code` / `dsh-hooks-codex` + `dsh-hook-protocol` | **已复用** | 桥本身是宿主包，我们只做套件级调停（临时目录改写 CLAUDE_PLUGIN_ROOT、指纹去重、对账）。典范案例 |
| user-commands.ts（用户命令 → slash 命令，body+$ARGUMENTS 变跟进消息） | 131 行 | `dsh-commands`：/command 面板执行，README 明言「**不**把命令或结果变成模型消息」 | 无对应（语义不同） | 我们的命令是 quick-reply 型（产生模型回合），宿主命令是 UI 直执型。误报风险点，别据此翻案 |
| agent-role-router.ts + subagent-catalog.ts + agent-role-names.ts | 747 行 | `dsh-subagent`（执行）+ `dsh-tool-subagent`（工具壳） | 已复用（执行层） | 我们做「套件 agent 卡 → subagent_role 工具 + durable catalog」的路由与目录发布，执行交给宿主 subagent 服务；catalog 发布遵循宿主 tool-skill pre-step 模式。风险：宿主 discovery name 编码（[source,suite,kind,id]）属契约镜像，演进时需跟随 |
| UserPanelSkillProvider（用户技能面板 → ctx.skills，扫 `~/.agents/skills` 扁平 md + SKILL.md frontmatter） | user-panels.ts 内 | `dsh-skill-filesystem`：默认 root 表 **rank 500 = `<agentsHome>/skills`（`$DSH_AGENTS_HOME` 或 `~/.agents`）**，同样收扁平 `<name>.md` + `<name>/SKILL.md`、同一 frontmatter 词汇（name/description/whenToUse）+ watch 内建 | **部分重叠** | 同一目录双扫描。差异：我们的面板开关是 `disabled: true`（Claude Code 词汇），宿主键为 `disable-model-invocation`/`user-invocable`；我们提供 Web 编辑面板与逐条诊断，宿主只读+warning 跳过；宿主 registry 按 name 确定性去重，双 provider 不致重复条目但胜负取决于 registry 规则。**建议评估**（需 ADR）：无宿主 provider 的部署保留自扫；或扫描让位宿主、面板降级为编辑器+开关映射 |
| LSP 自供（lsp-mounts.ts + dsh-lsp/-stdio/tool-lsp 依赖） | 22697b | 宿主同名三件套（rc.2 ✅ 已发布） | 已复用（作为 dependencies 自供） | 既有决策：自带版本防漂移，seam 冲突 fail-loud |
| project-runtime.ts（套件 instructions → 动态上下文） | 8486b | `dsh-agent-instructions`（AGENTS.md 链） | 无对应 | 我们注入的是套件级 instructions，宿主管 AGENTS.md 链，词汇不同源 |

### 6. credentials / feedback / locale / tool observation / settings

| 我们的实现 | 宿主对应（rc.2 ✅） | 判定 | 说明 |
| --- | --- | --- | --- |
| host-seams.ts re-export `dsh-credentials`；mcp-credentials 走 `ctx.credentials` | `dsh-credentials`（记录/键名间接）+ `dsh-credentials-local`（部署侧实现） | **已复用** | 无自建凭证存储 |
| feedback-tool.ts（report_market_issue：gh CLI → GitHub REST → 文本兜底） | `dsh-message-feedback`/`dsh-command-feedback`（会话消息/会话反馈，固定 taxonomy） | 无对应 | 对象不同：插件市场体验反馈 vs 会话反馈；宿主无 GitHub issue 通道 |
| host-locale.ts（读宿主 `locale.preference` 设置）+ client `ctx.locale.register` | `dsh-client-locale`（切换器与字典注册） | **已复用** | 宿主设置读取 + 字典注册都在宿主面上 |
| tool-registry-observer.ts（`ctx.tools.schemas()`） | `dsh-tools` ToolRuntime | **已复用** | `dsh-agent-tool-presentation` 是 preset 级展示控制，无交集 |
| settings-namespace.ts（五开关走宿主 settings 服务） | `dsh-settings` + `dsh-client-ui-settings` | **已复用** | 卡片槽 `plugins.item`、`configForms.get`+`whileServed` 均宿主契约 |
| catalog/paths.ts（`resolveDshHome`/`expandHomePath` 复用 `dsh-home-paths`；`$DSH_AGENTS_HOME` 手工读取） | `dsh-home-paths`（无 agentsHome helper，导出仅 DSH 族） | **已复用** | `$DSH_AGENTS_HOME` 约定与宿主 skill-filesystem 同源，词汇一致 |

### 7. catalog 扫描 / 就地安装

| 我们的实现 | 宿主对应 | 判定 |
| --- | --- | --- |
| 套件源扫描（manifest/dialect/fs probes）、git/archive/local 就地安装、reconcile | `dsh-plugin-manager`（pnpm bundle 安装/启停，profile patch 写入）；`dsh-host-plugin-inventory`（只读 Loader 快照 Remote）；`dsh-plugin-package-inventory-deepseek`（LLM 请求诊断字段，checkout 有、发布形态经 README 核对） | **有意自建**——宿主三件都不扫 git 套件目录、不做零转换安装；inventory 是快照不是市场数据源 |

## 三、确凿重复 TOP 列表

1. **`src/runtime/mcp/bridge/json-schema-subset.ts`（214 行）↔ `@deepseek-ai/dsh-tools@0.1.7-rc.2` 根导出 `assertSupportedJsonSchema`**。宿主 rc.2 起（本插件基线内）已从包根 re-export 该函数与全部配套类型，且宿主自己的 dsh-mcp-client 就在调用它；我们文件头声明的移植前提（宿主未导出）已消失。处置：改 import + 删本地移植，属小改动；替换时确认「仅用于 outputSchema 准入」的调用点在宿主更严格的全量校验下行为不变（宿主是超集，预期兼容）。
2. **（半确凿，需决策）用户技能扫描 ↔ `dsh-skill-filesystem` 的 `~/.agents/skills` 内建 root**。同一目录、同一 frontmatter 词汇、宿主还内建 watch；我们剩下的真实增量 = Web 面板编辑、`disabled` 开关、逐条诊断。处置：出 ADR 二选一（保留自扫的理由 = 不依赖部署是否挂宿主 provider；让位宿主的收益 = 少一份扫描/词汇漂移面），并把开关键映射问题（`disabled` vs `disable-model-invocation`）写清。

除此之外，MCP 桥接整体（OAuth/SSE 差异化）经 rc.2 复核**仍然成立**，不列入重复。

## 四、误报风险说明

- **checkout `lib/` 残留不是证据**：`packages/mcp/mcp-client/lib/types/oauth.*` 只存在于本地构建产物（git 未跟踪，src/ 无对应文件），不能据此认定宿主已发布或将发布 OAuth。
- **monorepo 版本 ≠ 发布**：312 个包 checkout 全标 0.1.7-rc.2，但判定只认 registry tarball 的 files/exports；本矩阵引用的 52 包已逐一核验，未核验包（如 acp、terminal、workflow 族）一律未下结论。
- **名字相近 ≠ 职能相同**：ui-plugin-manager 的「Plugins 页」是 profile bundle 管理，不是套件市场；dsh-commands 明确不产生模型消息，与用户命令（quick-reply 型）互补而非重复；dsh-jobs/dsh-schedule 与我们的 reconcile 缓存/timer-seat 是既有判定（ADR 在案），不要用名字重开翻案。
- **「宿主已有」须区分层**：dsh-skill-filesystem 需要部署真的挂了 provider 才生效（标准 dsh profile 挂，极简 profile 不保证）——这是技能扫描项列为「需决策」而非直接「确凿重复」的原因。

## 五、前瞻机会（宿主已有、我们未用，均非重复）

1. **dsh-mcp-resources**：把自研桥接的连接作为 `McpResourceProvider` 注册进宿主共享运行时，模型免费获得 resources list/read/templates 三只工具；我们 bridge 目前对 resources 0 处理。
2. **ui-directory-picker-***：local 源路径字段可评估接入宿主 picker（槽位归 ui-workspace 流程，适用性待验证）。
3. **观察点**：宿主 mcp-client 后续 rc 若在 src/ 出现 oauth.ts/sse transport，触发 `mcpEnhanced`（兼容模式默认值）复审。
