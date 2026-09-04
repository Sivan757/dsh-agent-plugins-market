# AI Coding Agent CLI 配置互通生态调查（Claude Code / Codex / Cursor / Kimi 等）

- 日期：2026-09-02（只读网络调查，未修改任何被调查仓库）
- 调查方法：web_search + GitHub API（star 数与最后活跃时间为 2026-09-02 实时快照）+ 直接抓取官方文档原文。每条结论附来源链接；未验证处明确标注「未验证 / 未找到」，不编造。
- 与本项目的关系：本项目（dsh-agent-plugins-market）走「零转换、零复制」的原位注入路线；本文梳理同类/竞争生态，并分析哪些语义差异决定了「零转换注入」的可行边界。

---

## 0. 结论速览

1. **生态按「转换深度」分三层**：① provider/API 切换器（只改配置文件里的模型接入，如 cc-switch）；② 指令/规则分发器（单一源头生成各工具文件，如 ruler、vercel-labs/skills）；③ 全量语义迁移器（skills/agents/commands/hooks/MCP 跨方言翻译，如 acplugin、ccode-to-codex、a16n、swik）。第三层全部承认「不是盲翻译」，需要人工复核清单。
2. **SKILL.md / Agent Skills（agentskills.io 开放标准）正在成为最大的公约数**：Claude Code、Codex、Kimi CLI、Crush、OpenCode、Gemini CLI、iFlow 等都已采用「目录 + SKILL.md」格式，这使得 skills 的跨工具分发接近零转换（[agentskills.io](https://agentskills.io)、[Codex Build skills](https://learn.chatgpt.com/docs/build-skills)、[Kimi CLI Skills](https://moonshotai.github.io/kimi-cli/en/customization/skills.html)）。
3. **Kimi CLI 甚至原生合并读取 `~/.claude/skills/` 与 `~/.codex/skills/`**（kimi > claude > codex 同名优先级），是官方产品里对「跨工具目录兼容」走得最远的一个（[Kimi Skills 文档](https://moonshotai.github.io/kimi-cli/en/customization/skills.html)）。
4. **跨工具的「通用目录」已事实形成**：项目级 `.agents/skills/` 与全局 `~/.agents/skills/`、`~/.config/agents/skills/` 被约 75 个工具采纳为落点（[vercel-labs/skills 支持表](https://github.com/vercel-labs/skills)）。
5. **hooks / commands / agents / 插件市场** 四类 surface 仍高度方言化（JSON vs TOML、事件集不同、信任模型不同），是所有转换器的「损耗大头」，也是本项目 runtime 注入的价值区。

---

## 1. 项目全景表

Star 数为 GitHub API 2026-09-02 快照值（四舍五入）；「活跃」指 repo `pushed_at` 在最近 2 周内。

### 1.1 跨工具迁移 / 互通工具（与本项目最直接相关）

| 项目 | Stars ≈ | 桥接什么 | 方向 | 安装 | 活跃 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| [farion1231/cc-switch](https://github.com/farion1231/cc-switch) | 130.7k | 跨平台桌面端，管理/切换 Claude Code、Codex、OpenCode、OpenClaw、Grok Build、Gemini CLI、Hermes Agent 的 provider/API 配置；宣称「最小侵入」，卸载后 CLI 原样可用 | 切换（非转换） | 桌面 App（Tauri/Rust），官网 ccswitch.io | ✅ 2026-09-02 | [README](https://github.com/farion1231/cc-switch)、[设计原则](https://github.com/justjavac/cc-switch)（justjavac 为早期镜像/上游，star 0） |
| [vercel-labs/skills](https://github.com/vercel-labs/skills) | 30.2k | `npx skills add` 把同一批 skill 安装进约 78 个 agent 的原生 skills 目录（逐工具映射路径，见 §2.9 通用目录） | 一份内容 → 多端落位（复制，非转换） | `npx skills` | ✅ 2026-08-18 | [README](https://github.com/vercel-labs/skills/blob/main/README.md)、[Vercel 博客](https://vercel.com/blog/skills-night-69000-ways-agents-are-getting-smarter) |
| [TokenRollAI/acplugin](https://github.com/TokenRollAI/acplugin) | 52 | Claude Code 插件 → Codex CLI / OpenCode / Cursor / Google Antigravity / Pi：Skills、Instructions、MCP、Agents、Commands、Hooks 全量转换，含模型名映射（Claude→GPT-5.4/Gemini 3 Pro），支持 marketplace 多插件仓库、GitHub 直读 | 单向（Claude → 5 目标） | `npm i -g @disdjj/acplugin` / `npx` | ✅ 2026-08-25 | [README](https://github.com/TokenRollAI/acplugin) |
| [zuharz/ccode-to-codex](https://github.com/zuharz/ccode-to-codex) | 68 | Claude `.claude/skills` + `.claude/agents` → Codex 原生 skill 包 + `.codex/agents/*.toml`；语义映射（非盲翻译），迁移风险分级 MECHANICAL/MANUAL/REFACTOR，MCP 工具命名空间下划线归一 | 单向（Claude → Codex），实验性 | Python，repo 内跑 | ✅ 2026-08-20 | [README](https://github.com/zuharz/ccode-to-codex) |
| [ussumant/cc2codex](https://github.com/ussumant/cc2codex) | 44 | Claude Code → Codex 迁移助手：CLAUDE.md 指令、skills、可简化的 agent 流程、高置信 hooks、MCP 结构；secrets 需重填，Claude-only hook 事件需人工清理 | 单向（Claude → Codex），Beta | Codex CLI 插件流 | 2026-05-20 | [README](https://github.com/ussumant/cc2codex) |
| [treesoop/claude2codex](https://github.com/treesoop/claude2codex) | 24 | 扫描 `~/.claude`（plugins/MCP/skills/commands/agents）迁到 `~/.codex`、`~/.agents/skills`、prompts；快照 + 回滚 + 损耗报告（loss report） | 单向（Claude → Codex） | `npx claude2codex migrate` | 2026-04-16 | [README](https://github.com/treesoop/claude2codex) |
| [m3252/swik](https://github.com/m3252/swik) | 0（新仓） | Claude Code ↔ Codex 双向：CLAUDE.md/AGENTS.md、MCP servers、skills；dry-run 预览、每次写盘备份、可恢复；只迁「可移植配置」，不碰账号/会话/密钥 | 双向 | `npx @seungchan.m/swik` | 2026-06-05 | [README](https://github.com/m3252/swik) |
| [slash9494/ai-config-sync-manager](https://github.com/slash9494/ai-config-sync-manager) | 34 | Claude Code ↔ Codex **持续双向同步**（自称 round-trip lossless，非一次性迁移）：instructions、skills、agents、MCP servers、hooks、permissions | 双向持续 | npm `ai-config-sync-manager` | ✅ 2026-09-02 | [README](https://github.com/slash9494/ai-config-sync-manager) |
| [Texarkanine/a16n](https://github.com/Texarkanine/a16n) | 0（新仓） | 「Agent customization portability」CLI + 库：Cursor ↔ Claude Code ↔ AGENTS.md 内置互转，其他工具走插件扩展；dry-run、跨目录转换 | 双向（按工具对） | `npx a16n convert --from cursor --to claude` | ✅ 2026-09-02 | [README](https://github.com/Texarkanine/a16n) |
| [himmelreich-it/agent-skill-converter](https://github.com/himmelreich-it/agent-skill-converter) | 1 | Shell 脚本级 skill 格式转换（规模极小，细节未深查） | 未验证 | shell | 2026-03-14 | [repo](https://github.com/himmelreich-it/agent-skill-converter) |
| [intellectronica/ruler](https://github.com/intellectronica/ruler) | 2.9k | 单一规则源 → 分发到 Copilot / Claude / Cursor / Aider 等各自配置文件（解决「多工具各自维护指令」），非工具间互转 | 单源 → 多端 | npm `@intellectronica/ruler` | ✅ 2026-08-26 | [README](https://github.com/intellectronica/ruler) |
| [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) | 30.5k | Claude Code 组件模板 CLI（配置/监控），组件生态而非跨工具转换；是否含其他 harness 输出未验证 | — | npx | ✅ 2026-09-02 | [repo](https://github.com/davila7/claude-code-templates) |

### 1.2 npm 上的小工具（搜索命中但未深查，列为线索）

- [`agents-md-migrate`](https://www.npmjs.com/package/agents-md-migrate)：AGENTS.md 迁移 npm 包（未验证实现细节）。
- [`sync-agents-settings`](https://www.npmjs.com/package/sync-agents-settings)：agent 设置同步 npm 包（未验证实现细节）。
- [`skein-cli`](https://www.npmjs.com/package/skein-cli)：搜索命中，用途未验证。

### 1.3 被桥接的宿主（非转换器，但决定转换面）

| 宿主 | Stars ≈ | 活跃 | 来源 |
| --- | --- | --- | --- |
| [anthropics/claude-code](https://github.com/anthropics/claude-code) | 143.8k | ✅ | GitHub API |
| [openai/codex](https://github.com/openai/codex) | 120.9k | ✅ | GitHub API |
| [anomalyco/opencode](https://github.com/anomalyco/opencode)（原 sst/opencode，已迁移组织） | 203k | ✅ | GitHub API |
| [charmbracelet/crush](https://github.com/charmbracelet/crush) | 27.9k | ✅ | GitHub API |
| [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | 106.8k | ✅ | GitHub API |
| [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code) | 27.6k | ✅ | GitHub API（gemini-cli 分支，见 [Qwen fork 记录](https://git.mrhua.top/QwenLM/qwen-code)） |
| [MoonshotAI/kimi-cli](https://github.com/MoonshotAI/kimi-cli) | 11.3k | ✅ | GitHub API |
| [Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode) | 27.1k | ✅ | GitHub API |

---

## 2. 各工具磁盘布局事实（一手来源）

### 2.1 Claude Code（`~/.claude/` 与项目 `.claude/`）

权威来源：[Explore the .claude directory](https://code.claude.com/docs/en/claude-directory)（下称 claude-directory；`CLAUDE_CONFIG_DIR` 环境变量可整体重定位 `~/.claude`）。

- **项目级**（入 git 团队共享）：`CLAUDE.md`（或 `.claude/CLAUDE.md`）、`.claude/settings.json`（团队默认，可被 local/CLI flags/managed 覆盖）、`.claude/settings.local.json`（个人覆盖，array 类设置跨层合并、scalar 用本地值）、`.claude/skills/`（每 skill 一个目录 + `SKILL.md` + 附属文件）、`.claude/commands/`（markdown 命令，`$ARGUMENTS` 占位；skill 与 command 同名时 **skill 优先**；官方建议新命令尽量写成 skill）、`.claude/agents/`（subagents，`memory: project|local|user` 前置元数据决定其记忆目录）、`.claude/rules/`（支持 `paths:` glob 前置元数据与子目录自动发现）、`.claude/workflows/`、`.claude/output-styles/`、`.claude/agent-memory/`。
- **项目根（不在 `.claude/` 内）**：`.mcp.json`（团队共享 MCP，项目唯一）、`.worktreeinclude`（仅 git）。
- **全局 `~/.claude/`**：`settings.json`（同 schema；**项目 `settings.json` 按键覆盖全局**——与 CLAUDE.md「全局与项目都整体载入、不做按键合并」的语义不同）、`rules/`、`skills/`、`commands/`、`agents/`、`output-styles/`、`workflows/`、`agent-memory/`、`plugins/`（marketplace clone、已装插件版本与数据；link 模式存链接而非副本，见 [plugin caching](https://code.claude.com/docs/en/plugins-reference#plugin-caching-and-file-resolution)）。
- **`~/.claude.json`（全局唯一）**：应用状态、OAuth、UI 开关；**个人 MCP servers（user scope 跨项目 / local scope 单项目）** 写在这里，团队共享走项目根 `.mcp.json`（claude-directory 与 [MCP scopes](https://code.claude.com/docs/en/mcp)）。
- **运行时数据**（明文，`~/.claude/` 下）：`projects/`（会话 resume + auto memory）、`history.jsonl`、`file-history/`、`backups/`（claude-directory §Application data）。

### 2.2 Codex（`~/.codex/`，`CODEX_HOME` 可重定位）

- **config.toml**：`~/.codex/config.toml` 保存模型、审批、沙盒、profiles、MCP；项目级 `.codex/config.toml` 仅对受信任项目生效（[Codex MCP 文档镜像](https://github.com/mehmetbaykar/codex-docs-skill/blob/main/skills/codex-docs/references/extend__mcp.md)，源为 learn.chatgpt.com 官方文档镜像；[config.md 官方入口](https://github.com/openai/codex/blob/main/docs/config.md)）。核心键（[config reference 镜像](https://github.com/mehmetbaykar/codex-docs-skill/blob/main/skills/codex-docs/references/config-file__config-reference.md)）：`model`、`approval_policy`、`sandbox_mode`、`[profiles.<name>]`、`[mcp_servers.<id>]`（command/args/env/url/auth/oauth）、`[features].hooks`（`codex_hooks` 为弃用别名）、`project_doc_max_bytes`（默认 **32 KiB**）、`project_doc_fallback_filenames`（`AGENTS.md` 缺失时的候选名）。另有 `skills.config`（逐 skill 的 path/enabled 开关）。个人本地环境变量放 `~/.codex/.env`（[CodexGuide 配置指南（镜像官方文档，核对日 2026-05-27）](https://github.com/freestylefly/CodexGuide/blob/main/docs/advanced/09-config-toml.md)）。
- **AGENTS.md 发现链**（[官方文档镜像](https://github.com/mehmetbaykar/codex-docs-skill/blob/main/skills/codex-docs/references/agent-configuration__agents-md.md)）：① 全局 `~/.codex/AGENTS.override.md` > `AGENTS.md`（取首个非空）；② 从项目根向当前目录逐层走，每目录最多取一个文件（`AGENTS.override.md` > `AGENTS.md` > fallback 名）；③ 根→叶拼接，越靠近 cwd 越后出现即越优先；累计到 32 KiB 截止。
- **Skills**：官方已将 skill 定为「可复用工作流的作者格式」，基于 [agentskills.io 开放标准](https://agentskills.io)，目录 + `SKILL.md`（必须含 `name`/`description`），支持显式（`/skills`、`$`）与隐式调用；初始列表预算为上下文 **2%（未知窗口时 8000 字符）**，超限时先缩短 description、必要时省略 skill（[Build skills 官方镜像](https://github.com/mehmetbaykar/codex-docs-skill/blob/main/skills/codex-docs/references/build-skills.md)；[repo docs/skills.md 指向官方页](https://github.com/openai/codex/blob/main/docs/skills.md)；skills 生态时间线见 [issue #5291](https://github.com/openai/codex/issues/5291)）。落盘位置：官方文档未在本次抓取中直接列出；[vercel-labs/skills 支持表](https://github.com/vercel-labs/skills) 记录为项目 `.agents/skills/`、全局 `~/.codex/skills/`（跨源，非 OpenAI 官方原文，标注为间接证据）。
- **Custom prompts（已弃用）**：`~/.codex/prompts/*.md`（含 `description`/`argument-hint` 前置元数据，斜杠命令调用，仅本地不共享），官方明确「已弃用，改用 skills」（[官方文档镜像](https://github.com/mehmetbaykar/codex-docs-skill/blob/main/skills/codex-docs/references/custom-prompts.md)）。
- **Hooks**：官方 config.md 有 Lifecycle hooks 节（[docs/config.md](https://github.com/openai/codex/blob/main/docs/config.md)）；详细事件模型见社区维护参考（[CodeAlive codex-hooks 参考，标注「截至 2026-06」](https://github.com/CodeAlive-AI/ai-driven-development/blob/main/skills/hooks-management/references/codex-hooks.md)）：10 个事件（SessionStart、SubagentStart、PreToolUse、PermissionRequest、PostToolUse、PreCompact、PostCompact、UserPromptSubmit、SubagentStop、Stop），配置在 `~/.codex/config.toml` 内联 `[hooks.*]` 或 `hooks.json`，项目 `.codex/` 层需受信任，非托管命令 hook 需 `/hooks` 人工审查（信任门槛）。**注意此表为第三方整理，事件计数等细节未在官方页逐条复核**。
- **会话/历史**：`~/.codex` 内存会话 metadata 与 SQLite 状态（[CodexGuide](https://github.com/freestylefly/CodexGuide/blob/main/docs/advanced/09-config-toml.md)）。

### 2.3 Cursor

- **规则**：项目规则在 `.cursor/rules/*.mdc`，**必须是 `.mdc` 扩展**；`.md` 文件被规则系统忽略（无前置元数据）。每个规则带 `description` / `globs` / `alwaysApply` 三个前置字段，三者组合决定 Always/Specific/Manual/Model-decided 行为；`AGENTS.md` 为一等公民（可代替 plain markdown 规则）（[Cursor Rules 文档](https://cursor.com/docs/rules.md)）。
- **MCP**：项目 `.cursor/mcp.json`（团队共享，入 git）+ 全局 `~/.cursor/mcp.json`，**两者合并、同名时项目优先**；键为 `mcpServers`（[Cursor MCP 文档](https://cursor.com/help/customization/mcp.md)）。
- **Slash commands**：Cursor 1.6 起提供斜杠命令与 Agent 终端改进（[Changelog 1.6](https://cursor.com/changelog/1-6)）；命令文件的磁盘布局在本次抓取中**未找到官方文档页，未验证**。
- **Skills**：全局 `~/.cursor/skills/`、项目经通用 `.agents/skills/`（[vercel-labs/skills 支持表](https://github.com/vercel-labs/skills)，间接证据）。

### 2.4 Kimi Code CLI（`~/.kimi/`，`KIMI_SHARE_DIR` 可重定位运行时数据）

- **目录结构**（[Data Locations 官方文档](https://moonshotai.github.io/kimi-cli/en/configuration/data-locations.html)）：`config.toml`（主配置）、`kimi.json`（运行时元数据）、`mcp.json`（MCP，`kimi mcp add` 写入，键名 `mcpServers`）、`credentials/`、`mcp-oauth/`、`sessions/<work-dir-hash>/<session-id>/{context.jsonl,wire.jsonl,state.json}`、`plans/`、`user-history/`、`logs/`。
- **config.toml 顶层键**（[Config Files 官方文档](https://moonshotai.github.io/kimi-cli/en/configuration/config-files.html)）：`default_model`、`default_thinking`、`default_yolo`、`default_plan_mode`、`theme`、`merge_all_available_skills`、`telemetry`、`providers`、`models`、`services`、`mcp` 等；支持 `--config-file` 换 TOML/JSON、`--config` 内联。
- **Skills（关键兼容性行为）**（[Skills 官方文档](https://moonshotai.github.io/kimi-cli/en/customization/skills.html)）：基于 agentskills.io 标准；发现优先级 Project > User > Extra > Built-in。用户级分两组各自互斥取首个存在者再合并：**品牌组** `~/.kimi/skills/` > `~/.claude/skills/` > `~/.codex/skills/`；**通用组** `~/.config/agents/skills/` > `~/.agents/skills/`。默认 `merge_all_available_skills = true` 时**所有存在的品牌目录全部合并加载**，同名按 kimi > claude > codex 决胜——即 Kimi 官方原生读 Claude 与 Codex 的 skills 目录。
- **Hooks（Beta）**（[Hooks 官方文档](https://moonshotai.github.io/kimi-cli/en/customization/hooks.html)）：`~/.kimi/config.toml` 内 `[[hooks]]` 数组（TOML），13 个生命周期事件（PreToolUse/PostToolUse/PostToolUseFailure/UserPromptSubmit/Stop/StopFailure/SessionStart/SessionEnd/SubagentStart/SubagentStop/PreCompact/PostCompact/Notification），stdin 收上下文 JSON、退出码决定行为。
- **插件（Beta）**：`plugin.json` 声明可执行工具（[Plugins](https://moonshotai.github.io/kimi-cli/en/customization/plugins.html)，细节未深查）。

### 2.5 OpenCode（anomalyco/opencode）

- 配置为 JSON（`$schema: opencode.ai/config.json`）；项目 `opencode.json` > 全局 `~/.config/opencode/opencode.json` > TUI 单独 `~/.config/opencode/tui.json`；**`.opencode/` 与 `~/.config/opencode/` 下子目录用复数**：`agents/`、`commands/`、`modes/`、`plugins/`、`skills/`、`tools/`、`themes/`（单数向后兼容）；支持 `OPENCODE_CONFIG`/`OPENCODE_CONFIG_DIR` 重定位与 managed settings（[Config 官方文档](https://opencode.ai/docs/config)）。
- 指令文件直接用 `AGENTS.md`（`/init` 生成/改进，扫描时会参考已有 Cursor/Copilot 规则）（[Rules 官方文档](https://opencode.ai/docs/rules)）。
- skills 落盘：`~/.config/opencode/skills/` + 项目 `.agents/skills/`（[vercel-labs/skills 支持表](https://github.com/vercel-labs/skills)，间接证据，与官方复数子目录一致）。

### 2.6 Crush（charmbracelet/crush）

- 配置：`$HOME/.local/share/crush/crush.json`（schema `charm.land/crush.json`）+ `crushrc`（`./.crushrc`、`~/.config/crush/crushrc`，trusted shell code，加载时执行 `$(...)`）（[README 配置节](https://github.com/charmbracelet/crush)）。
- 指令：`.crush/CRUSH.md`（Crush 专属规则）、`~/.config/crush/CRUSH.md`（全局）；**直接支持 `AGENTS.md`/`CLAUDE.md` 读取**，另有 `~/.config/AGENTS.md` 作为跨工具通用层（README：「Crush-specific rules that would confuse other tools vs generic instructions that other coding tools might read」）。
- Skills：内置 skills 目录 `internal/skills/builtin/crush-config/SKILL.md` 证明其采用 agentskills 格式（[repo 源文件](https://github.com/charmbracelet/crush/blob/main/internal/skills/builtin/crush-config/SKILL.md)）。

### 2.7 Gemini CLI / Qwen Code

- Gemini CLI 自定义命令：`~/.gemini/commands/*.toml`（用户）与 `<project>/.gemini/commands/*.toml`（项目，优先），**TOML 格式**，命名空间即子目录（`git/commit.toml` → `/git:commit`），支持 `{{args}}` 注入、`!{...}` shell 执行、`@{...}` 文件注入（[Custom commands 官方文档](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/custom-commands.md)）。
- MCP：`settings.json` 顶层 `mcpServers` 定义各 server，另有 `mcp` 对象做全局规则（超时/信任等）（[MCP server 官方文档](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md)）。
- Qwen Code 为 gemini-cli 分支（配置同构；其官方 configuration 文档在 [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code) 内，本次抓取 main 分支路径 404，未逐条复核，标注）。

### 2.8 iFlow CLI / Qoder / zcode / Kilo

- **iFlow CLI**：分层配置（内置默认 < 用户全局 < 项目 < 系统级 < 命令行参数 < 环境变量）；`~/.iflow/settings.json`，环境变量加 `IFLOW_` 前缀（[CLI Configuration 官方文档](http://docs.iflow.cn/en/cli/configuration/settings/)）。**官方公告：iFlow CLI 将于北京时间 2026-04-17 停服，官方建议迁移到 Qoder**（同一文档页顶部）。skills 落盘 `.iflow/skills/` 与 `~/.iflow/skills/`（[vercel-labs/skills 支持表](https://github.com/vercel-labs/skills)）。
- **Qoder（Alibaba）**：规则在项目 `.qoder/rules/`，四类应用方式（手动 @rule / 模型决策 / 总是 / glob 匹配）；**全量规则上限 100,000 字符**；支持把 `AGENTS.md` 放项目根自动识别（[Qoder Rules 官方文档](https://docs.qoder.com/user-guide/rules)）。MCP/命令磁盘布局官方文档未在本次抓取中找到，**未验证**。
- **zcode（智谱 Z Code CLI）**：社区实现 [kingsword09/zcode-cli](https://github.com/kingsword09/zcode-cli/blob/main/docs/CONFIGURATION.md) 记录为 `~/.zcode/cli/config.json`（macOS/Linux，`%USERPROFILE%\.zcode\cli\config.json` on Windows），首启生成无凭证默认配置 + setup wizard；模型接入走 Z.AI OAuth / Coding Plan API key / 自定义 provider。**注意这是社区仓库文档，智谱官方 CLI 的布局未验证**。
- **Kilo（Kilo Code）**：主形态为 VS Code 平台扩展（[Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode)）；skills 落盘 `.kilocode/skills/` 与 `~/.kilocode/skills/`（[vercel-labs/skills 支持表](https://github.com/vercel-labs/skills)，间接证据）；独立 CLI 配置布局未验证。

### 2.9 跨工具「通用目录」事实（零转换注入的机会面）

[vercel-labs/skills](https://github.com/vercel-labs/skills) 的支持表（2026-08 快照）逐工具列出 skills 落点，摘录：

| Agent                              | 项目级              | 全局                         |
| ---------------------------------- | ------------------- | ---------------------------- |
| 通用（Amp、Replit、Universal 等）  | `.agents/skills/`   | `~/.config/agents/skills/`   |
| Claude Code                        | `.claude/skills/`   | `~/.claude/skills/`          |
| Codex                              | `.agents/skills/`   | `~/.codex/skills/`           |
| Cursor                             | `.agents/skills/`   | `~/.cursor/skills/`          |
| Kimi Code CLI、Cline、Warp、Zed 等 | `.agents/skills/`   | `~/.agents/skills/`          |
| Kilo Code                          | `.kilocode/skills/` | `~/.kilocode/skills/`        |
| Gemini CLI                         | `.agents/skills/`   | `~/.gemini/skills/`          |
| OpenCode                           | `.agents/skills/`   | `~/.config/opencode/skills/` |
| iFlow CLI                          | `.iflow/skills/`    | `~/.iflow/skills/`           |

该 CLI 还能从 `.claude-plugin/marketplace.json` / `.claude-plugin/plugin.json` 发现 skills（[README](https://github.com/vercel-labs/skills/blob/main/README.md)）——即 Claude 插件市场格式已成为 skills 的一种事实分发源。

---

## 3. 语义差异分析：为什么「零转换注入」有边界

按「阻碍大小」排序，标出每条的出处。

1. **Skills 是最大公约数，但预算与调用语义不同**。Claude/Codex/Kimi/Crush/OpenCode 都吃 `SKILL.md` 目录（[agentskills.io](https://agentskills.io)、[Codex build-skills](https://learn.chatgpt.com/docs/build-skills)、[Kimi skills](https://moonshotai.github.io/kimi-cli/en/customization/skills.html)），复制即可用——这是 vercel-labs/skills 与本项目「零转换」能成立的地基。差异点：Codex 对初始 skill 列表设 **2% 上下文 / 8000 字符预算**，超限缩短 description 甚至省略；Claude 的 `disable-model-invocation` / `user-invocable`、skills 与 commands 同名时 skill 优先等语义并非各端一致（[claude-directory](https://code.claude.com/docs/en/claude-directory)）。
2. **Hooks 是方言最重的 surface**。事件集不同（Claude 28+ vs Codex 10 vs Kimi 13）；配置格式三足鼎立：Claude `settings.json`（JSON）、Codex `config.toml` 内联 `[hooks.*]` 或 `hooks.json`（TOML）、Kimi `~/.kimi/config.toml` `[[hooks]]`（TOML）；Codex 缺 `SessionEnd`/`Notification`，PreToolUse 拦截面是 Bash/`apply_patch`/MCP 调用且官方定位为 guardrail 而非强制边界；Codex 还有 Claude 没有的信任模型（项目 `.codex/` 必须受信任、命令 hook 需 `/hooks` 人工审查）（[CodeAlive hooks 对照表](https://github.com/CodeAlive-AI/ai-driven-development/blob/main/skills/hooks-management/references/codex-hooks.md)、[Kimi hooks](https://moonshotai.github.io/kimi-cli/en/customization/hooks.html)、[claude-directory](https://code.claude.com/docs/en/claude-directory)）。结论：hooks 几乎不可能零转换，只能注入 + 降级。
3. **MCP 同名不同构**。键名 `mcpServers`（JSON：Claude `.mcp.json`/`~/.claude.json`、Cursor、Kimi `~/.kimi/mcp.json`、Gemini `settings.json`）vs `mcp_servers`（TOML：Codex `config.toml` / 项目 `.codex/config.toml`）；字段面不同（Codex 有 `env_vars`/`auth`/`oauth.*`，Kimi 有 `transport`/`headers`）；作用域模型不同（Claude 三层 scope 且团队/个人分离；Cursor 全局+项目合并同名项目优先；Codex 项目级仅受信任项目生效）。字段级映射可行，但作用域语义需要明确映射规则（[Codex MCP 镜像](https://github.com/mehmetbaykar/codex-docs-skill/blob/main/skills/codex-docs/references/extend__mcp.md)、[Cursor MCP](https://cursor.com/help/customization/mcp.md)、[Gemini MCP](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md)、[claude-directory](https://code.claude.com/docs/en/claude-directory)）。
4. **指令文件的「合并语义」根本不同**。CLAUDE.md：全局与项目文件**都整体载入上下文、不做按键合并**（claude-directory 明说与 settings.json 的差异）；Codex AGENTS.md：逐目录取一、根→叶拼接、越近 cwd 越优先、**32 KiB 截止**；Cursor：`.mdc` 前置元数据（`alwaysApply`/`globs`/`description`）驱动包含策略，`.md` 直接被忽略；Qoder：`.qoder/rules/` 100k 字符上限。同一份指令文本可以零转换共享，但「何时生效、截断在哪」不可移植（[claude-directory](https://code.claude.com/docs/en/claude-directory)、[Codex agents-md 镜像](https://github.com/mehmetbaykar/codex-docs-skill/blob/main/skills/codex-docs/references/agent-configuration__agents-md.md)、[Cursor rules](https://cursor.com/docs/rules.md)、[Qoder rules](https://docs.qoder.com/user-guide/rules)）。
5. **命令/斜杠命令三套格式**。Claude：`.claude/commands/*.md` + `$ARGUMENTS`，且被官方定位为「应逐步被 skills 取代」（同名时 skill 优先）；Codex：`~/.codex/prompts/*.md` **已弃用**并引导到 skills；Gemini/Qwen：**TOML** + `{{args}}`/`!{...}`/`@{...}`。CC→Codex 可走 skills 通道（cc2codex/ccode-to-codex 均如此），CC→Gemini 必须真转换（[claude-directory](https://code.claude.com/docs/en/claude-directory)、[Codex custom prompts 镜像](https://github.com/mehmetbaykar/codex-docs-skill/blob/main/skills/codex-docs/references/custom-prompts.md)、[Gemini custom commands](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/custom-commands.md)）。
6. **Agents/subagents 无通用格式**。Claude 是 `.claude/agents/` markdown + 前置元数据（tools/model/memory）；Codex 是 `.codex/agents/*.toml`（custom agents）加 `spawn_agent(...)` 编排——迁移器只能做语义重写并分级人工复核（ccode-to-codex 的 MECHANICAL/MANUAL/REFACTOR 分级、cc2codex 的「team-style workflows 需重新设计」都源于此）（[ccode-to-codex README](https://github.com/zuharz/ccode-to-codex)、[cc2codex README](https://github.com/ussumant/cc2codex)）。
7. **插件/市场是 Claude 生态独有结构**。`.claude-plugin/marketplace.json`/`plugin.json` 与 `~/.claude/plugins/` 缓存在其他工具没有对位物；向外只能拆散成 skills/commands/MCP 逐项转换（acplugin 的做法），或被第三方工具反向消费为 skill 源（vercel-labs/skills 会读 marketplace.json 发现 skills）（[acplugin README](https://github.com/TokenRollAI/acplugin)、[vercel-labs/skills README](https://github.com/vercel-labs/skills)、[plugin caching](https://code.claude.com/docs/en/plugins-reference#plugin-caching-and-file-resolution)）。
8. **所有迁移器共同划出的红线：secrets、会话/历史、账号**。cc2codex（secrets 需重填、Claude-only hooks 需清理）、swik（不碰账号/会话/密钥）、claude2codex（loss report 报告损耗）——即「零转换」只覆盖配置面，凭证与运行时状态永远人工（[cc2codex](https://github.com/ussumant/cc2codex)、[swik](https://github.com/m3252/swik)、[claude2codex](https://github.com/treesoop/claude2codex)）。

对本项目的定位启示：skills（SKILL.md）+ MCP 结构 是最接近零转换注入的两类 surface（且 Kimi 已原生读 `~/.claude/skills`、vercel-labs 证明「复制即用」的通用目录模式可行）；hooks/commands/agents 则必须走「方言适配层 + 降级报告」，与本仓库「validation fails closed、scanNotes 可见」的原则一致。

---

## 4. Gaps / Unknowns（明确未验证项）

1. **Codex skills 的官方默认目录**：官方 build-skills 文档未在本次抓取中直接列出安装路径；`~/.codex/skills/`、`.agents/skills/` 来自 vercel-labs/skills 支持表（间接证据）。需读官方 [developers.openai.com/codex/skills](https://developers.openai.com/codex/skills) 原文确认（该站对 curl 返回 403，本次未取到）。
2. **Codex hooks 细节**：事件表与配置细节来自第三方参考（CodeAlive，标注「截至 2026-06」），官方 hooks 文档页未逐条复核。
3. **Cursor 命令/斜杠命令的磁盘布局**：官方文档页未找到，未验证；skills 落盘为 vercel-labs 间接证据。
4. **Qoder 的 MCP/命令布局**：官方文档仅确认 `.qoder/rules/` 与 AGENTS.md 兼容；其余未找到。
5. **zcode 官方布局**：`~/.zcode/cli/config.json` 来自社区仓库 kingsword09/zcode-cli；智谱官方 CLI 文档未验证。
6. **ryoppippi/rulesync**：搜索结果显示存在多个 fork（如 [dyoshikawa/rulesync](https://github.com/dyoshikawa/rulesync)），但 GitHub API 查 `ryoppippi/rulesync` 返回 MISSING——原仓可能已改名/删除，状态未知。
7. **Kilo 独立 CLI**：skills 目录为间接证据，其余配置布局未验证。
8. **`opencode.json` 内 mcp/agents 的完整 schema**、**Kimi plugins（Beta）manifest 细节**、**Crush hooks 事件模型**：本次未深查。
9. **star 数与活跃度**为 2026-09-02 GitHub API 单次快照，会随时间漂移；a16n/swik star 显示 0 仅说明极新，不代表无效。
10. **npm 小工具**（agents-md-migrate、sync-agents-settings、skein-cli）仅确认存在，实现与维护状态未验证。
