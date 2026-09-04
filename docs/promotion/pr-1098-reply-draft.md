两段记录补上了，附真实日志。

**1. 重启恢复**：dsh web 重启（PID 12267 → 29636）后，`lifecycle-hooks` suite 按 state.json 原样恢复为 installed + enabled，hooks bridge 自动重挂载——日志中 `1787991505` 起的时间戳全部来自重启后的工具调用。MCP 侧早前也验证过：cloudflare suite（5 个 HTTP server）跨重启保持 enabled 并自动重挂载。

**2. hooks 禁用后停止**，真实日志（fixture 的 PreToolUse 每次工具调用追加一行时间戳）：

```text
[lifecycle-hooks] fired at 1787979008   ← 启用期间
[lifecycle-hooks] fired at 1787979033
[lifecycle-hooks] fired at 1787979050
[lifecycle-hooks] fired at 1787979066   ← 最后一次触发
（禁用：state → enabled:false；此后 agent 连续工具调用，日志零新增）
[lifecycle-hooks] fired at 1787991568   ← 重新启用，恢复触发
[lifecycle-hooks] fired at 1787991586
[lifecycle-hooks] fired at 1787991601   ← 再次禁用后同样冻结
卸载：state 条目删除、挂载清零，后续零新增
```

MCP 侧此前已给过（Cloudflare 5 → 0、卸载无残留）。两轮 rebase 后基于最新 dev（rank 44，两项 gate 通过），Windows 无机器维持原说明。

请复审。
