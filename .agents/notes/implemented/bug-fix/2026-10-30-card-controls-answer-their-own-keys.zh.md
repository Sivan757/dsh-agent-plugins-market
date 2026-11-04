# Agent Note：卡片里的控件能自己响应键盘

Status: implemented

部分被[卡片区域笔记](../feature/2026-10-30-card-is-a-region-with-one-opener.zh.md)取代：卡片不再处理键盘事件，下面记录的守卫已无可守。三处命名决定（开关名、筛选条名、视图切换）仍然有效。

## Problem

共享列表的无障碍评审发现卡片的键盘处理吞掉了卡片内部的控件。`interactiveCardProps` 给卡片加了 `role="button"` 和一个 keydown 处理器：按 Enter 或空格时调用 `preventDefault()` 并打开条目。编辑按钮和每个图标动作只阻止了 click、没有阻止 keydown，于是在**编辑**上按 Enter 会冒泡到卡片，按钮自身的激活被取消，结果打开的是详情而不是编辑器：任何界面上，键盘用户都无法编辑或执行图标动作。

同一次评审还在同一个操作簇周围发现三处命名问题：每个开关只叫「启用/停用」而不说哪一行（约 971 个无法区分的开关）；筛选页签条把搜索框的名字当成了自己的可访问名（「搜索插件…」）；视图切换读作「切换到列表, 按下」——动作名配上表示相反含义的按下状态。

## Decision

- **键事件指向哪个控件，就归哪个控件。** 卡片处理器当时除非 `event.target === event.currentTarget` 否则直接返回，判断放在 `interactiveCardProps` 里，所有界面的所有卡片一次获得。现在卡片已是普通区域、只有名字按钮，没有键盘处理需要守卫。
- **开关同时说动词与对象。** `toggleLabel + ' ' + name`（「停用 firebase」），正是旁边编辑按钮早已采用的形状。
- **筛选条自己命名。** `ResourceSurface` 接受 `filterLabel`（默认取新增的「按状态筛选」/"Filter by status" 键），不再借搜索框的标签当 tablist 的名字。
- **视图切换只陈述动作，不陈述模式。** 去掉 `aria-pressed`；名字继续说明点击去向，模式由 `data-view-switch` 承载，供需要读它的代码使用。

## Alternatives considered

- **在每个内部按钮上阻止 keydown。** 否决：渲染器里五处调用点、将来还会有更多，这道判断属于卡片处理器本身。
- **保留 `aria-pressed`、把开关改名为模式（「网格视图」）。** 否决：同一个控件会因状态而有两种含义，而面板词典里本来就是动作措辞。
- **开关只用行名命名。** 否决：「firebase」不说明按下它会发生什么；动词才是改变状态的那部分。

## Consequences

- 每个图标动作与编辑器重新可以用 Enter 和空格触达。
- 读屏读到一个开关时，能听到它属于哪一行。
- 筛选条被读作筛选，而不是搜索框。
- 需要不同筛选名的界面可以自己传，默认值适配当前所有调用点。

## Verification

- `packages/market-ui/test/resource-surface.test.ts` 在编辑按钮上按 Enter，断言详情没有打开、编辑发生了，并断言开关的可访问名是「动词 + 条目」。
- `packages/market-ui/test/filter-toolbar.test.ts` 断言视图切换的名字陈述动作、没有按下状态、模式放在 `data-view-switch` 里。
- 四个类型检查、`check:refactor` 与全量测试通过。
