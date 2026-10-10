# Agent Note: 预设管理器带上与设置页一致的原文/译文开关

Status: implemented

## Problem

每个设置页都在工具条尾部放一个原文/译文开关：点一次即在译文与作者原文之间翻转描述。预设管理器渲染了同一条工具条、同一套卡片与同一批详情弹窗，却没有这个开关。想要看原文的读者只能离开管理器去设置页，而管理器的卡片只显示译文，没有任何回到原文的入口。

管理器无法直接把这个控件加上了事。`ExtensionResource` 只携带一个 `description`，而且清单在过线之前就已经把它解析掉了：市场行取的是概览里已经本地化的文本，面板行取的是 `entry.translatedDescription ?? entry.description`。一个字段翻转不起来，因为客户端拿到该行时作者原文已经消失。

## Decision

管理器渲染共享开关，线上同时携带两份文本。

`ExtensionResource` 在 `description` 旁边新增可选的 `translatedDescription`，而 `description` 现在承载作者原文。清单把两份都透传：市场行取概览的 `description` 与 `translatedDescription`，面板行取 `entry.description` 与 `entry.translatedDescription`。没有译文的行不带第二个字段，因此未翻译的行与过去完全一样地渲染作者原文。

`ResourceList` 在工具条的 `beforeView` 槽位渲染 `BilingualToggle`——与设置页各面板同一个槽位、同一个组件——并通过 `displayText(row.translatedDescription, row.description, t, { original: !enabled || showOriginal })` 解析每张卡片的文本。这正是其它所有界面共用的那条渲染期规则，因此管理器不会与它们分叉。

`ExtensionPresetEntry` 持有这个视图状态，正如 `MarketSection`、`UserPanelSurface` 与 `McpStatusPanel` 各自持有自己的那份，并通过 `ExtensionDetailProps.showOriginal` 传给详情弹窗。因此从管理器打开的套件详情渲染的文本与它背后的卡片一致。该开关只是展示状态：它不会进入线上请求、不会进入选择、也不会进入 URL，点击不会发起任何翻译读取。

搜索同时匹配两份文本，因此看过译文的读者在翻转之后仍能找到该行，反之亦然。

## Alternatives considered

- **在客户端按需翻译来翻转文本。** 否决：该开关只是对服务端已经解析好的文本换个视图，让 provider 去翻译一份已经缓存的内容，等于花额度复现面板手上已有的字符串。
- **只保留一个字段，存当前显示的那份文本。** 否决：那样字段就承载了展示偏好，同一行的两个读者会读到不同结果，保存的预设也会继承当时屏幕上恰好显示的那一份。
- **让每张卡片各自带一个开关。** 否决：设置页确立的是每页一个视图，逐卡片开关会让同一个点击在同一个列表的两张卡片上含义不同。
- **把 `beforeView` 挪作第二个视图控件。** 否决：`beforeView` 按构造就是文本视图的座位，设置页各面板本来就把同一个控件放在那里。
- **只发译文，作者原文留在详情读取里。** 否决：卡片翻转需要作者原文，而为每次点击多发一次读取会让一次展示翻转付出一次请求的代价。

## Consequences

- 管理器现在读起来与设置页一致：同一条工具条、同一个开关、同一个尾部位置。
- 每个管理器行多携带一个可选字符串。有译文的行，其载荷增加一段译文长度，而这段文本概览与面板列表本来就已持有。
- `description` 在这条线上改变了含义：它原本是解析后的展示文本，现在是作者原文。所有消费方都经由 `displayText` 解析，因此直接读 `description` 的消费方现在会显示作者原文。`ResourceList` 是唯一的这类消费方。
- 翻转视图的读者会保持该视图直到弹窗关闭。该状态刻意不做持久化，与设置页各面板一致。

## Testing

`tests/extension-suite-inventory.test.ts` 固定市场行与面板行各自携带两份文本，并固定未翻译卡片不带第二个字段。`tests/bilingual-toggle.test.ts` 断言管理器的开关翻转卡片文本而名称不变，并断言点击是向上报告而不是翻转本地状态。`tests/client-extension-preset-v5.test.ts` 打开真实的管理器弹窗，断言开关位于尾部集群中、紧邻网格/列表按钮，并通过它翻转一张卡片。
