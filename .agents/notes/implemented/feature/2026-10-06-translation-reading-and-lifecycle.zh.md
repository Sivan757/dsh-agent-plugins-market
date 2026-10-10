# Agent Note: 翻译分离目标语言、阅读模式与工作生命周期

Status: implemented

## Problem

由语言推导的默认值不能决定用户能否翻译。英文默认关闭，但显式开启必须能将中文翻成英文。第二层折叠区也让已展开的文档无法直接进入逐段双语阅读。

翻译工作会比客户端的一次读取持续更久。关闭显示开关必须停止排队工作与后续 provider 回退，同时保留已完成的译文。重置缓存需要更强的保证：旧调用和磁盘写入不能恢复已删除的记录。

## Decision

### 语言与显示互相独立

[配置协议](../../../../packages/market-contracts/src/contracts/settings.ts)把界面字典解析为 `zh` 或 `en`。中文默认开启，英文默认关闭。存下的布尔值优先，直到用户恢复默认。默认值谓词不是执行门禁。本地化器允许把中文翻成英文，包括以英文为主但夹有中文的文本。

名称与关键词仍是标识。翻译后的描述与正文只用于显示。进入模型上下文的提示词与工具描述保持作者语言。

### 已展开文档默认双语阅读

[共享阅读器](../../../../packages/market-ui/src/ui/DocumentTranslation.tsx)拥有阅读状态，并通过 render 回调把控件和正文交给调用方布局。[DetailRow](../../../../packages/market-ui/src/ui/DetailRows.tsx) 的 `headerActions` 将模式控件放在文件名同行，作为展开按钮的兄弟节点。模式按钮不会嵌套在展开按钮内，也不会因切换模式而折叠正文。宿主 `SegmentedTabs` 提供键盘导航，本地化标签可悬停查看并供辅助技术读取。`ui/reading-mode.ts` 为所有文档保存同一个模块级模式：初始为原文，任一处点击即改变所有已展开的阅读器。

文档组显式启用 `documentHeaders`，外框使用 `overflow: clip`，因此弹窗仍是滚动容器。只有展开的文档标题栏使用 `position: sticky` 和不透明主题背景，到该文档末端时退出吸顶。折叠行、MCP、hooks 与 LSP 保持原有布局。

未展开文档不启动翻译。原文模式停止阅读器重验证，显示作者文本。关闭阅读器不等于取消该文档的全部服务端工作。

响应包含 `text`、`pending`，以及可选的 `bilingualText` 和 `failed`。等待中或失败的整段保留原文，`failed` 不会被当作翻译成功。阅读器仍用一个宿主 `MarkdownText` 渲染完整文档。[自然段策略](2026-10-09-document-translation-paragraph-atomicity.zh.md)拥有整段发布与缓存规则。

直接打开的套件详情和用户条目详情也返回可选的 `translationPending`，表示描述仍有多少工作。客户端复用 `pollUntilTranslated`，在值归零、关闭翻译或卸载时停止读取，不按猜测的次数重试。

### 读取失败时停止加载并允许重试

读取或翻译期间，旋转图标替换当前模式图标，不在正文另加加载文字。[文档轮询](../../../../packages/market-ui/src/ui/translation-settle.ts)报告读取错误后停止，`failed` 则报告保留原文的失败段落。警告图标替换当前模式图标，悬停显示错误，点击当前警告模式即可重试。重试发送 `retry: true`，重置当前文档已跟踪的失败预算和共享 provider 熔断状态，不清缓存。它保留已完成段落，不能修复本身超长的单句。关闭阅读器或选择原文模式后不显示迟到错误。

[翻译 POST 读取](../../../../packages/market-ui/src/api.ts)使用 15 秒读取时限，不使用 600 秒修改操作时限。请求通过竞速机制将时限覆盖到响应体读取结束，仅收到响应头不会停止计时。这只约束每次 HTTP 读取，不约束翻译工作的总时长。

### 在服务端变换文档结构

[文档变换](../../../../packages/market-translation/src/application/translation/document.ts)使用带 GFM 和 math 扩展的 mdast。抽象语法树（AST）表示文档结构。它收集段落、标题或表格单元格内的 text 叶节点，用有序占位符保留行内节点位置。代码、链接目标、数学内容与原始 HTML 不交给 provider 翻译。空行内片段允许自然省略，但整段必须仍有正文且保留完整有序标记。[自然段策略](2026-10-09-document-translation-paragraph-atomicity.zh.md)取代按固定字符切片和按格式叶节点修复的策略。

文档段落不与相邻段落合并。超过请求预算的段落只按完整句子分组，单句超预算时整段保留原文并报告失败。每段所有部分完成后才发布并保存聚合结果。描述仍保留旧分块器和历史键，包括跨段组块与作者分隔符。正文策略版本与一次性重译开销归[自然段策略](2026-10-09-document-translation-paragraph-atomicity.zh.md)说明。

双语段落在原文后换行显示译文。标题分别显示原文标题和译文标题。表格先显示完整原表，再显示译表，不做单元格内逐项配对。列表、引用与脚注保留在同一文档树内。序列化可能规范化 Markdown 空白与标记。原文模式保留源文本，所有模式都不改写源文件。

### 关闭保留已完成缓存

[本地化器](../../../../packages/market-translation/src/application/translation/localizer.ts)经 `onEnabledChanged()` 接收配置变化。关闭会递增 generation、丢弃排队工作并取消活动批次。[Provider 链](../../../../packages/market-translation/src/application/translation/chain.ts)在每次回退前与每次响应后判断是否取消。调用方取消不使 provider 熔断。已完成缓存保留，供之后开启状态下的读取使用。

Provider 可以忽略取消信号并完成远端计算。链将 provider 工作与时限、调用方取消进行竞速，因此停止等待不依赖 provider 配合。超时允许回退，调用方取消则停止整条链。Generation 判断拒绝旧响应。重新开启会重置失败状态，但不扫描或预翻译文档。新的读取才请求缺失的工作。

[模型适配器](../../../../packages/market-translation/src/runtime/host/llm-translator.ts)向能力查询传入取消信号，并在启动流之前再次判断。能力查询在取消后才完成时，不能发起新的模型生成。

### 重置有序持久化并拒绝旧工作

重置清空记录、文本索引、重试状态与待处理工作，同时递增 generation。每次完成与清理都比较捕获的 generation 和当前值。旧批次不能写回结果、删除新 owner 或递减新批次计数。

本地化器按旧 flush、删除、新 flush 的顺序串行持久化。单靠 generation 判断不能阻止旧磁盘写入恢复已清空的记录，持久化顺序提供第二道保证。重置后开启状态下的读取可以创建新记录。

持久键包含目标、面、实体 id、角色、文本与链标识。正文另外使用策略身份，将新的整段结果与旧切片分开。用户面板和市场详情共享同一文档的段落记录。文本索引仍只在内存里，不是全局持久内容缓存。

### 打开的菜单有限重验证

[菜单描述数据源](../../../../packages/market-ui/src/menu-row-faces.ts)立即返回当前描述。真实候选请求的 `sessionId` 经 `sessions.scope` 借用既有作用域，再用公开的 `inputTriggers.sessionOf` 获取控制器。菜单保持打开时最多追加 40 次读取，间隔至少 1.5 秒。只有描述映射变化才调用 `refreshOpenMenu()`，避免刷新递归。关闭菜单或停用翻译即停止定时读取，不存在永久后台轮询。

40 次节拍约为 60 秒，实际窗口还包含读取耗时。预算耗尽后才完成的译文，需要后续候选请求再次重验证。缺少公开控制器时退回候选请求触发的读取。新目标清空旧描述，旧响应不能覆盖较新的读取。

## Alternatives considered

**保留第二层译文折叠区。** 已被取代：选定的阅读方式在打开文档时启动翻译，默认逐段双语。文档本身的展开仍是按需工作的边界。

**在浏览器增加 Markdown 解析器与渲染器。** 否决：已发布的 `@deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2` 提供整篇文本渲染，不提供 AST 插入接口。服务端可以变换 Markdown，客户端仍使用一份宿主渲染器，无需修改宿主。

**向 DOM 注入译文节点。** 否决：[read-frog](https://github.com/mengxi-ream/read-frog) 的 `translation-modes.ts` 与 `translation-insertion.ts` 管理页面 DOM 包装节点。这种浏览器扩展做法不能保留 React 对当前文档树的所有权。服务端返回 Markdown，不改动已渲染节点。

**将相邻段落合并为一个缓存单元。** 否决：短段插入会改变后续分组，触发无关翻译。传输批次可以组合独立单元，无需改变其键。

**关闭时删除缓存，或重置时只清记录表。** 否决：关闭必须保留已付出成本的结果。仅清内存不能阻止旧请求或磁盘写入恢复已删除的记录。

## Consequences

阅读器无需第二套客户端渲染器，即可直接逐段对照。服务端每次文档读取增加了解析与序列化工作。AST 支持 GFM 与 math，但不保证覆盖宿主每项私有语法扩展，也不保证译文 Markdown 逐字节相同。

表格仍按整表对照。长段落的句间分组会减少跨句上下文，而超预算单句保持原文。英文批次预算更小，因为输出可能膨胀。源文本预算与取消机制都不保证远端 provider 停止或避免截断，相关限制归[自然段策略](2026-10-09-document-translation-paragraph-atomicity.zh.md)。

## Testing

[文档分块测试](../../../../tests/document-chunks.test.ts)与[目录翻译测试](../../../../tests/translation-document.test.ts)覆盖受保护内容、结构、稳定片段与中译英。[阅读器测试](../../../../tests/client-document-translation.test.ts)、[用户详情测试](../../../../tests/client-user-entry-detail-translation.test.ts)与[市场测试](../../../../tests/market-detail-document-translation.test.ts)覆盖展开与阅读模式。

[轮询测试](../../../../tests/translation-settle.test.ts)与[阅读器测试](../../../../tests/client-document-translation.test.ts)覆盖读取失败、保留部分译文和重试。[传输超时测试](../../../../tests/client-api-timeout.test.ts)覆盖停滞的响应体。[链测试](../../../../tests/translation-chain.test.ts)覆盖忽略取消的 provider，以及取消后才结束的模型能力查询。这些用例不构成对真实长期 pending 症状根因的确诊。

[本地化器测试](../../../../tests/translation-localizer.test.ts)覆盖 generation 隔离、持久化顺序、已完成缓存保留与目标预算。[链测试](../../../../tests/translation-chain.test.ts)覆盖回退前取消。[菜单测试](../../../../tests/client-menu-row-faces.test.ts)覆盖打开期间的有限刷新、关闭清理与旧响应丢弃。这些是验证归属，不代表本次文档修改运行了行为测试或复现了真实 provider 结果。

## Related

本记录部分取代[折叠阅读决策](2026-10-05-document-translation-chunked-and-lazy.zh.md)与[语言作为门禁的决策](2026-10-05-translation-default-follows-language.zh.md)。它们保留请求限额、角色兼容与未设置值区分的理由，继续有效。旧记录对「用户选择折叠区」的归因不能作为本决策的证据。

[自然段策略](2026-10-09-document-translation-paragraph-atomicity.zh.md)部分取代本记录的切片发布与缓存规则，本记录仍拥有标题栏交互、目标/开关独立和生命周期。[通用层](2026-10-04-universal-translation-layer.zh.md)保留 provider 顺序与模型隔离。[市场路由](../architecture/2026-10-05-market-document-translation-route-and-identity.zh.md)保留独立查找范围与共享文档身份。这些记录没有被完全取代或归档。
