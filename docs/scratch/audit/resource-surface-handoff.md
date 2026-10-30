# 资源列表合并：交接说明

状态截至 `dev` @ `b70a219`。目标未完成，剩余工作在下面按可执行顺序排列。

## 已完成

- `ui/ResourceSurface.tsx`：唯一渲染器，契约类型 `ResourceEntry` / `ResourceCapabilities` / `ResourceSurfaceProps`。交互语义：卡片点击 = 打开详情；开关独立且 `stopPropagation`；卡片无 `aria-pressed`；破坏性操作只在详情内。
- 已迁入的列表：`features/instructions`、`features/output-styles`、`features/extension-presets/ResourceList`、 `features/hooks/StatusPanel`、`features/lsp/LspStatusPanel`（后两者删除了私有卡片组件）。
- 一致性测试：`packages/market-ui/test/resource-surface.test.ts`（契约 + 键盘）、 `resource-surface-parity.test.ts`（两表面 DOM 与点击语义）。
- 门禁：`scripts/check-single-renderer.mjs`（ratchet），已接入 `check:refactor`。
- parity 报告：`docs/scratch/audit/resource-surface-parity.md`（含成本对比与单实现实测）。

## 剩余三个存量

`ui/UserPanelSurface.tsx`、`features/mcp/StatusPanel.tsx`、`features/market/MarketSection.tsx`。

迁移顺序建议 MCP 先行，并且**测试先行**：

1. 改 `packages/market-ui/test/mcp-status-render.test.ts`：卡片点击开详情、开关独立、删除在详情内；
2. 给 `McpDetailModal` 加 `onDelete`（上一轮已写好又回退，可直接复用思路）；
3. 再把 `StatusPanel` 的工具栏 + `McpCard` 换成 `ResourceSurface`（能力位：toggle、onEdit）；
4. `check:css` 会报出 `.toolbar`、`.empty`、`.monoLine` 变死代码，一并删除；
5. 从 `check-single-renderer.mjs` 的 `REMAINING` 删除该条目，跑 `pnpm run check:refactor`。

`UserPanelSurface` 的坑：详情对话框渲染在 `document.body`，测试助手只在 `host` 内查找按钮，必须先扩助手作用域，再断言详情内的编辑/删除。

## 未取得的验收证据

- 29 条真实数据 × 3 视口宽度 × 明暗主题的截图与溢出测量（需 Chrome DevTools MCP 打开 DSH GUI，带 token 的 URL）。
- 黄金截图测试。
- 构建产物"只有一份卡片 CSS"：本仓库 client 构建不产出独立 `.css` 文件，需要改用其他可观测指标（例如打包后 JS 中卡片类名定义只出现一次），否则这项验收无法按原措辞验证。
- 独立 dsh profile 安装并发起会话，验证注入上下文。

## 常用命令

```sh
pnpm run check:refactor     # 全部门禁（含 check:single-renderer）
pnpm exec vitest run <files>
node scripts/check-single-renderer.mjs
```
