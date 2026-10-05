# Agent Note: 套件文档在展开时读取，不再随详情载荷内联

Status: implemented

## Problem

市场详情弹窗为三种文档面各渲染一行——技能的 `SKILL.md`、快捷指令、专家人设。三行看起来一样，背后却是两套取数：技能正文由技能路由按需读取，而快捷指令与专家的正文随 `suiteDetail` 载荷内联到达，被切成 `64 * 1024` 个字符（`markdownPreviews`，改动前的 `src/application/details.ts:122-127`），界面上却只字未提。

这个切分有它真实的理由：弹窗整份取回载荷，一篇文档又多又大的套件会把兆字节压进一次响应。它付出的代价是读者的信任——一条长快捷指令展开后停在一句话中间，没有标记、没有计数、没有任何状态说明它被截断了。同一个模块本来就知道区别：`readPreview` 会给仍然内联的 LSP 定义文件追加 `… (truncated)`，于是一份代码对同一个想法带着两种行为。

## Decision

`suiteDetail` 载荷只带文档的身份，永远不带它的字节。`commands` 与 `agents` 投影为 `SuiteDocumentMeta`——行上渲染的名字，加上它旁边的 frontmatter `description`（`documentMetas`，`src/application/details.ts:141-152`）——64 KiB 的切分随它封顶的那些正文一起消失。目录式 LSP 定义文件保留 `readPreview` 与它可见的上限（`:130-133`）：那是另一个面，仍然内联，不属于这个缺陷。

三种文档面都经同一条路由、同一个读取器取正文：`GET /api/agent-plugins/suite/document?sourceId=…&suiteId=…&kind=…&name=…`（`MARKET_ROUTES.suiteDocument`，`src/contracts/market.ts:29`；处理于 `src/routes.ts:186-200`），由 `Catalog.suiteDocument`（`src/application/catalog.ts:447`）经 `readSuiteDocument`（`src/application/details.ts:116`）作答。这个读取器本来就服务三种面——快捷指令与专家的那一半是给翻译路由写的——所以本次没有新写读取器；缺的是那条读取路由与客户端调用，而它取代的技能专用路由（`MARKET_ROUTES.skill`、`SkillContent`）一并删除。

### The client has one document row, not three

`SuiteDetailModal` 的每一行文档都经同一个 `documentRow(kind, id, name, description)` 助手构建（`src/client/features/market/SuiteDetail.tsx:108-118`）：同一个惰性触发（打开该行才开始读取）、同一个加载槽（`documentText`/`documentLoading`，`:54-56`）、同一条失败路径（`toggleRow` 写下的 `⚠ …` 文本，`:95`），以及正文下方同一个折叠的翻译区。三个面现在只在传入的 `kind` 上不同。

翻译区本来就在服务端，契约未被动过：`POST …/suite/document/translation` 经同一个 `readSuiteDocument` 重读文件（`src/application/catalog.ts:483`），从不信任页面；该区在读者展开它之前不读取任何东西。

## Alternatives considered

**保留内联正文，只把截断显示出来。** 否决：截断标记只是让缺陷变得诚实，而不是被修掉；载荷依旧随套件的文档增长——这正是用户面板把文档移出列表线路时已经消除的那类膨胀。

**提高上限而不是删掉它。** 否决：任何上限对某些套件都是静默切割，而这个常量不该由读者去发现。字节要离开载荷，而不是在载荷里变小。

**在技能路由旁边再给快捷指令与专家一条读取路由。** 否决：三种面同属一种文档，差别只在 `kind`；第二条路由会让技能路由多出的线上字段（`description`、`path`）为没有消费者的东西继续存在，也会让客户端留下两个 fetch 函数，它们的加载与错误路径再次各走各的——而这次改动消除的正是这份不对称。

## Consequences

回归夹具的载荷从 656,671 字节降到 1,151 字节——六条 120 KiB 的快捷指令与四个 90 KiB 的专家，合计 1,105,920 个作者字节（`tests/suite-detail-document-payload.test.ts`）。展开一条快捷指令或一个专家的读者现在看到整份文件，无论多长，并为此付一次读取；这次读取与技能行本来就要付的是同一次。可见的代价是：快捷指令或专家行在读取期间显示加载行，而它过去是立即渲染的；每展开一行会向宿主多发一个请求。

## Testing

`tests/suite-detail-document-payload.test.ts` 守住线上契约：没有条目带正文，文档合计超过一兆字节的套件其载荷依然很小，按需读取拿到整份文件、包括超过 64 KiB 的尾巴。`tests/market-detail-document-lazy.test.ts` 挂载弹窗：挂载时不读任何文档，三种面各自在展开时按 kind 与名字读自己的文档，超过旧上限的快捷指令会渲染出尾巴，失败的读取把同一份失败写进行内。`tests/market-detail-document-translation.test.ts` 守住三个面上翻译区的惰性契约，`tests/routes.test.ts` 演练读取路由、它的 kind 校验与 404。

## Related

- [市场文档翻译路由与身份笔记](2026-10-05-market-document-translation-route-and-identity.zh.md)被**部分取代**：它关于快捷指令与专家随 `suiteDetail` 载荷内联的表述（`:31`、`:37`、`:43`）描述的正是本次改动移除的载荷，于是它「载荷是页面展示的内容」的说法现在读作「文档路由是页面展示的内容」。它的身份、缓存键与路由决策依然成立，两篇笔记都保持生效。
- [文档翻译笔记](../feature/2026-10-05-document-translation-chunked-and-lazy.zh.md)持有切块器、轮询与用户面板路由；本次改动不增加任何翻译行为。
- [读路径笔记](2026-10-05-read-path-cost-bounds-and-locale-freshness.zh.md)持有每次读取文档都要付的语言读取成本。
