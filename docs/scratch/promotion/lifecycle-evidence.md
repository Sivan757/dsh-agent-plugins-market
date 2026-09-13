# 生命周期证据（更新版）：安装确认弹窗 + MCP 挂载/卸载 + 资源回收

> 更新时间：2026-08-24 23:31（dsh web 已重启至 0.5.1 代码，PID 53039）测试对象：cloudflare suite（`.mcp.json` 5 个 http 类型 MCP server，13 skills，2 commands）方式：Playwright（UI 弹窗流程 + API 请求拦截）+ REST API（mcp-status 挂载状态）+ state.json

## 一、安装确认弹窗（新代码 UI 验证）

通过 Playwright 在真实 dsh web 界面操作，并**拦截全部 POST 请求**：

```
点「安装」→ 弹窗出现（按钮列表含「取消」「确认安装」）
  ↓
点「取消」→ POSTs = []   ← 没有任何 /api/agent-plugins/install 请求发出
  ↓
再次点「安装」→ 点「确认安装」
  ↓
POSTs = [{"url":".../api/agent-plugins/install","body":"{\"sourceId\":\"cloudflare\",\"suiteId\":\"cloudflare\"}"}]
```

**结论：取消 = 零请求、零状态变更；确认 = 单次 install 请求（安装即启用）。**

截图：

- `evidence/cloudflare-03-install-dialog.png` — 安装确认弹窗（含「取消」「确认安装」按钮）
- `evidence/cloudflare-04-after-cancel.png` — 取消后市场页状态
- `evidence/cloudflare-05-after-confirm.png` — 确认安装后状态

## 二、MCP 挂载（启用 → 5 个 server 全部挂载）

```
安装 + 启用（enabled: true）
  ↓
GET /api/agent-plugins/mcp-status
→ entries: 5
  cloudflare/cloudflare-api
  cloudflare/cloudflare-docs
  cloudflare/cloudflare-bindings
  cloudflare/cloudflare-builds
  cloudflare/cloudflare-observability
```

## 三、MCP 卸载（禁用 → 5 → 0）

```
POST set-enabled { enabled: false }
  ↓ 3s
GET /api/agent-plugins/mcp-status
→ entries: 0
  totals: {"all":0,"connected":0,"degraded":0,"failed":0,"disabled":0}
```

**结论：禁用后 5 个 MCP server 全部从运行时卸载（http 连接断开、工具注册移除）。**

## 四、卸载 → 资源回收

```
POST uninstall { sourceId: "cloudflare", suiteId: "cloudflare" }
  ↓
state.json: installed["cloudflare/cloudflare"] = None   ← 安装记录删除
mcp-status: entries = 0                                 ← 无残留挂载
overview:   enabled suites = 9（cloudflare 不在其中）    ← 无注入
```

## 五、进程级补充证据（stdio 类型，早前采集）

cloudflare 是 http 类型 MCP（无本地子进程）。stdio 类型的进程级证据此前用自建 `lifecycle-echo` suite 采集：

- 启用后：`/bin/bash /tmp/lifecycle-mcp-suite/bin/echo-mcp.sh`（PID 51611）作为 dsh web 直接子进程出现 ✅
- 禁用后（旧代码 cache 时代）：进程残留 ⚠️ —— 该问题已在 0.5.1 修复：`mcp-mounts.ts` unmount → `handle.dispose()`，`mcp-mounts.test.ts` 断言 `disposed === true`

## 六、技能注入（启用/禁用的技能面）

- 启用 cloudflare：技能目录中出现 `cloudflare`、`wrangler`、`agents-sdk`、`durable-objects`、`sandbox-*` 等 13 个技能（本会话 skill catalog 可见）
- 禁用后：技能目录随会话更新移除（README 已知限制：技能发现无文件监听，变更经管理操作或重启后生效）

## 七、单元测试覆盖对照（维护者要求逐项）

| 维护者要求            | 测试                                                                              | 状态 |
| --------------------- | --------------------------------------------------------------------------------- | ---- |
| 拒绝/取消后不得启用   | `market-section-render.test.ts`：取消弹窗 → `postAction('install')` 未被调用      | ✅   |
| 拒绝/取消后不启动进程 | `install-gate.test.ts`：无 install 调用 → enabledSuites 为空                      | ✅   |
| MCP 禁用/卸载后停止   | `mcp-mounts.test.ts`：reconcile 收缩 → `handle.dispose()` 被调用（disposed=true） | ✅   |
| 重启恢复              | `install-gate.test.ts`：启用/禁用态跨 reload 保持                                 | ✅   |
| 禁用/卸载清理         | `install-gate.test.ts`：禁用后不注入、卸载后状态清空                              | ✅   |

## 八、待办

- [ ] Windows 验证：无 Windows 环境，README 已知限制注明（回帖 PR 时说明）
- [ ] 截图人工复核：`evidence/cloudflare-03-install-dialog.png` 等 5 张 UI 截图已生成，请用户目检
