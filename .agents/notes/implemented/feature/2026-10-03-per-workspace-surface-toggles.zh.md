# 按项目维度的 surface 开关

日期:2026-10-03 · 状态:已实现 · 覆盖面:market、skills、commands、agents、mcp、lsp

## 决策

六类插件 surface 各自携带按 workspace 的开关,状态存全局——插件 data root 下按 workspace 绝对路径哈希键控——绝不写进项目目录。会话框控制条(宿主 slot `conversation.input.left`)写开关后走普通 reconcile 链,开关卸载或重挂的是真实 surface,而不是把 UI 藏起来。

## 为什么是这个形态

- **全局存储、哈希 workspace 键**:开关是"这个用户对该项目的意见";同一仓库的两个 checkout 各持独立意见,且任何路径都不会泄进文件名。
- **闸在挂载数据流而非 UI**:skills 经 `ToggledSkillProvider` 返回空列表,MCP 调度器对空 suite 列表做 reconcile,LSP 提供空服务表,用户命令 reconciliation 提前返回,角色列表折叠为空,market 路由不挂载。每个 surface 的座位在开关切换中保持存活,无需重注册。
- **宿主 slot 而非自建面板**:`conversation.input.left` 是无占用、零替换风险(replaceRisk none)的增量座位,渲染位置正是用户要求的地方——会话框旁。

## 考虑过的替代方案

- **宿主 settings namespace 做存储**:不满足需求——该 namespace 是插件配置形态(宿主设置页服务的类型化 volatile 引用),而开关是按 workspace 的行,不应变成六个全局配置字段。
- **开关时重注册 provider**:放弃——座位是稳定的,变化的只是它们供给的数据,重注册只会让宿主注册表无谓抖动。
