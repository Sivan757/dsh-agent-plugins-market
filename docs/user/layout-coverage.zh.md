# 布局兼容审计

[English](layout-coverage.md) | 中文

`schemas/` 的当前契约包含十种布局：八种客户端/约定方言、agent-plugins v1（schema 位于 `1.0.0`）及无清单技能集合。十种布局都有可执行发现测试，不以 schema 通过或其它高优先级清单成功读取同一仓库代替兼容性证明。

| 布局             | README 仓库快照                                       | 独立核验内容                                                                      |
| ---------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Claude Code      | `grafana/mcp-grafana`                                 | 清单身份、内联 MCP                                                                |
| Codex            | `saadeghi/daisyui`                                    | 自身清单、技能；契约用例补充 API marketplace 和叠加路径                           |
| Cursor           | `EveryInc/compound-engineering-plugin`                | 自身清单与实际产出套件的 Cursor marketplace；契约用例补充无 schema MCP 和组件覆盖 |
| Kimi Code        | `obra/superpowers`                                    | 兼容路径与主清单路径、启动技能、附加技能指令                                      |
| Universal        | `muratcankoylan/Agent-Skills-for-Context-Engineering` | 自身清单与技能集合                                                                |
| agent-plugins v1 | `saadeghi/daisyui`                                    | 内置 schema、根清单身份                                                           |
| ZCode            | `zenstory-ai/oh-story-claudecode`                     | 自身 marketplace、自定义命令路径、全部四项 process hooks 声明                     |
| Qoder CLI        | `DietrichGebert/ponytail`                             | 自身身份及声明的 `qoder-hooks.json`                                               |
| GitHub Copilot   | `headroomlabs-ai/headroom`                            | 自身 marketplace 与嵌套插件清单、hooks 目录；ponytail 补充 Copilot 原生事件名称   |
| 技能集合         | 上述 Universal 仓库，测试中移除清单                   | 原始 SKILL.md 无清单仍可发现                                                      |

## 测试设计

`tests/fixtures/real-layouts/` 保存选定的原始声明与运行时文本，固定完整提交号、每文件 SHA-256 和上游许可证。`scripts/update-layout-fixtures.mjs` 读取对应提交的 Git blob，不信任缓存工作树里的改动。测试不会执行这些仓库的脚本或二进制程序。

`tests/real-layouts.test.ts` 核验来源、对真实清单执行 schema 校验，扫描原始多布局目录，再构建第二棵目录树，在每个套件根移除竞争清单。实际生效的 marketplace 来自扫描器返回值。测试还验证运行时命令读取、hooks 归一化、详情投影和 Kimi 指令加载。无清单和 Kimi 主路径用例明确属于派生布局变体，不冒充上游原始文件位置。

`tests/component-declarations.test.ts` 补充样本未必具备的 schema 形式：文件/目录/数组路径、Cursor 文本扩展名、MCP 文件/内联数组、文件式 LSP、Qoder 内联命令、Kimi hooks/系统提示/catalog 别名、marketplace pluginRoot 与仅条目声明的套件、Codex API catalog，以及路径隔离和失败关闭。

## 实现

`component-files.ts` 负责受限路径与归一化资源，`suite-components.ts` 归一化 hooks 和 LSP 声明。目录计数、命令/代理提供器、角色路由、详情面板使用同一组资源。显式 hooks 无效时不会回退执行默认文件。清单内联命令在资源编辑器中保持只读。

仅含元数据的根 `plugin.json` 保留现有身份，但会从同根 Claude 清单补充缺失的组件声明。未修改的 ponytail 快照验证这一行为，避免根名称文件继续遮蔽真实 hooks，却在隔离测试中表现正常。

Kimi 系统/启动指令使用已有的作用域 `systemPrompt` 服务。ZCode process hooks 通过带引用的命令适配保留 argv 边界。受支持的 Copilot/Cursor 生命周期事件名称映射到现有 command-hook 桥。本轮没有修改宿主仓库，也没有增加依赖。

## 边界

测试证明布局解析和已实现的 DSH 组件适配，不执行任意第三方 hooks、不启动其 MCP 进程、不认证远端凭据/二进制，也不复现原客户端的每项功能。部分上游模板仍包含安装专属值，例如 ponytail 的 `PONYTAIL_DIR`；快照保留原文，不偷偷修正样本来让测试通过。

编辑器原生 rules、应用连接器、厂商专属工具/权限引擎和没有 DSH 对应点的 hook 事件，不会因为清单可解析就自动可移植。历史 `kimi-cli` 工具插件附录与当前 `schemas/kimi/plugin.schema.json`（Kimi Code）是不同协议。按用户禁止修改宿主的约束，项目 LSP 继续诊断而不挂载；用户套件的文件/内联 LSP 使用已有挂载器。不能把这些边界描述为完整原厂运行时等价。

## 复现

```sh
node scripts/compat-report.mjs
node scripts/update-layout-fixtures.mjs
pnpm exec vitest run tests/real-layouts.test.ts tests/component-declarations.test.ts
pnpm run check:refactor
```

只有第一个命令会获取缺失的仓库缓存。日常测试使用仓库内快照，不需要访问 GitHub。
