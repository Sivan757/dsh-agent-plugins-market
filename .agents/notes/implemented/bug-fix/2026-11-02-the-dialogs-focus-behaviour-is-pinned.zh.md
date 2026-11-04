# Agent Note：把对话框的焦点行为钉住，而不是靠运气

Status: implemented

## Problem

键盘可达是唯一没从外部验证过的无障碍属性。每个详情弹窗都是建在宿主 `Modal` 上的模态，焦点陷阱由宿主负责——但本仓库从没有断言过：弹窗打开时是否接收焦点、Escape 是否把焦点还给打开它的那张卡片。这里的回归对鼠标用户不可见，对键盘用户却是阻断性的。

## 检查发现了什么

在 `market-dev` 的连接器面板实测：打开一行的详情后焦点落在弹窗的关闭控件上（`focusInsideDetail: true`），按 Escape 关闭，焦点回到打开它的卡片（`backOnCard: true`）。宿主的模态做了它该做的事。

## Decision

- **在属于面板的地方把它钉住。** `mcp-status-render.test.ts` 打开详情、断言活动元素在弹窗内、派发 Escape、再断言弹窗消失且焦点回到卡片。它在 jsdom 里也能通过，于是这个保证存在于测试套件里，而不只是这份报告里。

## Alternatives considered

- **在共享 UI 的测试里断言一次，而不是逐面板。** 暂时否决：各详情弹窗是独立组件、各自接线开关，而连接器面板是其它服务面照抄的那一个。

## Consequences

- 详情弹窗若不再接收焦点、或不再归还焦点，测试会失败。
- 另外四个弹窗仍未断言；后续可以照抄这三行。

## Verification

- 上面的实测；`packages/market-ui/test/mcp-status-render.test.ts`（15 条）在新用例下通过；四个类型检查、`check:refactor` 与全量测试通过。
