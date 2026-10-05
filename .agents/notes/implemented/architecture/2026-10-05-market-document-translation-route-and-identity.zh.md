# Agent Note: 市场详情页用自己的路由与身份翻译文档

Status: implemented

## Problem

市场详情弹窗会预览套件的文档——技能 `SKILL.md`、快捷指令、专家——而用户面板早已在折叠区后面翻译同样的文件。把这一节搬到第二个面上，引出了这一层此前没遇到过的问题：用哪个身份给文档命名，因为两个面带着不同的身份到来。

用户面板用自己扫描时给出的 id 称呼文档：`pluginResourceId(sourceId, suiteId, kind, name)`（`src/application/panel-resources.ts:100`），一个以开头 `[` 标记插件条目的 JSON 数组。市场页面带来的是套件的 `{sourceId, suiteId}` 与文档的 `{kind, name}`，根本没有 id。

## Decision

市场详情页走自己的路由翻译：`POST /api/agent-plugins/suite/document/translation`，请求体 `{sourceId, suiteId, kind, name}`（`src/contracts/market.ts:30`，处理在 `src/routes.ts:205`）。它是用户面板路由（`userPanelTranslationRoute`，`src/contracts/market.ts:155`）的对位实现，而不是它的泛化。

### 第二条路由是能力边界，而不只是不同的身份

用户面板路由经 `PanelResourceStore` 解析（`src/routes.ts:464`），而该 store 的扫描只承载已安装、本地的套件：`if (!this.catalog.isInstalled(suite.sourceId, suite.id) || suite.remote !== undefined) continue`（`src/application/panel-resources.ts:408`）。市场详情弹窗对完全未安装的套件也会打开——`detail.installed` 为 false 时页脚给出 **安装**（`src/client/features/market/SuiteDetail.tsx:296-299`），而列表里每张卡片都无条件打开它（`src/client/features/market/MarketSection.tsx:294-301`）。一条路由若把面板形状的请求体派发给面板 store，对弹窗存在意义所在的那批套件恰恰会答「no entry named …」。

市场路由改为从目录快照解析，与 `suiteDetail`、`skillContent` 的做法一致（`src/application/catalog.ts:471`、`:429`、`:442`）：在 `readUserCatalog()` 里找到套件，再从该套件自己扫描出的资源列表里读出文档（`readSuiteDocument`，`src/application/details.ts:109`）。让面板 store 承载未安装套件是通向单路由的另一条路，代价是把只属于市场的行塞进面板自己的列表。

合并请求体在派发之外还有第二笔代价：它需要一个判别式，一条「这是哪种身份」的规则立在面板自己的 id 格式旁边，随时可能与后者漂移。两个 URL 在路由匹配处不花钱——宿主按精确路径建表（已发布的 `@deepseek-ai/dsh-host-webserver@0.2.0-rc.2`，`lib/index.js:148`、`:324`；面板路由本来就依赖的同一条精确路径规则，`src/routes.ts:422-424`）——所以第二条 `exact` 路由只是多一个 map 条目。

### 共享而非分叉的部分

身份下游的一切都是同一份实现，由两条路由共同抵达。`Catalog.translateDocument`（`src/application/catalog.ts:382`）用 `chunkDocument` 切分正文（`:338`），在角色 `'document'` 下逐块本地化，并以 `interfaceLanguageTranslates` 为闸门（`src/contracts/settings.ts:107`）。客户端在两个面上渲染同一个 `DocumentTranslationView`（`src/client/ui/DocumentTranslation.tsx:40`）——用户面板条目详情（`src/client/ui/UserEntryDetail.tsx:137`）与市场文档行（`src/client/features/market/SuiteDetail.tsx:267`）——两者也都驱动同一个 `pollUntilTranslated`（`src/client/ui/translation-settle.ts:42`）与同一个 `resolveTranslationTarget`（`src/contracts/settings.ts:132`）。

承重的是缓存键。市场路由按文档自身面上的 `pluginResourceId(sourceId, suiteId, kind, name)` 取键（`src/application/catalog.ts:476`），这恰好是面板扫描给同一文件的 id（`src/application/panel-resources.ts:425`、`:428`），也是面板路由交给同一个函数的 id（`:241`）。一篇文档无论从哪个面打开都只有一条缓存条目，所以哪个面先翻译，另一个面直接读回，不必再付一次 provider；`tests/surface-translations.test.ts:223-244` 先经面板翻译，再向市场路由要同一文件，断言 provider 只被调用一次。

### 载荷用于展示；路由不接受文本

快捷指令与专家本就随 `suiteDetail` 载荷内联到达——`markdownPreviews` 把每篇文档的 `content` 放上线（`src/application/details.ts:73-74`、`:136`）——因此弹窗无需读取即可展示作者原文。翻译仍然在服务端重读文件，路由请求体就是 `{sourceId, suiteId, kind, name}`，别无其他（`src/routes.ts:206-211`）：一条翻译调用方提交文本的路由，会成为任何本地页面都能用的开放机器翻译代理。这个不对称是刻意的——载荷是页面展示的内容，永远不是被翻译的内容——`tests/routes.test.ts:345-384` 多送一个 `text` 字段，断言它哪里也到不了。

## Alternatives considered

**一条路由同时接受两种身份形状。** 否决：面板形状的那一半经 `PanelResourceStore` 解析，而它的扫描只承载已安装套件（`src/application/panel-resources.ts:408`），市场弹窗却会在未安装的套件上打开并提供 **安装**（`src/client/features/market/SuiteDetail.tsx:296-299`）；合并体要么漏掉这些套件，要么把未安装的行塞进面板列表，而且它需要一个可能与面板 id 格式漂移的判别式。它省下的第二个 URL，在一张按精确路径建表的表里只值一个 map 条目。

**翻译详情载荷已经带上的文档文本。** 否决：快捷指令与专家带着 `content` 上线，接受这些文本的路由会成为任何本地页面都能用的开放机器翻译代理——运营者的 provider 额度花在页面自选的文本上，缓存里也没有文件可命名。路由只取身份并重读文件（`src/application/details.ts:109`），与面板路由保持同一份契约。

**给市场路由一套自己的缓存命名空间。** 否决：按套件身份而不是文档自身的面板 id 取键，会让同一文件在读者于两个面打开它的那一刻变成两条缓存条目、两次付费——用户面板是读套件文档的地方，市场预览是安装前检视它们的地方，同一篇文档出现在两边是常态。

## Consequences

没人展开的文档，弹窗不花任何代价；在一个面上翻译过的文档，在另一个面上免费。市场路由重读文件而不是信任载荷，因此译文跟随磁盘，即便它上方的预览仍显示扫描时发布的文本。

两条路由需要同步维护：新增第四种文档面要同时加进面板的 kind 列表（`src/routes.ts:428`）与市场路由自己的校验（`:208`），客户端也每条路由各留一个 fetch 函数（`src/client/api.ts:227`、`:361`）。共享正是让它便宜的原因——切块器、本地化器、组件、轮询与缓存键都是单份实例，两条路由的差别只在如何解析出一篇文档。

## Testing

`tests/surface-translations.test.ts:223-244` 是跨面的那条用例：面板翻译一条套件命令，市场路由要同一文件，provider 的调用计数保持在一。`:209-221` 钉住重读：文件在磁盘上被改写，答案跟随磁盘而不是详情载荷带过的文本。`:246-253` 钉住名字契约：路径形状的名字是未命中，不是一次查找。

`tests/routes.test.ts:345-384` 演练路由本身：它把 `{sourceId, suiteId, kind, name}` 转给目录，多出的 `text` 字段哪里也到不了，缺失的套件身份、未知的面与无名字的文档都先于目录被拒。

`tests/market-detail-document-translation.test.ts` 挂载弹窗：没人打开的文档不产生任何读取，三种面各自在自己那一节展开时才读自己的文档，翻译关闭或界面为英文时该节既不渲染也不读取。`tests/client-document-translation.test.ts` 从用户面板一侧覆盖同一个组件。

## Related

- [详情页整篇翻译文档正文，分块进行，收在折叠区里](../feature/2026-10-05-document-translation-chunked-and-lazy.zh.md)持有切块器、角色槽、轮询与用户面板路由；本篇加上市场路由的身份与共享键，两者互不取代。
- [翻译开关默认跟随界面语言](../feature/2026-10-05-translation-default-follows-language.zh.md)持有两条路由共同回答的闸门；本篇不加闸门。
- [读路径的成本上界与 locale 新鲜度契约](2026-10-05-read-path-cost-bounds-and-locale-freshness.zh.md)持有市场路由每篇文档付一次的语言读取（`src/application/catalog.ts:476`）。
- [横跨六个面的通用翻译层](../feature/2026-10-04-universal-translation-layer.zh.md)持有 provider 链与本路由喂养的缓存。

此前没有生效中的笔记拥有这个决策：同轮的 feature 笔记把它的路由一节限定在用户面板，因此没有笔记被取代，也没有笔记被归档。
