# Agent Note: 布局注册表与项目作用域

Status: implemented

## Problem

新增 ZCode、Qoder CLI 与 Copilot 需要贯通清单、marketplace 和项目支持。已有项目技能发现不能证明项目命令或服务可执行；布局定义分散也容易遗漏。

## Decision

[统一优先级决策](2026-09-09-unified-layout-precedence.zh.md)让 marketplace 与套件清单从同一注册表派生顺序，共享根索引仍最后回退。

[Schema 组件决策](2026-09-09-schema-components.zh.md)补充 Kimi Code 主清单、声明资源解析与固定提交的仓库隔离测试。来源身份与项目作用域继续由本记录负责。

保留源扫描策略链，集中纯布局声明，并从注册表派生清单类型。项目原生发现使用持久化总开关 `scanProjectLayouts`，默认开启，变更时立即失效快照。运行时保留明确的能力面掩码，并通过调用 Agent 的会话确定项目资源。

注册表、三种新方言、项目角色查找和 Agent 作用域命令/MCP/hooks 生命周期已实现。原生 JSON 和 Codex TOML MCP 明确项目执行根目录。经用户批准的 `smol-toml` 负责解析 TOML；工具过滤与超时传递到桥，不被丢弃。无效清单按候选逐个拒绝回退：被拒绝的清单给出诊断后尝试下一优先级（见[清单回退决策](2026-09-12-manifest-priority-fallback.zh.md)）；marketplace 路径按 realpath 检查归属。[ADR](../../../../docs/adr/2026-09-09-layout-registry.md)记录受支持格式、证据与边界。

## Alternatives considered

**继续扩展独立分支。** 重复现有维护问题，类型与扫描路径容易不同步。

**替换扫描管线。** marketplace/rooted/flat 策略接口已经适用，缺失的是布局数据抽象与项目运行时归属。

**全局挂载所有项目。** 会混用会话，不能保证项目隔离。

## Verification

[子代理目录决策](2026-09-09-subagent-catalog.zh.md)以准确角色 ID 替代生成别名，同时保留普通和复合后缀 Markdown 定义。普通 `agent-*` 技能仍按技能处理。扫描开关已经通过真实设置 UI、页面刷新和隔离宿主进程重启验证，关闭值保存在该实例的 `settings.yaml` 中。

三种方言都能解析清单和 marketplace，受支持的项目布局贯通运行时消费者，开关持久化且正确失效缓存和进行中的扫描，不支持的语义有诊断。测试覆盖执行、多项目与开关切换，不能仅验证文件计数。双语文档与兼容矩阵符合当前扫描器行为。

## Consequences

受支持的项目 hooks 接入 Agent 生命周期；归一化快照属于私有运行时产物，不是复制的安装目录，重载或销毁时删除。ZCode 原生 MCP 与 hooks 格式已对照本机 3.11.2 运行时及随附官方指南核验。不具备可移植映射的代理/hooks 语义保持为明确限制。

用户禁止修改 `deepseek-harness`：宿主 LSP 注册表为全局，因此项目 LSP 给出诊断且不启用。这项独立功能不是布局扫描的前置条件。已有缓存与运行时调度记录继续适用，缓存指纹额外包含扫描开关。旧 `compat-layouts-plan.md` 包含超出本次改动的用户/全局维度工作，不能作为其交付证据。
