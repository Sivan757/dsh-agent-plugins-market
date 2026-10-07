# Agent Note: 翻译分离目标语言、阅读模式与工作生命周期

Status: implemented

## Problem

由语言推导的默认值不能决定用户能否翻译。英文默认关闭，但显式开启必须能将中文翻成英文。第二层折叠区也让已展开的文档无法直接进入逐段双语阅读。

翻译工作会比客户端的一次读取持续更久。关闭显示开关必须停止排队工作与后续 provider 回退，同时保留已完成的译文。重置缓存需要更强的保证：旧调用和磁盘写入不能恢复已删除的记录。

## Decision

### 语言与显示互相独立

[配置协议](../../../../src/contracts/settings.ts)把界面字典解析为 `zh` 或 `en`。中文默认开启，英文默认关闭。存下的布尔值优先，直到用户恢复默认。默认值谓词不是执行门禁。本地化器允许把中文翻成英文，包括以英文为主但夹有中文的文本。

名称与关键词仍是标识。翻译后的描述与正文只用于显示。进入模型上下文的提示词与工具描述保持作者语言。

### 已展开文档默认双语阅读

[共享阅读器](../../../../src/client/ui/DocumentTranslation.tsx)挂载在已展开的文档中，并在此时发起翻译读取。右上角的紧凑图标标签切换原文、译文和双语。宿主 `SegmentedTabs` 保留键盘导航，默认选择双语。本地化标签供辅助技术读取，并在悬停时显示。

未展开文档不启动翻译。原文模式停止阅读器重验证，显示作者文本。关闭阅读器不等于取消该文档的全部服务端工作。

服务端响应保留 `text` 与 `pending`，增加可选的 `bilingualText`。等待中或失败的片段保留原文。阅读器通过宿主 `MarkdownText` 渲染一份完整文档，而不是每段各用一个渲染器。

直接打开的套件详情和用户条目详情也返回可选的 `translationPending`，表示描述仍有多少工作。客户端复用 `pollUntilTranslated`，在值归零、关闭翻译或卸载时停止读取，不按猜测的次数重试。

### 读取失败时停止加载并允许重试

[文档轮询](../../../../src/client/ui/translation-settle.ts)经 `onError` 报告读取失败，然后停止，不把待处理工作当作已完成。阅读器隐藏加载提示，保留原文或部分译文，并提供「重试翻译」。重试按同一文档和目标语言发起新读取。关闭阅读器或选择原文模式后，不显示迟到的错误。

[翻译 POST 读取](../../../../src/client/api.ts)使用 15 秒读取时限，不使用 600 秒修改操作时限。请求通过竞速机制将时限覆盖到响应体读取结束，仅收到响应头不会停止计时。这只约束每次 HTTP 读取，不约束翻译工作的总时长。

### 在服务端变换文档结构

[文档变换](../../../../src/application/translation/document.ts)使用带 GFM 和 math 扩展的 mdast。抽象语法树（AST）表示文档结构。变换按段落、标题或表格单元格收集 text 叶节点，用有序占位符保留行内节点位置。代码块、行内代码、链接目标、数学内容与原始 HTML 不进入 provider 输入。占位符缺失、重复或乱序的答案不能直接采用。Provider 适配器可以先尝试[有界修复](2026-10-04-universal-translation-layer.zh.md#遮蔽)，再返回有效译文，或保留原段落。允许单个行内 text 叶节点为空，但整段去掉占位符后必须仍含非空白文本。

文档正文不会为填满请求而将一段与相邻段落合并。只有超长段落才切成有上限的片段。缓存身份包含片段文本，不包含段落位置。插入一段正文不会改变无关片段的键。描述保留旧分块器，包括跨段组块和作者分隔符，以保持历史描述缓存键。

双语段落在原文后换行显示译文。标题分别显示原文标题和译文标题。表格先显示完整原表，再显示译表，不做单元格内逐项配对。列表、引用与脚注保留在同一文档树内。序列化可能规范化 Markdown 空白与标记。原文模式保留源文本，所有模式都不改写源文件。

### 关闭保留已完成缓存

[本地化器](../../../../src/application/translation/localizer.ts)经 `onEnabledChanged()` 接收配置变化。关闭会递增 generation、丢弃排队工作并取消活动批次。[Provider 链](../../../../src/application/translation/chain.ts)在每次回退前与每次响应后判断是否取消。调用方取消不使 provider 熔断。已完成缓存保留，供之后开启状态下的读取使用。

Provider 可以忽略取消信号并完成远端计算。链将 provider 工作与时限、调用方取消进行竞速，因此停止等待不依赖 provider 配合。超时允许回退，调用方取消则停止整条链。Generation 判断拒绝旧响应。重新开启会重置失败状态，但不扫描或预翻译文档。新的读取才请求缺失的工作。

[模型适配器](../../../../src/runtime/host/llm-translator.ts)向能力查询传入取消信号，并在启动流之前再次判断。能力查询在取消后才完成时，不能发起新的模型生成。

### 重置有序持久化并拒绝旧工作

重置清空记录、文本索引、重试状态与待处理工作，同时递增 generation。每次完成与清理都比较捕获的 generation 和当前值。旧批次不能写回结果、删除新 owner 或递减新批次计数。

本地化器按旧 flush、删除、新 flush 的顺序串行持久化。单靠 generation 判断不能阻止旧磁盘写入恢复已清空的记录，持久化顺序提供第二道保证。重置后开启状态下的读取可以创建新记录。

持久键保留目标、面、实体 id、角色、文本与链标识。同一文档在用户面板和市场详情间共享片段记录。独立的文本索引仍只在内存里，因此这不是对所有重复字符串的全局持久缓存。

### 打开的菜单有限重验证

[菜单描述数据源](../../../../src/client/menu-row-faces.ts)立即返回当前描述。真实候选请求的 `sessionId` 经 `sessions.scope` 借用既有作用域，再用公开的 `inputTriggers.sessionOf` 获取控制器。菜单保持打开时最多追加 40 次读取，间隔至少 1.5 秒。只有描述映射变化才调用 `refreshOpenMenu()`，避免刷新递归。关闭菜单或停用翻译即停止定时读取，不存在永久后台轮询。

40 次节拍约为 60 秒，实际窗口还包含读取耗时。预算耗尽后才完成的译文，需要后续候选请求再次重验证。缺少公开控制器时退回候选请求触发的读取。新目标清空旧描述，旧响应不能覆盖较新的读取。

## Alternatives considered

**保留第二层译文折叠区。** 已被取代：选定的阅读方式在打开文档时启动翻译，默认逐段双语。文档本身的展开仍是按需工作的边界。

**在浏览器增加 Markdown 解析器与渲染器。** 否决：已发布的 `@deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2` 提供整篇文本渲染，不提供 AST 插入接口。服务端可以变换 Markdown，客户端仍使用一份宿主渲染器，无需修改宿主。

**向 DOM 注入译文节点。** 否决：[read-frog](https://github.com/mengxi-ream/read-frog) 的 `translation-modes.ts` 与 `translation-insertion.ts` 管理页面 DOM 包装节点。这种浏览器扩展做法不能保留 React 对当前文档树的所有权。服务端返回 Markdown，不改动已渲染节点。

**将相邻段落合并为一个缓存单元。** 否决：短段插入会改变后续分组，触发无关翻译。传输批次可以组合独立单元，无需改变其键。

**关闭时删除缓存，或重置时只清记录表。** 否决：关闭必须保留已付出成本的结果。仅清内存不能阻止旧请求或磁盘写入恢复已删除的记录。

## Consequences

阅读器无需第二套客户端渲染器，即可直接逐段对照。服务端每次文档读取增加了解析与序列化工作。AST 支持 GFM 与 math，但不保证覆盖宿主每项私有语法扩展，也不保证译文 Markdown 逐字节相同。

表格保留布局，但以整表对照。长段落会按源文本预算拆分，分界处可能丢失翻译上下文。中译英输出可能膨胀，因此英文批次预算更小。源文本预算与取消机制都不能保证远端 provider 停止计算或避免截断。

## Testing

[文档分块测试](../../../../tests/document-chunks.test.ts)与[目录翻译测试](../../../../tests/translation-document.test.ts)覆盖受保护内容、结构、稳定片段与中译英。[阅读器测试](../../../../tests/client-document-translation.test.ts)、[用户详情测试](../../../../tests/client-user-entry-detail-translation.test.ts)与[市场测试](../../../../tests/market-detail-document-translation.test.ts)覆盖展开与阅读模式。

[轮询测试](../../../../tests/translation-settle.test.ts)与[阅读器测试](../../../../tests/client-document-translation.test.ts)覆盖读取失败、保留部分译文和重试。[传输超时测试](../../../../tests/client-api-timeout.test.ts)覆盖停滞的响应体。[链测试](../../../../tests/translation-chain.test.ts)覆盖忽略取消的 provider，以及取消后才结束的模型能力查询。这些用例不构成对真实长期 pending 症状根因的确诊。

[本地化器测试](../../../../tests/translation-localizer.test.ts)覆盖 generation 隔离、持久化顺序、已完成缓存保留与目标预算。[链测试](../../../../tests/translation-chain.test.ts)覆盖回退前取消。[菜单测试](../../../../tests/client-menu-row-faces.test.ts)覆盖打开期间的有限刷新、关闭清理与旧响应丢弃。这些是验证归属，不代表本次文档修改运行了行为测试或复现了真实 provider 结果。

## Related

本记录部分取代[折叠阅读决策](2026-10-05-document-translation-chunked-and-lazy.zh.md)与[语言作为门禁的决策](2026-10-05-translation-default-follows-language.zh.md)。它们保留请求限额、角色兼容与未设置值区分的理由，继续有效。旧记录对「用户选择折叠区」的归因不能作为本决策的证据。

[通用翻译层](2026-10-04-universal-translation-layer.zh.md)保留 provider 顺序、持久键与模型隔离。[市场路由](../architecture/2026-10-05-market-document-translation-route-and-identity.zh.md)保留独立查找范围与共享文档身份。本次改动没有完全取代或归档任何记录。
