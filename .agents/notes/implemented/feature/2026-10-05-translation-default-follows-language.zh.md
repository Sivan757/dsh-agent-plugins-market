# Agent Note: 翻译开关默认跟随界面语言

Status: implemented

## Problem

翻译层此前是 opt-in：`translationEnabled` 声明 `false`，于是中文部署——也是这层唯一会翻译的界面，英文面板显示的本来就是作者原文——打开每个面板看到的都是作者写的英文，除非用户主动去一个他本没有理由访问的设置页里找到那个开关。用户要的是下载线路那种形态：跟随界面语言，中文开、英文关。

难点全在这个默认值上。一个已存储的设置段对读者来说有三种状态——用户打开过、用户关闭过、用户从未碰过——而推导只允许移动第三种。插件自己的配置引用区分不了第三种与第二种：`MarketSettingsFields.translationEnabled` 声明了 `.default(false)`，而 schemastery 会把声明的默认值物化进那个活的 volatile 引用，于是未被触碰的字段读出来与用户存下的一模一样，都是 `false`。在 `@deepseek-ai/schemastery@3.18.4` 上实测：带该默认值的 schema 把缺失字段解析为 `false`，同一 schema 去掉默认值则解析为 `undefined`。在这个引用之上做推导，等于悄悄替每一个曾主动关掉它的用户重新打开。

## Decision

翻译开关是一个存储布尔值，其默认值跟随宿主的 `locale.preference`。存下的布尔值永远优先；只有对字段只字未提的设置段才采用语言的答案。

规则归 `src/contracts/settings.ts` 的 `interfaceLanguageTranslates(localePreference)`，而且它就是宿主自己的规则、不是对它的第二种读法：`bindHostLocale`（`src/runtime/host/host-locale.ts`）把每一个不以英文开头的 preference 都交给中文字典，所以每一个非英文界面都会翻译，preference 缺席也算。`resolveMarketSettings(section, localePreference)` 用它解析开关，`Catalog.translateFields` 与 `Catalog.translateDocument` 由同一个函数把闸门，于是「开关读作开」与「文本被翻译」是同一句话，而不是两句可能漂移的话。

### 缺席信号由 schema 给出

`MarketSettingsFields.translationEnabled` 不声明默认值（`src/application/mcp/mcp-backend.ts`）。未被触碰的文档因此不会把该字段放进解析后的设置段，volatile 引用回答 `undefined`，`narrowBoolean` 把它交给语言。这是本命名空间里唯一没有声明默认值的字段，而这份缺席是承重的，不是遗漏：声明的默认值会抹掉推导所依赖的那个区别。

宿主自己的语言行也是同一形状：`locale.preference` 声明为 `.required(false)`，其缺席意为「跟随浏览器」。

### 两半读同一种语言

node 半把它本就为自身文案持有的那份缓存 `locale.preference`（`src/index.ts`，在激活、设置服务落地、以及 locale 条目自身的文档更新这三个时点刷新）传进 `MarketSettingsNamespace`。

浏览器半经设置传输读 locale 插件的表单（`src/client/ui/translation-enabled.ts` 的 `bindInterfaceLanguage`），而不是读 locale 服务的 active id。active id 是浏览器推导出的语言，而市场的 node 半在 preference 缺席时渲染中文文案（`src/runtime/host/host-locale.ts`）；一个按浏览器语言作答的开关会在市场正把文本翻成中文时报「关」。preference 缺席时两半都读作 `zh`，这正是每个面向宿主的读取本来就遵循的规则。

### 设置卡显示生效值

去掉声明的默认值也去掉了设置卡原本渲染的那个值，而留空的开关会在市场正在翻译的文本旁边显示「关」——一个对自己所报状态撒谎的控件。于是 `bindMarketCardForm` 在模型自己没有任何值时，用生效值投影该行的草稿文本（`src/client/features/settings-card/market-card-form.ts` 的 `translationField()`），并在语言切换时重新发布。覆盖徽章不变：它仍然报告用户层条目的存在，而「重置」正是把字段交还给它。

### 该行的控件

缓存重置改用宿主的 `Button`（ghost / small），文案为「重置缓存」/ `translationReset`，清空落地后停在 `translationResetDone`。它替换掉的扁平图标按钮连同其本地 `.pluginFieldIcon` 规则一并移除。`translationToggleDesc` 现在描述这层实际做的事——只翻描述，名称保持原文——并写明语言默认值，这是读者唯一能得知开关跟随语言的地方。

## Alternatives considered

**在开关上加第三个「跟随界面语言」取值，照搬 `downloadRegion` 的 `auto`。** 否决：线路是个枚举，渲染成分段控件，有一个分段可以显示「跟随」，下面还有一行显示解析结果。布尔开关没有第三态，走这条路等于把开关换成分段控件——比默认值本身更大的面改动，而且用户并没有要求。

**保留声明的默认值，改从宿主设置描述符（`describe().user`）读用户层。** 否决：它用每次读取都做一次全 profile 投影来回答同一个问题（插件已有的 locale 读取已经付过一次并做了缓存），它重复了浏览器半以 `user` 存在性读取的那个判别信号，而且它让 schema 继续声明一个插件随后无视的默认值。

**语言变化时把推导出的值写进文档。** 否决：这把推导变成存储值，字段从此无法跟随之后的语言切换，而且插件会自作主张写用户的设置文档。

**在浏览器里按 locale 服务的 active locale id 推导。** 否决：它回答的是浏览器推导语言而非宿主存下的 preference，于是在「英文浏览器 + 未存 preference」时开关会被隐藏，而 node 半正在翻成中文。

**只显示存储值，另加一行提示写明语言默认值，照线路行显示解析结果的样子。** 否决：这一行会在翻译运行时显示「关」，而提示无法修补一个自相矛盾的开关。

**把开关对齐下载线路的谓词（`src/application/regions.ts` 的 `startsWith('zh')`）。** 否决：线路回答的是走哪条下载通道，而翻译要回答的是界面渲染的是哪本词典——这个问题宿主自己就答了，答案在 `bindHostLocale`。用线路的谓词会把 `ja` 读作「非中文」，而宿主是用中文字典渲染它的，于是开关会在一个文本确实会被翻译的界面上显示关闭；而这一层自己的闸门此前又拿 locale 与精确的 `zh` 比较，于是 `zh-CN` 界面会出现「开关显示开、实际什么都不翻」。现在闸门与开关共用宿主这条规则。

**改掉 node 半「preference 缺席即 zh」的约定，让它跟随浏览器语言。** 否决：那是仓库级约定（`src/runtime/host/host-locale.ts`），市场自身的文案已经依赖它，而 node 进程没有浏览器语言可读。为一个设置项改它，会让市场的文案与它的翻译默认值互相矛盾。

## Consequences

全新的中文部署无需访问设置页即可翻译，英文部署不受影响，语言切换只为那些从未自己回答过这个问题的用户移动默认值。存下的答案在任何方向上都不会被覆盖。

代价有三。命名空间里有一个字段的默认值不只在 `MARKET_SETTINGS_DEFAULTS` 里，于是问「字段缺席意味着什么」的读者现在还需要看 `translationDefaultEnabled`。浏览器卡为这一个字段带了一层投影，因为宿主不为它提供任何值。两半各自在进程的这一侧解析语言；它们之所以一致，是因为都以同一条缺席规则读 `locale.preference`，而测试钉住的正是这一点。

有一条边界是继承来的，不是新引入的：未存 preference 且浏览器非中文时，市场仍读作中文，因为本插件里缺席处处意味着 zh。市场自身的文案在那里本来也渲染中文，所以开关是跟随它，而不是与它矛盾。

闸门随开关一起移动了。`Catalog.translateFields` 与 `Catalog.translateDocument` 此前把 locale 与精确的 `zh` 比较，现在调用同一个谓词，于是 `zh-CN`、`zh-Hant`、`ja` 界面会翻译自己的描述与正文，而不是显示一个撒谎的开关。代价是每个目标 locale 各占一份缓存空间：`translationKey` 把 locale 折进键里，因此在 `zh` 与 `zh-CN` 之间切换的读者，会为每种他真正读过的目标各付一次翻译。这正是那个键本身的设计——不同的目标是不同的答案，而不是陈旧答案——同一份文本对同一个目标仍然只入队一次，不会重复。

## Testing

`tests/mcp-backend.test.ts` 钉住 schema 缺失默认值这件事：未被触碰的设置段让字段保持 undefined，而显式 `false` 仍是 `false`。`tests/settings-namespace.test.ts` 覆盖 node 半的推导——zh、zh-CN、zh-Hant、ja 为开，en、en-US 为关，缺席引用解析到语言而不是常量，存下的值在两个方向上都保持，以及语言切换只移动未设置的字段、不碰已设置的字段。`tests/translation-gate-consistency.test.ts` 是那条防漂移测试：对上述每一个 locale 都驱动真实闸门 `Catalog.translateFields`——provider 是否被调用、这次读取报了多少 pending、落定后读回什么——并断言答案就是开关自己的答案；另有一条对 `translateDocument` 做同样的事。`tests/client-translation-settings.test.ts` 覆盖浏览器绑定：经 `bindInterfaceLanguage` 的同一组语言用例、缺席 preference 读作 zh、没有接语言源的绑定遵循同一条读法、以及存有值时发生语言切换。`tests/client-plugin-card.test.ts` 覆盖设置卡的生效值投影，包括语言切换会重新发布该行、暂存的编辑自己作答、以及存下的「关」在切回中文后依然保持。`tests/client-plugins-item-views.test.ts` 覆盖重置控件：该行渲染出带名字的文本按钮且不含图标，点击会清空缓存并停在已清空的文案上。

## Related

这一层本身记录在[通用翻译层笔记](2026-10-04-universal-translation-layer.md)，那里拥有 provider 链、缓存与六个面；本笔记只改开关默认值与设置行，不新增任何层机制。那份笔记没有陈述默认值，因此其中没有任何内容被取代。[设置与卡片笔记](../../implemented/architecture/2026-09-13-settings-and-card-ride-the-host.md) 拥有命名空间的默认值与解析安排；它「schema 声明每一个默认值」的说法，现在对除这一个字段以外的所有字段成立。
