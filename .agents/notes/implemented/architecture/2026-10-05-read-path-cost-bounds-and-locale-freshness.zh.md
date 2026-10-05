# Agent Note: 读路径的成本上界与 locale 新鲜度契约

Status: implemented

## Problem

三条读路径共享同一种形态：宿主回答代价高昂的输入，被在用到它的地方就地解析，而不是每次操作解析一次，于是每一次读都要再付一遍。

宿主回答 locale 偏好的方式是投影每一个活动 profile 条目的实时配置，所以一次读取就是一次全 profile 扫描。`Catalog.translateFields` 把 locale 作为可选参数、默认值 `this.ports.localePreference()`，这意味着任何漏传该参数的调用点都会静默重读那次投影——在循环里就是每个实体一次。面板读会在客户端每一次 1.5 秒的翻译轮询里重新从磁盘推导每一行。列表 wire 还携带每个条目的整份文档，而客户端一次只打开一个条目。

## Decision

### locale 每次操作只解析一次，缺参数就编译不过

`Catalog.localePreference` 只读一次端口（`src/application/catalog.ts:93`），`translateFields(surface, id, fields, locale)` 把 locale 作为必填参数、没有默认值（`:290-295`）。参数处的 JSDoc 写明了规则（`:285-287`）：不设默认值，因为默认值会让每次实体级调用都重读宿主偏好，使一次读的代价随行数而不是随工作量增长。每条遍历都解析一次并把值往下传——市场总览（`:229`）、MCP 状态清单（`:336`）、单套件详情（`:356`）——面板读把同一个值交给每一行（`src/application/panel-resources.ts:192`）。

### 缓存的 locale 没有 TTL；它与宿主副本共享同一份新鲜度

`src/index.ts:190` 把该偏好放在一个普通的 `let` 里，`:362` 从它回答端口。刷新它的恰好是三个时点，也正是刷新 `hostLocale.t`（插件渲染自己面向宿主的文案所用的那份副本）的时点：激活（`:207`）、settings 服务落地（`:208-210`）、以及 `locale` 条目自身的 `settings/document-updated`（`:213-219`）。没有定时器，也没有年龄上界。

这就是契约：只有当一次语言变更没有触发 settings 文档事件时，缓存值才可能陈旧，而那时 `hostLocale.t` 陈旧的程度完全相同。插件不可能对同一个偏好显示两种语言；它可能显示一个宿主已不再持有的偏好。代价是：由不触发文档事件的路径写入的偏好，要到三个时点中的下一个才会被观察到，本插件内没有任何东西会更早发现它。

### 行缓存上界 2000 ms，Refresh 无条件绕过

`ROW_CACHE_MAX_AGE_MS` 为 2_000（`src/application/panel-resources.ts:122`）。只有在三个输入同时成立时才复用行：catalog 快照对象、本存储自己的变更计数器、以及年龄在上界之内（`:302-307`）。这个上界是一个客户端轮询周期——`TRANSLATION_POLL_MS` 为 1_500（`src/client/ui/translation-settle.ts:17`）——加上一次慢读所需的余量，因此缓存能吸收一次交互产生的多次读，却永远不会成为手改内容在下一个轮询之后仍不可见的原因。客户端的 Refresh 传 `force`，跳过复用判定并重新推导每一行（`:300`、`:302`）。

### 列表不携带文档正文

`PanelResources.read` 构造每个 wire 行时删除 `rawText` 与 `content`（`src/application/panel-resources.ts:201-204`）；文档留在 `PanelEntryRecord` 的内存里（`:29`），只有单条 `get`（`:213`）会返回它。wire 类型写明了契约：列表读省略 `rawText`，因为它曾占响应的绝大部分，而客户端只取它打开的那一个条目（`src/contracts/market.ts:379-384`）；省略 `content`，因为客户端渲染的是 `rawText`，两者都发等于把同一份文档寄了两遍（`:391-396`）。

## Alternatives considered

**在用到的实体处解析宿主偏好。** 被否决：宿主的回答是一次全 profile 投影，所以按实体解析正是让面板延迟随行数而不是随工作量增长的原因；一次操作渲染的是同一个值，其中每个实体都会为一个不可能不同的答案再付一次。

**保留 `translateFields` 的默认参数，在记得的地方把 locale 传进去。** 被否决：默认参数正是让遗漏静默的原因。必填参数把同样的错误变成编译错误，而数读取次数的测试（`tests/panel-locale-read.test.ts:39`）钉住的是「一次解析」这一形态，不是一条约定。

**给缓存的 locale 加 TTL 或刷新定时器。** 被否决：定时器给一个已在三个时点跟随宿主副本的值加上一次唤醒和第二条新鲜度规则，而且会让面板比插件面向宿主渲染的那份副本更新——两者随后可能互相不一致，而这正是共用刷新时点要防的失效。

**行缓存改用快照 TTL 计时，而不是行内自己的上界。** 被否决：用户快照存活 30 秒（`SCAN_CACHE_TTL_MS`，`src/application/snapshot-cache.ts:18`），并在其 0.8 处被替换（`USER_REFRESH_LEAD_RATIO`，`:28`），按它计时的行会让手改内容数十秒不可见；行缓存读的是文件内容，它的上界属于客户端的轮询周期，不属于快照。

**列表继续携带 `rawText` 与 `content`，由客户端自己留着。** 被否决：列表正是面板每次轮询都要重读的东西，寄文档让被轮询的响应比它所描述的行大出数倍；打开一个条目只多一次请求，而那次条目读也是唯一按同一修订返回文档的读。

**宿主能力。** 偏好本身就是宿主的：`settings.describe()` 正是 harness 自己的桌面外壳所读的投影，[宿主 locale 来源记录](../bug-fix/2026-09-24-host-locale-source-read-and-lifetime.zh.md)持有那次读及其 fiber 生命周期。留在本地的是它之上的上界——宿主没有更便宜的逐次读答案，也没有为「本插件从宿主未建模的文件推导出来的行」准备行级缓存。

## Consequences

- 面板读的代价是一次投影而不是每行一次，且一次操作把同一个值交给所有遍历实体的面。
- 语言切换在宿主副本所用的三个时点被观察到；由不触发 settings 文档事件的路径写入的偏好，要到下一个时点才可见——面板与插件自己面向宿主的文案同样如此。
- 被服务的行最多可能陈旧 2 秒：手改内容最迟在下一个轮询可见，Refresh 则立即生效。
- 被轮询的列表响应不再携带文档；打开一个条目多付一次请求，换来按同一修订返回的文档。
- `PanelEntryRecord` 在内存里保留文档，所以原文仍然存在于模块内部，供单条读使用。

## Testing

- `tests/panel-locale-read.test.ts:37-39` 为数一个四行面板的端口读取次数，任何一行解析偏好都会让它失败。
- `tests/surface-locale-read.test.ts:1-9` 点名每一个必须「每次操作解析一次」的面：面板列表、含每个被观测工具的 MCP 状态清单、LSP 清单、`/` 菜单面，以及单套件详情。
- `tests/panel-resources.test.ts:301-302` 与 `:376-377` 钉住被剥离的列表行，对照 `:306` 与 `:386-387` 处单条读携带 `rawText` 与 `content`。
- `tests/panel-resources.test.ts:415` 把 catalog 时钟推过 `ROW_CACHE_MAX_AGE_MS`，钉住年龄上界。

## Related

- [宿主 locale 来源读取 settings 投影，并与它的 fiber 同生命周期](../bug-fix/2026-09-24-host-locale-source-read-and-lifetime.zh.md)持有投影读、服务解析与接线生命周期。本记录持有该接线之上的成本上界与新鲜度契约；两者互不取代。
- [翻译开关默认跟随界面语言](../feature/2026-10-05-translation-default-follows-language.zh.md)持有同一个偏好所决定的东西——按语言推导的默认值、schema 里承重的「不声明」、以及设置卡显示的生效值。本记录持有这个偏好怎么读、活多久；两者互不取代。
- [横跨六个面的通用翻译层](../feature/2026-10-04-universal-translation-layer.zh.md)是这些上界所服务的翻译层的读路径。
- [为当前语言本地化套件描述](../feature/2026-10-03-description-localization.zh.md)是范围更窄的前身：它的模块路径、`descriptionTranslator` seam 与 `descriptionPending` 计数已被上一条记录的翻译层取代，而它所依赖的读路径上界由本记录持有。
