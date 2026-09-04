# Agent Note: 市场套件卡片启用平台设计语言的状态示能

Status: implemented

## Problem

市场套件卡片在两处偏离了 harness 自身的卡片语言：

1. **客户端 CSS 使用了 11 个 harness 主题从未定义的 `--dsw-*` 自定义属性。** 它们是插件接入平台配色之前的遗留物（`--dsw-alias-bg-hover`、`--dsw-alias-bg-selected`、`--dsw-alias-bg-success`/`-warn`/`-error`、`--dsw-alias-state-neutral`、`--dsw-alias-danger`、`--dsw-alias-text-2`、`--dsw-alias-accent`、`--dsw-alias-border`）。运行时没有任何地方定义它们，所有 fallback 永久生效——包括暗色模式下永不适配的硬编码灰色。规范 token 集在 harness checkout 的 `packages/client/ui-theme/src/styles/design-platform.css`。
2. **套件卡片的已安装状态在网格扫视距离内不可见。** 安装状态仅由标签行里的文字徽章（`✓ 已安装`）承载，刷新/卸载操作是 ghost `Button`（图标外包裹按钮外框），启用开关夹在操作簇中间。MCP 状态页早已用同场景方案解决了这个问题：左侧彩色边条加尾部开关。

## Decision

- **Token 对齐。** 所有未定义 token 重映射到 design-platform 对应物（fallback 同步更新为平台亮色值）：`bg-hover`/`bg-active` → `interactive-bg-hover`/`-active`；`bg-selected` → `state-business-tertiary`；`bg-success`/`bg-warn` → `state-success-tertiary`/`state-warn-tertiary`；`bg-error` → `interactive-bg-hover-danger`；`state-neutral`（开关关闭态轨道）→ `label-dimmed`（harness 自家开关轨道用 `border-l2`，在本控件 38×22 的尺寸下过淡）；`danger` 按语境拆分——警告框 → `state-warn-label`，破坏性悬停 → `state-error-primary`；`text-2` → `label-secondary`；`accent` → `brand-primary-new-colorprimary-new-color`；`border` → `border-l2`。
- **卡片示能对齐 MCP 卡片。** 已安装套件带 3px 左侧边条——启用为 success 绿、停用为 `label-tertiary` 灰；未安装无边条。卡片同时获得 MCP 卡片的悬停处理（border-l3、interactive-bg-hover、柔和阴影），因为整卡点击即进入套件详情。
- **操作扁平化。** 刷新与卸载改为内联扁平图标按钮（透明底、悬停 `interactive-bg-hover`、卸载带破坏性悬停着色），几何沿用 harness `Button` ghost 规格；启用开关移到卡片最右侧。安装/添加源 CTA 保持主色文字按钮。
- **`✓ 已安装` 徽章移除**——安装状态由边条承载、启用状态由开关承载，再用文字复述两者属于冗余。`installedBadge` 保留在 locales（套件详情面板仍在用），surface 计数标签移到 `source · layout` 之下独立成行。

## Alternatives considered

- 在插件内本地定义这 11 个遗留 token（兼容样式表）被否决：那会把调色板从平台上分叉出去，而平台已为每种用途提供正确的 alias。
- 在边条旁保留文字徽章被否决：同一状态两套编码必然漂移，且该徽章是标签行里身份标签与状态混排的唯一原因。
- 图标操作复用 harness `Button` 组件的 `variant: 'ghost'` 被否决：它会给纯图标内容加胶囊外框，恰恰是本次重构要去掉的盒子。

## Risks

- 开关关闭态轨道变色（`#d1d5db` → `label-dimmed`）；亮色模式下略浅，但暗色模式从此正确适配。
- 套件卡片现在在卡片点击本已生效的位置显示悬停示能；行为不变，仅可发现性提升。

## Verification

- `grep` 审计：`src/client` 中不再有落在 `design-platform.css` 定义集之外的 `var(--dsw-*)` 引用。
- 变更后 `pnpm run typecheck`、`lint`、`format:check`、`test:contract` 全绿。
