# Agent Note: 持久化子代理目录与角色执行

Status: implemented

## Problem

角色定义通过生成的 `agent-`、`persona-` 名称暴露为技能候选和斜杠命令，混合了角色委派与指令加载，且与 `market_agent` 列表操作重复。角色思考强度没有传给子代理。

## Decision

`runtime/subagent-catalog.ts` 遵循 DSH `tool-skill` 目录算法：异步 `agent/pre-step` 监听、准确工具可见性、稳定条目摘要、完整替换消息、持久化 `source.entries`，以及通过会话可见内容恢复状态。使用独立的 `subagent-catalog` 来源与双语角色调用指引。移除全部角色时明确让旧目录失效；读取不完整时不发布部分快照；销毁后不允许迟到的发布。

`subagent_run(agent, prompt)` 替代 `market_agent`，不保留旧名别名或 `action` 参数。目录摘要与执行共用严格角色解析。执行器解析供应商/模型及可选的 `reasoning_effort`（别名 `reasoningEffort`），通过 `llm.resolveCallConfig` 校验有效路由，再调用现有一次性 `spawn` 服务并传入 persona 和工具限制。继承值以父代理最近一次请求配置为准；仅路由未变时继承未声明的思考强度。宿主运行时策略仍具有最终约束力。

**已被[基于宿主 continuation seam 的角色委派](2026-09-10-agent-role-delegation-via-host-continuation.zh.md)部分取代。** 目录发布、角色身份与严格解析继续有效。委派由一次性改为可继续且异步；执行器只应用精确的 `provider` + `model` 组合，其余声明一律降级为继承；`tools` / `disallowedTools` 不再生效。

套件/项目角色和用户角色退出两个技能提供者，并移除角色生成的斜杠命令，保留管理面板和文件。限定角色 ID 同时保留 `reviewer.md` 与 `reviewer.agent.md`，不再适用生成别名的冲突规则。普通技能或命令本身使用这些前缀的，仍是普通资源。项目发现继续依据调用会话及扫描开关。

本记录部分替代[用户面板](../feature/2026-09-06-workspace-tabs-user-panels.zh.md)的角色作为技能决策，以及[布局注册表](2026-09-09-layout-registry.zh.md)的别名投影；其存储、界面与项目作用域决策继续有效。已有 `dsh-llm` 开发依赖同时声明为运行时 peer，复用宿主不可变消息构造器，无需新包或宿主修改。

## Alternatives considered

**采用动态系统提示词上下文。** DSH 支持，但用户明确要求 skills catalog 机制，包括持久化目录来源与 pre-step 准入。

**保留角色技能或列表操作。** 会继续重复发现，让模型在加载 persona 与实际委派之间选择。

**直接使用通用 subagent 工具。** 它没有按角色 ID 查找并应用已保存配置的能力，仍需角色执行器。

## Consequences

角色编辑器提供思考强度选择框，通过现有 model-catalog 接口调用具体模型的 `resolveModelInfo`。切换供应商/模型会清除旧强度，暂不可用的已保存值仍可显示及移除。编辑统一写入 snake_case 键，不保留冲突别名。选项来自宿主声明，不硬编码跨供应商通用等级。

旧调用方需要改用 `subagent_run` 并移除 `action`；新组成的会话不再生成角色斜杠条目。摘要或模型配置变更在下一模型 step 发布，进行中的请求和子代理保留已接受配置。角色指令正文仅在执行时加载。目录是持久化上下文，不是隐藏数据。外部文件发现沿用 TTL/刷新机制，没有文件监听；后台继续执行不在本次范围，现由[基于宿主 continuation seam 的角色委派](2026-09-10-agent-role-delegation-via-host-continuation.zh.md)承接。

测试使用真实 DSH 会话、作用域和工具注册表验证发布、恢复、fork、压缩、限制、同名工具替换与销毁；真实文件覆盖用户/套件/项目变更。执行器测试覆盖模型路由、强度别名、最近请求继承、非法强度预检，以及创建子代理前取消。宿主仓库保持只读。
