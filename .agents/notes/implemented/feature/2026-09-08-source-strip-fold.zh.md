# Agent Note：等宽源胶囊网格，就地折叠

Status: implemented

## 问题

市场页头部把每个源渲染成一枚胶囊，装在会自动换行的网格里（`repeat(auto-fill, minmax(118px, 1fr))`）。注册 20 个源时，这条胶囊带长到六行（约 164px）；再叠加未登记仓库提示行与工具条间距，固定头部高度约 208px——而 `.header` 是 `flex-shrink: 0`，这笔开销全部由卡片区承担。同一批胶囊还为收编源带上了 `已收编` 徽标，把一个实现细节（`.sources/<id>` 目录被就地登记）说成了用户可见状态；同时首枚 `全部 754` 与同屏工具条里的 `全部 754` 重复。

## 决策

- **胶囊带仍是等宽网格。** `.sourceTabsRow` 保留 `repeat(auto-fill, minmax(118px, 1fr))`，同一行里每枚胶囊等宽，长 id 省略而不是把列撑开。承载方式是网格本身——不是下拉菜单，也不是横向滚动条。
- **网格折到两行，并在原地展开。** `.sourceTabsRowFold` 以 `max-height: 52px` + `overflow: hidden` 封顶（两枚 24px 胶囊加 4px 间距），其下是一枚右对齐的文字开关（`展开全部` / `收起`，`.sourceFoldToggle`）用于解除封顶。`SourceTabsRow` 用网格 `scrollHeight` 与折行高度比较来判断是否需要开关，因此不涉及逐枚胶囊测量；两行放得下时根本不会渲染开关。
- **当前选中的源始终可见。** `MarketSection` 的排序为：`全部` 第一、选中源第二、其余按 id。折叠因此不会藏起当前筛选范围及其编辑/删除操作。
- **胶囊自己承担文字的左右内边距。** `.srcTab`/`.srcTabOn` 设 `padding: 0 10px`，`.srcTabMain` 不再自带内边距，所以无论有没有尾部的 `✎`/`×` 操作，文字左右两侧都保持同样的 10px 间距；这些操作只额外贡献 4px 的间距。
- **不再展示收编徽标。** 胶囊只保留 `本地` / `压缩包`；收编 checkout 只是管理器恰好拥有的存储，不是用户可选的状态。两份字典中的 `sourceAdopted` 已删除。
- **未登记提示靠处理目录来清除，而不是靠忽略。** `unmanagedSources()` 只列出 `.sources/` 下真实存在且未登记进 `state.json` 的目录，因此删除或收编后该行自行消失；「忽略」动作仍未实现。

## 已考虑的替代方案

- **单行 `+N` 溢出菜单** —— 先实现过，随后被否决：下拉把源藏在一次额外交互之后，而要求是留在页面上、等宽的胶囊。
- **单行横向滚动** —— 能保留全部胶囊，但在设置页头部做横向滚动比换行更糟，且被藏起来的胶囊与进菜单一样不可达。
- **内部纵向滚动（`max-height` + `overflow-y: auto`）** —— 已在 [workspace-tabs 笔记](2026-09-06-workspace-tabs-user-panels.zh.md)中因嵌套滚动条抖动被否决；在头部再引入一个会重演该问题。
- **只渲染前 N 枚胶囊来折叠** —— N 取决于响应式列数，需要逐枚测量；在行边界裁剪网格零成本，且不会把胶囊裁掉一半。
- **保留 `已收编` 徽标** —— 它只回答实现自己的问题，而且它暗示的删除语义此前被写错了。

## 影响

- 折叠态占 52px 加约 18px 的开关行；展开态回到网格自然高度，因此常见情况下卡片区拿回了空间。
- 只有当网格超过两行时才出现开关，源少时不会留下无意义的占位。
- 未选中源时，胶囊带的 `全部` 与工具条的 `全部` 文案仍相同；变化只在胶囊顺序——选中源会移到第二位。
- 本次同时修正了「已收编目录受删除保护」这一过时表述（README、使用指南、官网 FAQ、`removeSource` 的 JSDoc 以及两篇 Agent Note）：`removeSource(id, deleteCheckout)` 会删除 `.sources/<id>` 下的 checkout（包括已收编的），只有指向 `.sources/` 之外的 `local` 源受保护。

## 验证

- `tests/market-section-render.test.ts` 固定：收编源与普通源同样渲染、不渲染收编徽标、无法测量时（jsdom）保留全部胶囊且不渲染开关。
- `pnpm run check:refactor` 与 `pnpm run test`。

## 关联

- 沿用 [2026-09-01-source-acquisition-expansion](2026-09-01-source-acquisition-expansion.zh.md) 的来源词汇，未改动其收编语义。
- 保持 [2026-09-02-market-card-platform-affordances](2026-09-02-market-card-platform-affordances.zh.md) 的卡片侧交互不变，本次只改头部胶囊带。
