# 布局兼容审计

[English](layout-coverage.md) | 简体中文 | [README](../../README.zh.md)

**Guide:** [安装](install.md) · [来源](sources.md) · [自建资源](resources.md) · [服务](services.md) · [翻译](translation.md) · [设置](settings.md) · [工作区](workspace.md) · [代理角色](agent-roles.md) · [布局审计](layout-coverage.md)

`schemas/` 的当前契约包含十种布局：八种客户端/约定方言、agent-plugins v1（schema 位于 `1.0.0` 与 `1.1.0`，另有 [`com.deepseek.harness` 命名空间契约](../../packages/market-catalog/schemas/com.deepseek.harness/spec.md)）及无清单技能集合。十种布局的发现路径都由兼容性报告在对应样本仓库上执行，不以 schema 通过或其它高优先级清单成功读取同一仓库代替兼容性证明。

| 布局 | README 仓库快照 | 独立核验内容 |
| --- | --- | --- |
| Claude Code | `grafana/mcp-grafana` | 清单身份、内联 MCP |
| Codex | `saadeghi/daisyui` | 自身清单、技能；契约用例补充 API marketplace 和叠加路径 |
| Cursor | `EveryInc/compound-engineering-plugin` | 自身清单与实际产出套件的 Cursor marketplace；契约用例补充无 schema MCP 和组件覆盖 |
| Kimi Code | `obra/superpowers` | 兼容路径与主清单路径、启动技能、附加技能指令 |
| Universal | `muratcankoylan/Agent-Skills-for-Context-Engineering` | 自身清单与技能集合 |
| agent-plugins v1 | `saadeghi/daisyui` | 内置 schema、根清单身份；契约用例补充 `com.deepseek.harness` 命名空间的扩展能力（命令、代理、hooks、LSP）与逐服务器 MCP 策略 |
| ZCode | `zenstory-ai/oh-story-claudecode` | 自身 marketplace、自定义命令路径、全部四项 process hooks 声明 |
| Qoder CLI | `DietrichGebert/ponytail` | 自身身份及声明的 `qoder-hooks.json` |
| GitHub Copilot | `headroomlabs-ai/headroom` | 自身 marketplace 与嵌套插件清单、hooks 目录；ponytail 补充 Copilot 原生事件名称 |
| 技能集合 | 上述 Universal 仓库，移除清单 | 原始 SKILL.md 无清单仍可发现 |

## 结论的核对方式

布局结论来自 `node scripts/compat-report.mjs`：它克隆样本仓库，并用市场自己的扫描器读取清单；报告记录每个样本声明了什么、扫描器在哪里找到它，本页据此引用。

仓库不再随附离线快照或布局测试套件。扫描、组件声明、hooks 归一化与技能源聚合没有自动化测试；改动的核对方式是在真实宿主里把样本仓库加为市场来源，再读它的套件详情。

显式市场条目与插件声明保留各自身份，包含其它运行面的无清单目录保持独立；安装行为由[技能集合契约](../../packages/market-catalog/schemas/skill-collection/spec.md#source-grouping)定义。

十种布局都通过市场的来源扫描核对：只能解析却产不出套件的布局会表现为扫描备注，而不是悄悄通过。

## 实现

`component-files.ts` 负责受限路径与归一化资源，`suite-components.ts` 归一化 hooks 和 LSP 声明。目录计数、命令/代理提供器、角色路由、详情面板使用同一组资源。显式 hooks 无效时不会回退执行默认文件。清单内联命令在资源编辑器中保持只读。

项目维度通过 `native-project.ts` 复用同一套归一化，因此 `.agents/hooks/hooks.json` 与 `.agents/hooks.json` 的挂载方式与套件自身的 `hooks.json` 一致；独立文件既可写裸事件表，也可写 `hooks` 键。`.agents/mcp.json` 是该布局自己的 `mcpServers` 文档，与 Claude Code 的根 `.mcp.json`、Cursor 的 `.cursor/mcp.json` 并列；ZCode 只读自己的文件。用户 Agent 布局根目录 `~/.agents/` 承载同样的运行面：面板创作或读取的技能、命令与角色，同样两个文件名的 hooks，以及手写的 `mcp.json`、`lsp.json` 声明。

仅含元数据的根 `plugin.json` 保留现有身份，但会从同根 Claude 清单补充缺失的组件声明。把 ponytail 加为市场来源即可看到这一点：否则根名称文件会继续遮蔽真实 hooks。

Kimi 系统/启动指令使用已有的作用域 `systemPrompt` 服务。ZCode process hooks 通过带引用的命令适配保留 argv 边界。受支持的 Copilot/Cursor 生命周期事件名称映射到现有 command-hook 桥。本轮没有修改宿主仓库，也没有增加依赖。

## 边界

测试证明布局解析和已实现的 DSH 组件适配，不执行任意第三方 hooks、不启动其 MCP 进程、不认证远端凭据/二进制，也不复现原客户端的每项功能。部分上游模板仍包含安装专属值，例如 ponytail 的 `PONYTAIL_DIR`；快照保留原文，不偷偷修正样本来让测试通过。

编辑器原生 rules、应用连接器、厂商专属工具/权限引擎和没有 DSH 对应点的 hook 事件，不会因为清单可解析就自动可移植。历史 `kimi-cli` 工具插件附录与当前 `schemas/kimi/plugin.schema.json`（Kimi Code）是不同协议。按用户禁止修改宿主的约束，项目 LSP 继续诊断而不挂载；用户套件的文件/内联 LSP 使用已有挂载器。不能把这些边界描述为完整原厂运行时等价。

## 复现

```sh
node scripts/compat-report.mjs
pnpm run check:refactor
```

第一个命令把仓库获取到 `node_modules/.cache/compat-report` 并写出报告，第二个命令校验工作树。扫描与解析在本仓库没有自动化测试，布局结论要在真实宿主里用市场面板核对。
