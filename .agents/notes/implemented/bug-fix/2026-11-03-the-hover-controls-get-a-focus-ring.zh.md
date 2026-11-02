# Agent Note：悬停才出现的控件要有焦点环

Status: implemented

## Problem

卡片上的操作是扁平图标按钮，只在悬停时画出底色。键盘用户 Tab 到其中之一时看不到任何变化：在连接器列表实测，编辑图标的 `:focus-visible` 虽然匹配，但没有任何样式，报告为 `outline: none`、无阴影。长列表末尾的「再多显示」按钮同样如此。

## Decision

- **指针能发现的控制，键盘也要在同一位置发现。** `.iconBtn:focus-visible` 与 `.moreButton:focus-visible` 画出平台的品牌色 2px 外框、偏移 2px——宿主自己的按钮就是这么画的。
- **规则靠普查样式表得出，而不是靠一条报告**：把每个带 `cursor: pointer` 类的本地样式表都查了一遍 `:focus-visible`，缺的两处补上。

## Alternatives considered

- **依赖浏览器默认焦点环。** 否决：这些按钮重置了 `border`、背景透明，UA 焦点环会落在没有内边距的 24px 方框上，读起来像一个乱入的矩形，而不是焦点状态。
- **用背景色代替外框表示焦点。** 否决：悬停底色已经表示「指针落在这行」，键盘焦点必须能与指针停在卡片上区分开。

## Consequences

- 只在悬停出现的控制，现在可以纯键盘使用而不用猜焦点在哪。
- 以后新增带指针样式的本地样式表，应照此补同一条规则；上面的普查就是要重复的检查。

## Verification

- 在 `market-dev` 实测：连接器行的编辑图标聚焦后 `:focus-visible` 为真、`outline: 2px solid`、偏移 2px，此前是 `outline: none`。
- 开关本来就有 2px 外框，未改动。
- `check:css` 报告 20 个样式表、0 条发现；全量测试通过。
