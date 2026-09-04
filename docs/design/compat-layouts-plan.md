# 兼容布局扩展设计：把市场基础能力开放给 Claude Code / Codex 等原生布局（带开关）

状态：已评审定稿（2026-09-02 决策记录见 §8）　日期：2026-09-02　基线：dev 工作树（0.5.x）依据：[2026-09-02-agent-config-compat-ecosystem.md](../research/2026-09-02-agent-config-compat-ecosystem.md)（GitHub 生态与各 CLI 布局事实，逐条带来源）

---

## 0. 结论速览

1. **本需求的实质是把 `native-project.ts` 泛化**：项目级 `.claude/`、`.agents/`（skills/agents/commands）原位只读注入已实现；缺口是 ①全局维度（`~/.claude`、`~/.codex` 等）、②MCP 面（项目 `.mcp.json`、全局 mcpServers）、③hooks 面、④开关化（当前原生发现无任何用户开关）、⑤更多 CLI（codex 项目目录、kimi、cursor、zcode、qoder）。
2. **全部缺口都能接在现有缝上，不需要新管线**：方言识别（`MANIFEST_PATHS`）、扫描链（`ScanFilter`）、合成套件（`native-project.ts`）、MCP 归一与挂载（`validate.ts` → `mcp-mounts.ts`）、hooks 桥（`dsh-hooks-claude-code`）、开关（settings 命名空间，先例 `mcpEnhanced`）。
3. **生态调研支持零转换路线，反对转换器路线**：SKILL.md（agentskills.io）已成为最大公约数（Claude/Codex/Kimi/crush/opencode/Gemini 均采用），Kimi CLI 甚至官方原生合并读取 `~/.claude/skills/` 与 `~/.codex/skills/`——证明「原位跨工具读取」是真实产品需求且可行。而 acplugin、cc2codex 等全量迁移器全部公开承认转换损耗；本项目定位是注入 harness，做转换器既越界又丢掉「零转换、零复制」差异化。
4. **开关模型从「布局 × 面」矩阵简化为单主开关**（2026-09-02 评审定稿）：`compat.enabled` 一个开关控制全部第三方布局兼容，hooks 因是代码执行保留独立开关（默认关）；细粒度控制不新建设置——原生布局落地为合成套件后，每个套件天然携带既有 per-suite 启用开关。界面上以**只读兼容性表格**替代逐布局开关（§4）。
5. **zcode / qoder 必须完成**（2026-09-02 评审决策），但证据薄弱（zcode 仅社区来源、Qoder MCP 布局未知），实施前置一个证据钉定 spike（方案 F）。

---

## 1. 现状基线（能力矩阵）

已有：六方言市场源识别（`agent-plugin-v1 / universal / claude-code / codex / cursor / kimi`，`src/catalog/manifests.ts:35-42`）＋合成方言（`skill-collection / remote / project-native`）；六个运行时面（`skills / mcp / hooks / commands / agents / lsp`，`src/model/types.ts:182`）；市场源内 `.mcp.json`/`.claude-plugin/` 的 MCP 已宽容接受 Codex 形态（`validate.ts:149-151`）；hooks 桥已映射 CC 事件模型（`hooks-mounts.ts`）；唯一用户开关 `dsh-agent-plugins-market.mcpEnhanced`（`runtime/mcp-backend.ts:28-34`）。

| 原生来源                                | skills                                                        | commands | agents | MCP | hooks | 指令文件 |
| --------------------------------------- | ------------------------------------------------------------- | -------- | ------ | --- | ----- | -------- |
| 项目 `.claude/`                         | ✅ project-native                                             | ✅       | ✅     | ❌  | ❌    | ❌       |
| 项目 `.codex/`、`.agents/skills/`       | ❌（`.agents` 仅 skills/agents/commands 且无 codex 独有目录） | ❌       | ❌     | ❌  | ❌    | ❌       |
| 全局 `~/.claude/`、`~/.claude.json`     | ❌                                                            | ❌       | ❌     | ❌  | ❌    | ❌       |
| 全局 `~/.codex/`（config.toml、skills） | ❌                                                            | ❌       | ❌     | ❌  | ❌    | ❌       |
| 全局/项目 `~/.cursor/`、`.cursor/`      | ❌                                                            | 未验证   | ❌     | ❌  | ❌    | ❌       |
| 全局 `~/.kimi/`                         | ❌                                                            | ❌       | ❌     | ❌  | ❌    | ❌       |
| zcode / qoder                           | ❌（布局证据薄弱）                                            | ❌       | ❌     | ❌  | ❌    | ❌       |

注：`.mcp.json` 当前只在**套件内部**被读取（`surfaces.ts:132-152`），项目根与全局的 MCP 配置不读。指令文件（CLAUDE.md/AGENTS.md）列在矩阵中但明确不在本插件职责内（§3-G）。

---

## 2. 生态对标要点（详证见调研文档）

- **三层生态**：①provider 切换器（cc-switch ~130k★）②单源分发器（vercel-labs/skills ~30k★，把同一 SKILL.md 落进 ~78 个工具目录，其路径表是本方案布局事实的交叉验证源）③全量迁移器（acplugin、cc2codex、swik、a16n…）——第三层全部承认非盲翻译。
- **对本项目的启示**：①不做迁移器，做「原位多源读取」——与 Kimi 官方做法同构，且比它多出 MCP/hooks/commands 面与 UI 开关；②vercel-labs/skills 证明了「通用目录」`.agents/skills/`（项目级与 `~/.agents/skills/`）已被约 75 个工具采纳，方案 A/B 以它为一等公民；③迁移器们的损耗报告清单直接转化为本方案的「降级表」（方案 D）。
- **五条决定设计的语义差异**：①SKILL.md 趋同（skills 零转换可行，但 Codex 初始技能列表有 2% 上下文/8000 字符上限）；②hooks 最方言化（事件集 28+/10/13 不同、JSON vs TOML、Codex 项目 hooks 有信任门）→ 必须适配 + 降级，不能零转换；③MCP 同名异形（`mcpServers` JSON vs `mcp_servers` TOML、字段与 scope 模型不同）→ 归一层已有底子（`validate.ts` Codex 容差）；④指令文件合并语义互斥（CLAUDE.md 全载 / AGENTS.md 根向下拼接 32KiB 上限 / Cursor `.mdc` 门控）；⑤commands/agents 无公约数（Codex prompts 已废弃转 skills；agent 定义格式不兼容）。

---

## 3. 方案清单

按依赖顺序列出；A 是其余方案的地基。每项标注：开关 / 接缝 / 量级 / 风险。

### 方案 A：原生布局兼容框架（Native Layout Provider 注册表）——地基

- **内容**：把 `native-project.ts:22-25` 硬编码的 `NATIVE_PROJECT_DIRS` 泛化为数据驱动的注册表。每个布局声明：目录名（项目级）、全局根（用户级）、各 surface 子目录映射、方言标签、默认开关。Claude Code（`.claude` + `~/.claude`）、agents 通用（`.agents` + `~/.agents/skills`）、Codex（`.codex` + `~/.codex/skills`）、Cursor（`.cursor/rules` 之外的 skills 面）、Kimi（`~/.kimi`）逐个填入。
- **接缝**：`src/catalog/native-project.ts` 重构为注册表 + 发现器；新增 `SuiteLayoutKind` 成员或复用 `project-native` 合成方言＋`manifest.label` 细分（推荐后者，wire 契约零破坏）；每个携带内容的目录仍是只读合成套件，走既有安装/启用/面开关链。
- **开关**：随 `compat.enabled` 主开关（§4）；无 per-layout 设置——用户对单个布局的启停通过该布局套件的既有启用开关完成。
- **量级**：小-中。**风险**：低——纯只读发现，沿用 fail-closed 与 `scanNotes` 诊断；永不写用户目录（延续 native 承诺，注释与文档明示）。

### 方案 B：全局维度兼容源（`~/.claude`、`~/.codex`、`~/.kimi`、`~/.agents` skills/commands/agents）

- **内容**：用户维度发现 `~/.claude/{skills,commands,agents}`、`~/.codex/skills`、`~/.kimi/{skills,commands}`、`~/.agents/skills`（后者已事实上是跨工具通用目录），各为一个用户维度合成套件（native 模式：不可安装/卸载，仅启用开关）。
- **优先级/去重**：沿用 `skills-provider.ts:25-26` 的 rank 体系（数值越小越优先）：建议 `~/.dsh/skills` 400 之上插入——`~/.claude` 410、`~/.codex` 420、`~/.agents` 430（对齐 Kimi 的「自家 > claude > codex > 通用」先例）；同名去重 project-first 规则不变。项目维度 rank 250 已天然让位于项目 `.dsh/skills` 100 / `.agents/skills` 200，无需改动。
- **开关**：随 `compat.enabled` 主开关（默认开，只读面）；单布局粒度走套件自身的启用开关。「全局兼容源汇总」由兼容性表格展示各目录发现计数。
- **量级**：中。**风险**：中——①性能：全局目录扫描加 TTL 缓存（沿用 30s 扫描缓存）；②数量：用户 `~/.claude/skills` 可能几十个，UI 需分组；③`~/.claude.json` 这类含敏感信息的文件**绝不读**（调研红线：secrets/sessions/accounts 永不迁移），只读列目录。

### 方案 C：MCP 兼容注入

- **内容**：读取并归一四类原生 MCP 配置：项目根 `.mcp.json`（Claude 约定，社区广泛采用）、`~/.claude.json` 的 `mcpServers`、`~/.codex/config.toml` 的 `[mcp_servers.*]`、`~/.cursor/mcp.json`。归一到内部 `McpServer` 后走**现有** mount 管线（`validate.ts` 容差已接受 Codex `type:'local'`/`http`；stdio/HTTP/OAuth 桥已齐）。
- **TOML 依赖决策**：新增 `smol-toml`（纯 JS、零依赖、体积小），2026-09-02 评审已接受，PR 正文仍需论证；备选是手写最小 `[mcp_servers]` 表解析（不推荐：schema 演进会失真）。
- **冲突治理**：与市场安装的 MCP 同名 server 冲突时**原生布局让位**（市场套件是用户显式安装意图），冲突进 `RuntimeDiagnostics`/状态面板；`mcp__<server>__<tool>` 命名空间冲突由现有 foreign-namespace guard（`mcp-mounts.ts:231-237`）兜底。
- **开关**：随 `compat.enabled` 主开关，**默认开**（2026-09-02 评审决策；注入工具属用户已拥有的能力面，可主动关闭）＋兼容性表格中的来源标注（claude-native / codex-native / cursor-native / market）；同名冲突让位规则见上。
- **量级**：中。**风险**：中——环境变量/凭据引用形态差异（`${VAR}` 展开已有 `validate.ts:192-198`）；`~/.claude.json` 只允许读取 `mcpServers` 键，逐键白名单，其余内容不进内存。

### 方案 D：hooks 兼容（默认关，降级表驱动）

- **内容**：读取项目 `.claude/settings.json` 的 `hooks` 与 Codex `[hooks.*]`/`hooks.json`，映射到 `dsh-hooks-claude-code` 桥的 CC 事件模型。**不追求零转换**：调研确认事件集（28+/10/13）与格式互斥，Codex 还有信任门。做法：可精确映射的事件直接桥接；无法映射的（如 Codex 缺 SessionEnd/Notification）写降级表（`scanNotes` + 状态面板「跳过的事件」），不静默丢。
- **开关**：独立 `compat.hooks` 开关，**默认关**（hooks 是代码执行，等价于市场 hooks 的显式安装语义；主开关不覆盖它）；首次开启时状态面板提示影响面。
- **接缝**：新 `ScanFilter` 或 native 发现器产出 hooks 面 → `hooks-mounts.ts` 桥配置已支持 `{configPath, pluginRoot}`，加一层「原生 hooks 归一 → 桥配置」适配器即可。
- **量级**：中-大（跨格式适配器 + 降级表）。**风险**：高面但被默认关约束；建议排在 C 之后独立交付。

### 方案 E：commands / agents 兼容补全

- **内容**：项目 `.claude/{commands,agents}` 已由 project-native 覆盖；本方案补 Codex 与 Kimi：Codex `~/.codex/prompts` **已官方废弃转向 skills，不做**（调研明确），Codex skills 面由 B 覆盖；Gemini `~/.gemini/commands/*.toml`（TOML 命令格式）列为可选 P4——价值存疑（dsh 用户重叠度低）。agents 定义格式（Claude md frontmatter vs Codex TOML）无公约数，Codex agents **不做零转换**，仅在调研文档记录映射难度。
- **量级**：小（本期实际工作量趋近于零，主要是决策记录）。

### 方案 F：新 manifest 方言（zcode / qoder）——必做，前置证据钉定

- **决策**（2026-09-02 评审）：zcode / qoder 必须完成。但两者布局证据薄弱（zcode 仅社区来源 `~/.zcode/cli/config.json`；Qoder 仅 `.qoder/rules/` 有据、MCP 布局未知），直接实现会静默误扫。
- **前置 spike**（P1 内完成，产出并入调研文档）：①抓取 zcode / Qoder 官方文档与 GitHub 源码（二进制 strings 兜底）钉定 skills/commands/MCP 目录事实；②钉不出的面在兼容性表格标「未验证」，实现只覆盖钉实的面；③实测本机若有安装则直接探测真实目录。
- **实现**：沿 §1 缝位（`MANIFEST_PATHS` + `KIND_PRECEDENCE` + `SuiteLayoutKind` 成员 + fixture），一个 PR 一个方言；兼容表格中标注证据等级（官方文档 / 源码 / 社区来源）。
- **量级**：spike 小，每方言小-中。**风险**：布局演进未承诺兼容——表格中显式声明「按当前版本钉定」。

### 方案 G：指令文件桥（CLAUDE.md / AGENTS.md）——明确不做，记录边界

- 指令文件的加载合并属于 harness/agent 循环职责（dsh 已有 AGENTS.md 约定），不是插件市场能力；且四家合并语义互斥（§2 差异④）。本插件不读、不写、不转换指令文件。若未来 harness 需要，走 harness 层而非本插件。

---

## 4. 开关模型与兼容性表格

### 4.1 开关：两个，不是九个

单一 settings 命名空间，对齐既有 `McpEnhancedSettingsSchema` 模式（`ctx.inject(['settings'])` 注册、翻转即重扫/重挂载）：

```
dsh-agent-plugins-market.compat = {
  enabled: boolean  // 主开关：是否兼容第三方原生布局，默认 true
  hooks:   boolean  // 独立开关：hooks 是代码执行面，默认 false（不受主开关连带）
}
```

- **粒度从哪来**：per-layout/per-suite 的启停**不新建设置**——每个原生布局落地为合成套件后，天然携带既有 `set-enabled` / per-surface 开关链（`state.json` `InstalledEntry`），用户在套件卡片上关掉任何一个布局即可。
- **默认值**（2026-09-02 评审）：只读发现面与 MCP 随主开关默认**开**；hooks 默认**关**，开启是显式动作。
- **生效链**：翻转 → `Catalog` 兼容配置 writer（仿 `setMcpBackendProvider/Writer`，`catalog.ts:268-276`）→ 重扫快照 + reconciler 重挂载；诊断进 `RuntimeDiagnostics`，绝不静默半挂载。
- **降级策略**：settings 读取失败 → 全部按默认值运行（mcpEnhanced 同款 fail-closed）。

### 4.2 兼容性表格（只读，主开关 + hooks 开关所在卡片内）

用户对「兼容了什么、兼容到什么程度」的可见性由**只读表格**承担，而非开关矩阵。每行一个布局：

| 列       | 内容                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------- |
| 布局     | Claude Code / Codex / Kimi / Cursor / agents 通用 / zcode / Qoder                                   |
| 范围     | 项目级目录、全局根（`~/.claude` 等），「未验证」标注                                                |
| 支持面   | skills / commands / agents / MCP / hooks——✅ 支持、◐ 降级（附原因）、❌ 不支持（附理由）、❓ 未验证 |
| 发现计数 | 该布局当前实际发现多少套件 / server                                                                 |
| 证据等级 | 官方文档 / 源码钉定 / 社区来源                                                                      |
| 操作     | 仅有主开关与 hooks 开关两个 Toggle；行级跳转到对应套件卡片                                          |

- **UI 形态**：对齐 MCP 状态卡片规范（左侧 3px 颜色边条表达主开关启停、行内扁平操作、`locales.ts` 双语）；表格数据由 overview 接口新增的只读 `compat` 段供给（每行布局事实来自方案 A 注册表静态声明 + 实时发现计数）。
- **价值**：把「兼容到什么程度」变成可审计的事实陈述（含降级与未验证项），替代隐藏在设置里的细粒度开关；与调研文档的降级表（方案 D）同源。

---

## 5. 实施分期

| 阶段    | 内容                                                                                                                     | 量级  |
| ------- | ------------------------------------------------------------------------------------------------------------------------ | ----- |
| P1      | 方案 A 框架 ＋ B 全局 skills/commands/agents ＋ 开关模型与兼容性表格 UI ＋ **方案 F 证据钉定 spike（zcode/Qoder 布局）** | 中    |
| P2      | 方案 C MCP（`smol-toml` 依赖、冲突治理、状态面板来源列）＋ 方案 F 实现（zcode / Qoder 方言与兼容源，按 spike 钉实的面）  | 中    |
| P3      | 方案 D hooks（降级表 + 默认关）                                                                                          | 中-大 |
| P4 可选 | 方案 E Gemini TOML commands；kilo 等新方言按证据成熟度插队；P4 遗留的 `scanUnmanagedSources` 收尾                        | 小    |

依赖：B 与 F 实现依赖 A 的注册表；C/D 随主开关/独立开关；F 的 spike 可与 A 并行启动。

## 6. 测试要点

- 注册表：各布局发现/空目录跳过/`scanNotes` 诊断；开关翻转后快照变化；settings 缺失回落默认值。
- 优先级：同名 skill 按 rank 去重（project-first、`~/.dsh` > `~/.claude` > `~/.codex` > `~/.agents`）；市场 MCP 与原生同名让位 + 诊断。
- MCP：TOML 表归一、`${VAR}` 展开、白名单外键不进内存、zip 无关回归（`validate.ts` 既有用例不破）。
- hooks：事件映射命中/降级表两态；默认关时零挂载。
- 安全：所有原生目录读取只读、路径含 `~` 展开、不触碰 `~/.claude.json` 非 mcpServers 内容。
- 回归：`pnpm run check:refactor`；新增 UI 文案过 `locales.ts` 双语。

## 7. 风险与取舍

- **只读红线**：native 模式永不安装/卸载/改写用户目录；`~/.claude.json`、sessions、凭据类文件按白名单逐键读取。
- **性能**：全局扫描全部走既有 TTL 缓存；`SKILL.md` 解析缓存已按 mtime 键控。
- **契约兼容**：`compat` settings 全新键，旧版本无感；wire 契约仅加可选字段（布局细分沿用 `manifest.label`，不 bump）。
- **不做的明确化**：迁移器路线（§2 第三层）、Codex prompts、Codex agents 零转换、指令文件桥（G）——每项不做的理由都已记录，避免后续重复论证。

## 8. 评审决策记录（2026-09-02）

1. **只读发现面默认开**：确认（与现有 project-native 行为一致）。
2. **MCP 默认开**，用户可主动关闭（原提案默认关，按评审上调；随主开关）。
3. **`smol-toml` 依赖接受**（PR 正文仍需按仓库惯例论证）。
4. **zcode / qoder 必须完成**：从「观察项」改为必做（P1 spike 钉证据 → P2 实现），未钉实的面在兼容性表格标「未验证」。
5. **开关模型简化**：放弃「布局 × 面」矩阵，改为 `compat.enabled` 单主开关 ＋ `compat.hooks` 独立开关（默认关）；细粒度走既有 per-suite 启用开关；可见性由只读兼容性表格承担（§4）。
