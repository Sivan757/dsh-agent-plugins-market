# Agent Note：分段轨道命名它所在的页面，而不是其中某个页签

Status: implemented

## Problem

设置页的分段轨道用的是市场页签自己的名字：`PluginWorkspace` 给 `TabRail` 传了 `label: labelKeys.market`，而轨道把这个字符串同时用作 `aria-label` 和两个步进按钮的前缀。读者在连接器页时，页签列表播报的是「市场」，步进按钮也读作「市场 · 向后一个」，无论打开的是哪一段。同一个错误对象随共享轨道传到每个界面。

## Decision

- **轨道命名它所在的设置页。** `label: t('nav')`——「Agent 扩展」，正是设置导航给这一页的名字。步进按钮继承它，现在读作「Agent 扩展 · 向后一个」。
- **钉住旧名字的测试随之更新。** `client-workspace-tabs.test.ts` 原本断言 tablist 叫 `workspaceTabMarket`，现在断言页面名，并写明理由。

## Alternatives considered

- **按当前选中的页签命名轨道。** 否决：以自己选中项命名的页签列表等于把同一件事说两遍，而且会随读者移动而变化。
- **给轨道新加一个键。** 否决：这一页已经有名字，同一页两个名字必然漂移。

## Consequences

- 读屏先听到「Agent 扩展，页签列表」，再听到各个页签，滚动控件读作「Agent 扩展 · 向后一个」。
- 任何给这一页新增分段的界面都自动获得正确的轨道名。

## Verification

- `packages/market-ui/test/client-workspace-tabs.test.ts` 断言轨道的可访问名是页面名。
- 在 `market-dev` 实测：`tablistLabel: "Agent 扩展"`、步进按钮 `"Agent 扩展 · 向后一个"`（改前两者都是「市场」）。
