# Agent Note: 按当前语言本地化套件描述

Status: implemented

## Problem

市场面板原样渲染上游 catalog。这些 manifest 以英文撰写，因此 `zh` 部署看到的是中文界面里嵌着英文套件描述—— 正是用户报告的那个缺陷：面板外壳已经翻译，只剩数据字段还是英文。

catalog 不归我们编辑。一个 source 是别人仓库的 checkout，每次更新都会刷新，所以翻译不能写回 manifest。它必须放在 catalog 旁边，在输出的路上应用。

## Decision

描述分两层本地化，一层对应一类作者。

**层1 —— 已经双语的描述只做切分，不翻译。** 有些作者把两种语言塞进同一个 `description` 字段（`中文 · English`）。`src/client/features/market/bilingual-description.ts` 的 `pickBilingualDescription` 在第一个 `·` 或 `-` 处切分，保留与当前语言匹配的那一段；只有一种语言时原样返回。这不消耗模型调用、不需要缓存，覆盖了那些作者本就双语撰写的内置一方套件。

**层2 —— 其余交给宿主自己的模型翻译。** 剩下的英文正文送给用户的默认模型，并落盘缓存。

### 读取路径永不等待模型

`Catalog.overview()` 在翻译上是同步的。`DescriptionLocalizer.localize()` 从内存 map 作答：命中缓存就返回译文，未命中则返回原文加 `pending: true` 并把任务入队。响应携带 `descriptionPending`（仍在处理的数量）， `MarketSection` 在该计数非零时按 1.5 秒定时重读 overview。

这个形态是刻意的。924 个套件的 catalog 不能让首屏等 924 次模型调用；而翻译完成前什么都不渲染的面板，比它所替换的英文更糟。

`Catalog.warmDescriptions()` 在首次读取之前跑同一条队列，因此回访用户的面板打开时，看到的是已经付过费的译文。它接在两个点上：宿主 `llm` 与 `agentDefaultModel` 服务 provision 完成时（它们在 `apply()` 返回之后才挂载，更早预热只会发现服务缺席），以及每次 `refreshSource()` 之后 —— 那是新描述到达的时刻。这一轮天生增量：已缓存的描述不入队，所以重复调用只是每个套件一次内存查找。它返回的 promise 在任务**入队**后即 settle；`settleDescriptions()` 才等待译文本身，生产调用方两者都不需要。

### 失败在结构上不可见

翻译只是优化，从不是依赖。每一条失败路径 —— 没有 LLM 服务、没有默认模型、provider 报错、超时、空回答、缓存文件损坏 —— 都降级为上游原文。localizer 中没有任何异常会抛进 `overview()`。

`pending` 表示的是「确实有任务在排队或运行」，而不是「这个键还没翻译」。等待退避的键回答 `pending: false`，因此一个持续失败的描述会让面板停止重读，而不是永远轮询。

### 缓存键按内容寻址

`descriptionTranslationKey(sourceId, suiteId, description, locale)` 用 NUL 连接四部分并返回 SHA-256 摘要。用内容而不是版本号：套件重写描述时缓存未命中、重新翻译；而仅仅提升版本号时译文保留。NUL 连接让 id 中含有分隔符的两个套件不会互相别名。

条目经共享原子写入器（`readJsonFile` / `writeJsonDocument`）持久化到 `<dataRoot>/description-translations.json`，与 `state-store.ts`、`lsp-server-state.ts` 同一模式。插件 data root 是插件自己的存储 —— 绝不是项目目录。成功的翻译每 1.5 秒批量合并为一次写入，而不是每个套件写一次。

### 限额

并发全局上限为 3 —— 比任务要求的「单源 ≤3」更强，且无论配置多少来源都能约束一次面板打开的开销。队列按键去重，同一张卡片被反复读取只花一次调用。失败的键按 2 秒 / 8 秒 / 30 秒 / 120 秒退避后停止；即使缓存写入失败也保留内存副本，所以一次丢写只多花一次调用，而不会弄坏面板。

### 落点

| 关注点           | 模块                                                  |
| ---------------- | ----------------------------------------------------- |
| 缓存文件与键     | `src/application/state/description-translations.ts`   |
| 队列、退避、降级 | `src/application/description-localizer.ts`            |
| 模型调用         | `src/runtime/host/description-translator.ts`          |
| 接缝             | `src/application/ports.ts` 的 `descriptionTranslator` |

### 模型调用

`createDescriptionTranslator` 沿用 harness 的辅助调用形态（见 `packages/session/session-title-llm`）：解析路由、经 `ctx.llm.stream` 流式调用、用 `BlockAssembler` 收块、在终止性 finish reason 上抛错。路由取用户默认模型，每次调用从 `agentDefaultModel.currentSelection()` 读取 —— 市场不会自造一个部署方没有配置的模型。

`available()` 每次询问都重新解析路由，而不是缓存答案。LLM 与默认模型服务都在 `apply()` 返回**之后**才 provision，所以在组装期做的可用性判断会在整个进程生命周期内一直报告「不可用」。

`purpose` 刻意留空。已发布的 `GenerateOptions.purpose` 恰好接受两个值：`'compaction'` 与 `'session-title'`；两者都不描述翻译，且各自携带 purpose 专属的生成策略。留空让这次调用走普通路由。

只有 `zh` 语言会翻译。英文面板显示的本来就是作者原文，为它排队调用等于花用户额度去复现输入。

## Alternatives considered

**发布 `locale/zh.json` 并写入 `meta.description`，交给宿主渲染。** 兄弟插件正是这样本地化**自己**的市场卡片，对一个自我描述的插件来说这是正确机制。但它够不到本缺陷：截图里的英文是 924 条**上游**套件描述，而本插件发布的任何文件都无法承载它尚未扫描过的仓库的译文。该机制仅用于本插件自身的卡片，属于另一个关注点。

**在客户端翻译。** 因分层被否。`src/client/**` 不得 import `node:**`，也不持有缓存；浏览器侧翻译器会在每次页面加载时重新调用模型，且无法跨重启持久化。

**扫描时急切翻译，并阻塞 overview 直到完成。** 被否：924 次调用会把首屏挂住数分钟，并把一次模型故障变成不可用的面板。

**按套件版本号而非描述内容做缓存。** 被否：版本号提升而描述未变会丢弃有效译文；描述已改而版本号未变会返回过期译文。

**新增 `purpose: 'market-translation'`。** 不可得 —— 已发布的联合类型只有两个成员，且 `purpose` 会进入适配器专属的生成策略。本地新增取值无法通过类型检查，而传入未记录的字符串会静默抵达一个不认识它的适配器。

## Consequences

面板永远不会比改动前更差：没有配置模型、没有网络、provider 故障时，它渲染的仍是原来的上游原文。换来的是 `zh` 部署在一轮之后收敛到中文描述、每条描述只付费一次，并且译文跨重启保留。

代价是每条未见过的描述一次后台模型调用，限流为同时 3 次，且同一描述在缓存有效期内只调用一次。翻译质量是模型的，不是我们的：糟糕的译文会被原样缓存，直到上游描述改变。没有逐条淘汰或容量上限 —— 文件随 catalog 增长，每个套件一条短字符串。

套件名、关键词、技能描述与 MCP 工具文本仍未翻译。名称是专有名词；其余不在所报告的缺陷范围内，且每一项都需要各自的缓存维度。

## Testing

`tests/bilingual-description.test.ts` 钉住层1 的切分。`tests/description-localizer.test.ts` 覆盖键稳定性、跨实例缓存复用、去重、并发上限、静默降级、可控时钟下的退避时序，以及缓存文件损坏。`tests/description-translator.test.ts` 用真实 `StreamChunk` 驱动翻译器，含终止性 error 与 aborted finish reason、以及调用方取消。`tests/description-translator-seam.test.ts` 挂载真实 Cordis 树，钉住这套接线所依赖的解析行为：插件入口只 inject 了 `skills` 与 `commands`，而 `ctx.get(name)` 仍能从兄弟 fiber 拿到 `llm` 与 `agentDefaultModel`。属性访问（`ctx.llm`）在未 inject 时会抛错；`get()` 不会 —— 这正是 `readModelCatalog` 自发布以来一直这样读 `llm` 的原因。`tests/catalog-description-localization.test.ts` 走通经 `Catalog` 的完整路径：首读 pending、二读译文、`en` 语言不受影响、模型失败、详情弹窗与卡片共用缓存条目、以及跨 catalog 实例的缓存复用。
