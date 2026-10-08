# 按项目维度的 surface 开关

日期:2026-10-03 · 状态:已实现 · 覆盖面:market、skills、commands、agents、mcp、lsp

当前范围：会话预设负责新会话授权。本记录保留旧全局存储与兼容接口的理由。[策略稳定性决策](../architecture/2026-10-08-policy-and-recovery-stability.zh.md)以统一负责人替代独立可变 surface 状态及不刷新的写入。

## 决策

六类插件 surface 各自携带按 workspace 的开关,状态存全局——插件 data root 下按 workspace 绝对路径哈希键控——绝不写进项目目录。会话框控制条(宿主 slot `conversation.input.left`)写开关后走普通 reconcile 链,开关卸载或重挂的是真实 surface,而不是把 UI 藏起来。

## 为什么是这个形态

- **全局存储、哈希 workspace 键**:开关是"这个用户对该项目的意见";同一仓库的两个 checkout 各持独立意见,且任何路径都不会泄进文件名。
- **闸在挂载数据流而非 UI**:每个 surface 在它自己产出数据的地方应答自己的开关,且所有座位在开关切换中保持存活、无需重注册。skills 经 `ToggledSkillProvider` 返回空列表——它同时包住两个贡献者:套件 provider 与用户自己的面板条目;角色列表折叠为空。MCP、commands 与 LSP 的套件挂载在 reconciler 各自的挂载分支里读开关:enabled-suite 列表从不被过滤,因为三者都从同一份快照挂载,为某一个开关丢掉套件会连带拆掉它在另外两个 surface 上的挂载。同一道闸也覆盖项目维度贡献者,因此 commands 或 MCP 关闭时项目侧挂载同样归零,commands 关闭时会释放用户面板的命令注册而不是跳过该轮。LSP 另有直连服务表归零,所以直连行与套件挂载都归零。market 路由则完全不挂载。
- **六面彼此正交**:MCP 与 LSP 共用一份套件快照,但不共用开关。关闭 MCP 会把 MCP 挂载 reconcile 到零个服务,而同一批套件保留其语言服务器;LSP 反之。开关经普通 reconcile 链抵达挂载分支。
- **宿主 slot 而非自建面板**:`conversation.input.left` 是无占用、零替换风险(replaceRisk none)的增量座位,渲染位置正是用户要求的地方——会话框旁。

## 考虑过的替代方案

- **宿主 settings namespace 做存储**:不满足需求——该 namespace 是插件配置形态(宿主设置页服务的类型化 volatile 引用),而开关是按 workspace 的行,不应变成六个全局配置字段。
- **开关时重注册 provider**:放弃——座位是稳定的,变化的只是它们供给的数据,重注册只会让宿主注册表无谓抖动。
