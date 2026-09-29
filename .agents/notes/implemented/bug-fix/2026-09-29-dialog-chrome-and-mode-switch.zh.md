# Agent Note: The service editor's dialog chrome after the control migration

Status: implemented

## Problem

新建服务弹窗上暴露了两个缺陷。

**表单 / JSON 切换的指示块偏离了选中段。** 收敛到宿主控件时，调用仍然把 `formCss.seg` 传进 `className`，而 `.seg` 是给传输方式那一组手写轨道的样式：`display: inline-flex`、`gap: 2px`、`padding: 2px`、1px 边框，外加针对自家按钮的 `button` 规则。宿主控件是 `inline-grid` 配 `grid-auto-columns: 1fr`、`padding: 4px`，指示块绝对定位，宽度与位移正是按这几个数字算出来的（`(100% - 8px - 2px * (count - 1)) / count`、`translateX(index * (100% + 2px))`）。这层覆盖让两段按内容宽度排在一条被拉满的轨道里，而指示块仍按整条轨道的一半计算，于是它落在离自己标签几百像素的地方。`.seg button` 的优先级（0,1,1）也高过宿主的 `.tab`（0,1,0），把平台 28px 的标签页换成了手写的 24px。

**标题与第一个控件之间空了 32px。** 宿主 Modal 给内容盒 20px 上边距，因为它的设计假定标题下有一句说明；再叠加头部自己的 12px 内边距。市场经 `DetailModal` 打开的每个弹窗都没有说明，两者相加就在标题下留出一个控件行高的空洞。

## Decision

**宿主绘制的控件只接布局类。** `SegmentedControl` 保留自己的轨道、标签页与指示块几何；编辑器改传 `formCss.segSelf`，它只有一条声明 `align-self: flex-start`，让控件在纵向表单列里保持内容宽度，而不是被拉满整列。`.seg` 轨道留给它本来是为之而写的两个控件——MCP 传输方式选择与工作区编辑器的视图切换——两者都是手写的 `aria-pressed` 分组，不是 tablist。

**没有说明的弹窗清掉宿主正文上边距。** `description` 缺席时 `DetailModal` 挂上 `compactTop`，`detail.module.css` 用工作区编辑器在 `panel.module.css` 里同样的 `[class*='content'] > [class*='body']` 选择器把宿主正文的 `margin-top` 归零。标题到第一个控件于是只剩头部自己的 12px。确实带说明的弹窗保留宿主间距。

## Alternatives considered

**保留 `.seg`，改宿主内部样式直到两者一致。** 指示块的算式、标签页高度与字号都要重新写一遍，一个类还要同时表示两种控件。否决：覆盖一个面板的 tablist 与 `aria-pressed` 取值组是两种语义，而前者的样子平台已经拥有；宿主日后改动那套几何时，最先踩中的会是市场这份副本。

**让宿主控件拉满、并把两段对齐成各占一半。** 轨道会与传输方式选择一致、指示块也重新正确——代价是出现一个 592px 的两段视图开关，平台其它界面没有这种形态。

**自绘弹窗标题栏来控制间距。** `headless` 会把标题行、关闭按钮和无障碍接线都交给我们自己实现，而这些宿主已经提供。否决：为一条间距规则给六个弹窗重写外壳并不划算。

**改共享外壳的弹窗 gap，而不是正文上边距。** 宿主的 `.dialog` gap 在正文与底部之间，不在标题之下，产生不了这次报的那个空洞；收紧它只会悄悄改掉每个市场弹窗的底部间距。

## Consequences

- 模式切换变成一条紧凑的、平台绘制的轨道：两段等宽，指示块压在选中标签上，标签页 28px。
- 没有说明的市场弹窗打开时，标题到第一个控件是 12px；带说明的弹窗保留宿主 20px 的正文上边距。
- 市场弹窗就此在这一条规则上偏离宿主外壳，且依赖一个结构性选择器——宿主重构会让它静默失效，这份暴露工作区编辑器本来也有。

## Testing

- 在一个复现页里量几何：加载宿主的 `Modal.module.css` 与 `SegmentedControl.module.css`（0.2.0-rc.1）以及本仓库的 `detail.module.css` 与 `form.module.css`。修复前 592px 的轨道里，290px 的指示块压着 44px 的标签；修复后 145px 的轨道里，67px 的指示块正好压在 67px 的标签上，标题到控件的间距实测 14px（此前 34px）。
- `tests/client-detail-editors.test.ts` 与 `tests/client-server-config-policy.test.ts` —— 切换控件两个方向仍然驱动同一份文档。
- 两处修复都无法被 jsdom 测试看见：本仓库的客户端测试把 CSS modules 打桩成 `{}`，被测的类名根本到不了 DOM。

## Related

[One form shape and one top gap for the workspace editors](../feature/2026-09-16-workspace-document-editor-single-view.md) 拥有「无说明的弹窗去掉正文上边距」这条规则，本记录把它延伸到共享弹窗外壳。
