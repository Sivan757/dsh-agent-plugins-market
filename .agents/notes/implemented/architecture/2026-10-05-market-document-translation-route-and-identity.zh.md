# Agent Note: 市场详情页用自己的路由与身份翻译文档

Status: implemented

## Problem

用户面板与市场套件详情都展示技能、快捷指令和专家的文档。两者到达时携带的身份不同，而且市场需要在安装前预览，不能依赖仅列出已安装套件的用户资源面板。

## Decision

市场翻译路由接受 `{sourceId, suiteId, kind, name}`，用户面板路由接受条目名称并经自己的 store 解析。两条路由都从受支持的资源列表读取文件，不接受调用方提交的正文或任意路径。路由定义归[市场协议](../../../../src/contracts/market.ts)，请求校验归[路由实现](../../../../src/routes.ts)。

### 不同的读取资格，共享的身份

市场经 catalog 解析套件，可预览尚未安装的本地套件。用户资源面板经 `PanelResourceStore` 读取其发现范围内的条目。将市场请求简单交给用户面板 store 会漏掉安装前预览；把未安装套件加入用户列表则会扩大列表的职责。

两条路径都以 `pluginResourceId(sourceId, suiteId, kind, name)` 标识套件文档，再加正文角色、片段文本、目标语言和 provider 链组成缓存键。同一文档从不同面打开时共享分段记录，而不是每个面各翻一遍。它不是整篇文档只占一个缓存条目。

### 页面只传身份

套件详情载荷给技能、命令与专家文档提供行元数据，正文通过单条文档读取按需获取。翻译路由自己重读文件并剥掉 frontmatter，不信任页面提供的副本。文件必须由扫描出的资源名称定位；这避免把使用者的翻译额度开放给页面任意选择的文本。

### 共享文档处理与阅读器

两条路径都到达 `Catalog.translateDocument` 和服务端 AST 变换，客户端都使用 `DocumentTranslationView` 与等待期间的重读。展开正文即开始按需翻译，默认逐段双语；原文、译文与双语三态以及独立的目标/开关规则由[阅读与生命周期决策](../feature/2026-10-06-translation-reading-and-lifecycle.zh.md)拥有，不由本记录规定。

## Alternatives considered

**一条路由接受两种身份。** 否决：仍需区分用户面板与市场的查找资格，还增加一个可与现有身份格式漂移的判别式。两条精确路径把解析规则保持在各自调用点。

**翻译页面提交的正文。** 否决：这会把翻译额度交给页面自选的文本，并失去可验证的文件身份。重读扫描列表中被命名的文件，才能约束输入范围。

**给市场单独的缓存命名空间。** 否决：同一文件会在安装前预览和用户面板阅读时重复翻译。共享文档身份可以复用片段，不合并两条路由的查找范围。

## Consequences

未展开的文档不预翻译；同一身份、文本、目标与链的已缓存片段可跨两个面复用。正文与译文分开读取，因此外部编辑可能发生在两次读取之间；翻译路由回答的是它重读时的文件，并非原文预览与译文的原子快照。

新增文档种类需同步更新两条路由的校验与客户端读取函数。分段、本地化、渲染与持久键仍共用，不复制为两套实现。

## Testing

[跨面翻译测试](../../../../tests/surface-translations.test.ts)覆盖缓存复用、磁盘重读与非法名称。[路由测试](../../../../tests/routes.test.ts)覆盖身份校验与不转发多余文本。[市场正文测试](../../../../tests/market-detail-document-translation.test.ts)与[用户条目测试](../../../../tests/client-user-entry-detail-translation.test.ts)覆盖展开读取。[共享阅读器测试](../../../../tests/client-document-translation.test.ts)拥有三态交互。这些是覆盖归属，不是本次文档编辑重跑全部测试的声明。

## Related

[文档分块记录](../feature/2026-10-05-document-translation-chunked-and-lazy.zh.md)保留请求限额与正文角色的理由。[语言默认值记录](../feature/2026-10-05-translation-default-follows-language.zh.md)拥有未设置开关时的规则。[通用翻译层](../feature/2026-10-04-universal-translation-layer.zh.md)拥有 provider 顺序与持久键。

[阅读与生命周期决策](../feature/2026-10-06-translation-reading-and-lifecycle.zh.md)更新共享阅读器与语言控制，但不取代本记录的双路由与共同身份决策；这些理由仍然有效。
