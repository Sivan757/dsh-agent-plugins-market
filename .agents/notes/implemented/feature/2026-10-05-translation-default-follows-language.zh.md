# Agent Note: 翻译开关默认跟随界面语言

Status: implemented

## Problem

翻译开关需要在中文界面默认开启、英文界面默认关闭，同时保留用户手动存下的开启或关闭。默认值推导必须区分「用户关掉了」与「用户从未设置」。

存储值有三种情况：用户开启、用户关闭、用户未设置。只有未设置时才允许采用语言默认值。若 schema 声明 `.default(false)`，宿主解析后的实时引用就无法区分「未设置」与「显式 false」。在此基础上推导语言默认值，会覆盖用户主动关闭的选择。

## Decision

翻译开关是一个存储布尔值，其默认值跟随宿主的 `locale.preference`。存下的布尔值永远优先；只有对字段只字未提的设置段才采用语言的答案。

`interfaceLanguageTranslates(localePreference)`（`packages/market-contracts/src/contracts/settings.ts`）只回答默认值：与 `bindHostLocale` 相同，以 `en` 开头的偏好使用英文，其余使用中文，缺席也算中文。`resolveMarketSettings` 先采用存下的布尔值，再用此默认值。[三态阅读与翻译生命周期](2026-10-06-translation-reading-and-lifecycle.zh.md)部分取代本记录把语言当作硬门禁的决定：目标由独立的 `resolveTranslationTarget` 解析，实际工作由生效开关控制。

### 缺席信号由 schema 给出

`MarketSettingsFields.translationEnabled` 不声明默认值（`packages/market-mcp/src/application/mcp/mcp-backend.ts`）。未被触碰的文档因此不会把该字段放进解析后的设置段，volatile 引用回答 `undefined`，`narrowBoolean` 把它交给语言。这是本命名空间里唯一没有声明默认值的字段，而这份缺席是承重的，不是遗漏：声明的默认值会抹掉推导所依赖的那个区别。

宿主自己的语言行也是同一形状：`locale.preference` 声明为 `.required(false)`，其缺席意为「跟随浏览器」。

### 两半读同一种语言

node 半把它本就为自身文案持有的那份缓存 `locale.preference`（`packages/market-bundle/src/index.ts`，在激活、设置服务落地、以及 locale 条目自身的文档更新这三个时点刷新）传进 `MarketSettingsNamespace`。

浏览器经配置传输读取 locale 插件表单中的偏好，而不是 locale 服务按浏览器推导的 active id。Node 半在偏好缺席时渲染中文。若客户端只跟随英文浏览器，就会在服务端翻成中文时显示关闭。两半都将偏好缺席解析为 `zh`，保持一致。

### 设置卡显示生效值

未设置字段时，宿主不提供可直接渲染的开关值。`bindMarketCardForm` 因此将生效默认值投影为草稿显示，并在语言变化时重新发布。用户暂存的编辑优先。自定义徽章仍以用户层字段是否存在为依据，恢复默认清除该覆盖。

### 该行的控件

缓存重置使用宿主的 `Button`，文案为「重置缓存」/ `translationReset`，完成后显示 `translationResetDone`。设置说明覆盖描述与正文翻译、名称保持原文以及语言默认值。

## Alternatives considered

**给开关增加第三个「跟随界面语言」值。** 否决：下载区域是枚举，分段控件可以显示自动值。布尔开关没有第三态。替换控件会扩大改动，而字段缺席已经表示采用默认值。

**保留 schema 默认值，另从宿主描述符读取用户层。** 否决：这需要每次读取都投影整个 profile，并重复客户端已有的用户层存在性判断。它还让 schema 声明一个插件实际忽略的默认值。

**语言变化时把推导出的值写进文档。** 否决：这把推导变成存储值，字段从此无法跟随之后的语言切换，而且插件会自作主张写用户的设置文档。

**在浏览器里按 locale 服务的 active locale id 推导。** 否决：它回答的是浏览器推导语言而非宿主存下的 preference，于是在「英文浏览器 + 未存 preference」时开关会被隐藏，而 node 半正在翻成中文。

**只显示存储值，另加一行提示写明语言默认值，照线路行显示解析结果的样子。** 否决：这一行会在翻译运行时显示「关」，而提示无法修补一个自相矛盾的开关。

**把默认值对齐下载线路的谓词（`startsWith('zh')`）。** 否决：线路回答下载通道，翻译默认值跟随界面实际采用的字典。`ja` 与 `zh-Hant` 在本插件中都使用简体中文；用偏好标签直接判断会让界面文案、默认开关与目标语言不一致。这并不允许默认值覆盖手动选择。

**改掉 node 半「preference 缺席即 zh」的约定，让它跟随浏览器语言。** 否决：那是仓库级约定（`packages/market-runtime/src/runtime/host/host-locale.ts`），市场自身的文案已经依赖它，而 node 进程没有浏览器语言可读。为一个设置项改它，会让市场的文案与它的翻译默认值互相矛盾。

## Consequences

全新的中文部署无需访问设置页即可翻译，英文部署不受影响，语言切换只为那些从未自己回答过这个问题的用户移动默认值。存下的答案在任何方向上都不会被覆盖。

生效默认值由 `interfaceLanguageTranslates` 给出，不能只看 `MARKET_SETTINGS_DEFAULTS`。客户端需要显示这一默认值的投影。两半必须以同一条缺席规则读取 `locale.preference`。

有一条边界是继承来的，不是新引入的：未存 preference 且浏览器非中文时，市场仍读作中文，因为本插件里缺席处处意味着 zh。市场自身的文案在那里本来也渲染中文，所以开关是跟随它，而不是与它矛盾。

目标语言归一为 `zh` 或 `en`，而不是使用原始偏好标签；`zh`、`zh-CN`、`zh-Hant` 与 `ja` 因此复用同一个中文目标缓存。英文默认关闭，但显式开启时可以中译英。语言默认值不再作为翻译调用的硬门禁，相关理由见[替代决策](2026-10-06-translation-reading-and-lifecycle.zh.md)。

## Testing

[Schema 测试](../../../../tests/mcp-backend.test.ts)覆盖缺席与显式 false 的区别；[设置命名空间测试](../../../../tests/settings-namespace.test.ts)覆盖语言默认值与手动覆盖。[目标一致性测试](../../../../tests/translation-gate-consistency.test.ts)区分默认关闭与显式开启的英文目标。[客户端设置测试](../../../../tests/client-translation-settings.test.ts)、[设置卡测试](../../../../tests/client-plugin-card.test.ts)与[设置条目测试](../../../../tests/client-plugins-item-views.test.ts)覆盖绑定、生效值投影与缓存重置控件。这些是测试归属，不声明本次文档修改重跑过行为测试。

## Related

[通用翻译层](2026-10-04-universal-translation-layer.zh.md)拥有 provider 链、缓存与各个面。[设置与卡片记录](../../implemented/architecture/2026-09-13-settings-and-card-ride-the-host.zh.md)拥有命名空间解析安排。翻译开关是 schema 不声明常量默认值的例外。[阅读与生命周期记录](2026-10-06-translation-reading-and-lifecycle.zh.md)部分取代语言门禁，但保留本记录的未设置值区分与手动选择优先规则。
