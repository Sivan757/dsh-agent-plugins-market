# Agent Note：每一行只有一个展开控件

Status: implemented

## Problem

带标题栏操作的详情行会为同一个展开区渲染两个可聚焦控件：名称条（`actionToggle`）和尾部一个以行名命名的箭头按钮，两者都带 `aria-expanded`、都调用同一个 `onToggle`。读屏会把这一行读两遍，状态与动作都一样，而且两个按钮都没说它控制的是哪块内容。

## Decision

- **箭头是同一件事在指针一侧的样子。** 它改为表现型 span：鼠标仍可点，退出 Tab 顺序与无障碍树。名称条成为唯一的控件——行自己的文字本来就在那里。
- **展开控件给自己的内容命名。** `DetailRow` 为内容生成 id，展开时设置 `aria-controls`，读者可以直接跳到刚刚展开的内容。

## Alternatives considered

- **把箭头命名为「展开 _行名_」。** 否决：同一个动作的两个控件仍然是两个停点、两次播报，怎么命名都一样。
- **干脆去掉箭头。** 否决：尾部箭头是原型画的交互提示，也是指针瞄准的目标。
- **只在带标题操作的支线给内容加 id。** 否决：普通支线是同样的关系，只是会悄悄漂移。

## Consequences

- 每个展开行一个 Tab 停点、一个 `aria-expanded`、一次播报。
- 指针用户仍可从尾部切换。
- 带与不带标题操作的行向读屏暴露同样的关系。

## Verification

- `packages/market-ui/test/detail-row-disclosure.test.ts` 渲染带标题操作的行，断言只有一个 `aria-expanded` 按钮、点击仍能切换、没有第二个以行名命名的按钮，且展开后的 `aria-controls` 指向包含内容的元素。
- 四个类型检查与 `check:refactor` 通过。
