# Agent Note：工作区单页六 Tab、用户面板增删改查、套件详情 MCP 只读

Status: implemented

## 问题

十一项体验反馈集中到来；其中四项带有值得记录的决策：

1. **套件详情弹窗把预览与配置混在一起。** MCP 区域内嵌了凭据编辑器和逐服务覆盖表单，而详情弹窗本质上是套件文件的「预读」。凭据与覆盖是套件的**运行时**事实——它们属于 MCP 服务面板（旁边就是挂载诊断），不属于目录预览。
2. **删除源后克隆目录留在磁盘上，界面随后反复提示。** `removeSource` 从不删除 checkout；下一次 overview 把它列进「检测到未登记的本地仓库」，诱导一次收编——把用户刚刚删掉的市场又复活回来。可疑提示的根源是删除对话框没有提供物理删除。
3. **六个面板以三个并列设置区存在**（市场、MCP、LSP），而技能 / 命令 / 代理角色完全没有管理界面：无处查看用户自建条目、无处不删而禁用、无处新建。
4. **每个面板各自实现列表/滚动/操作**，滚动条显隐让切换时整列抖动（滚动发生在整个设置列上）。

## 决策

遮罩展示与操作租约分离：立即启动透明交互保护，200ms 后显示视觉遮罩，最短展示 400ms，结束后保留 100ms 缓冲。新请求取消撤除而不重新挂载遮罩，避免反复播放入场动画。时序只影响展示，不延迟请求执行或 Promise 返回。

执行状态使用唯一的 body 级阻挡遮罩，覆盖当前窗口或工作区。带引用计数的操作租约跨越请求及后续刷新，finally 清理保留原始错误，避免并发操作互相提前撤掉遮罩。原 BusyIndicator 浮层模式改为不占布局的租约，以覆盖局部流程状态。通过 inert 和事件捕获阻止窗口背景点击与 Escape，结束后恢复原焦点和 inert 状态。活动期间跟随窗口变换；加载图标与轮播提示不会改变列表几何布局。

`DetailModal` 统一市场、Markdown、MCP、LSP 详情的宽屏视口约束。`MarkdownDocument` 将结构化 frontmatter 与 Markdown 正文分开展示，原文仍是数据来源。`ServerConfigEditor` 在固定表单和原始 JSON 之间使用同一份草稿，阻止非法转换。单服务完整替换在持久化前校验；脱敏值往返保留原凭据，LSP 配置指纹确保编辑后重新挂载。这取代原有窄屏纯文本编辑器，市场内 suite 预览仍保持只读。

六个 Tab 使用 `ResourceCard`、`ResourceCollection` 统一状态边框与卡片/列表布局，使用 `PanelHeader`、`PanelActions` 将新增/刷新放到右上方，使用 `SearchFilterToolbar` 处理搜索和筛选。`useWorkspaceView` 通过 `dsh-agent-plugins-market:view` 保存统一视图偏好，并同步已挂载面板和浏览器标签页。不同资源的搜索词和筛选值保持独立。来源标签表达归属；卡片边框表达状态：启用为绿色，禁用为灰色，警告为黄色，失败为红色。

- **一个工作区页、六个顶部 Tab**（`PluginWorkspace`）：`settings.section` 从三条注册收敛为一条，内部承载 Tab 行（市场 / 技能 / 命令 / 代理角色 / MCP / LSP）。Tab 状态为组件局部；深链走 `#/agent-plugins/<tab>`。每个 Tab 在自己的区域内滚动（从 workspace 链路到 market/mcp CSS 统一 `overflow-y: auto; scrollbar-gutter: stable`），宿主 `.options` 容器不再是滚动者，滚动条显隐不再移动布局。
- **套件详情 MCP 区域只读。** 凭据编辑器与覆盖表单移出 `SuiteDetailModal`；展开后仅展示校验过的配置 JSON 与停用徽标。`McpStatusPanel` 的详情弹窗仍是编辑凭据/覆盖的唯一入口。
- **物理删除是可选的、逐次确认的。** `removeSource(id, deleteCheckout)` 仅在确认对话框勾选「同时删除市场目录」时删除 checkout（默认勾选）。`.sources/<id>` 下的目录属于管理器存储，即使来源是收编的也会被删除；只有 URL 指向 `.sources/` 之外的 `local` 源是仅取消登记、目录永不删除。删除 checkout 正是真正删除的市场不再出现在「未登记」提示里的原因。
- **用户面板以 Markdown 持久化，而非 state JSON。** 技能 / 命令 / 代理角色存于 `userRoot/user/{skills,commands,agents}/*.md`，沿用与套件相同的 frontmatter 语法（`description`、`argument-hint`、invocation 开关）外加面板控制键 `disabled: true`。一个 `UserPanelStore` CRUD 类服务三个面板；第二个技能提供者（`UserPanelSkillProvider`，rank 600，来源 `user-panel`）仅把技能送进技能注册表；角色使用[持久化子代理目录](../architecture/2026-09-09-subagent-catalog.zh.md)，`UserCommandMountRegistry` 在同一条变更管线里把用户命令调和为斜杠命令。禁用条目在发现阶段即被跳过——禁用即卸载，而非状态翻转。
- **用户存储统一到一个根目录。** `userRoot` 固定解析为 `$DSH_HOME/agent-plugins`（默认 `~/.dsh/agent-plugins`），可变数据位于其 `data/` 下。旧根目录配置仅作为迁移输入。激活等待旧目录、同级 `agent-plugins-data` 和 `data/user` 条目迁移完成；冲突文件保留原路径并阻止激活，拒绝符号链接根目录，在移动 checkout 前检测旧安装状态的格式错误。项目维度和显式登记的外部本地来源保留就地读取语义。
- **代理角色按保存的策略执行。** `subagents_run` 在运行时读取角色 Markdown frontmatter 中的 `model`、`provider`、`reasoning_effort`、`tools` 和 `disallowedTools`，通过 `subagents.start` 启动真实子代理，将模型选择作为 `agentOptions`、角色正文作为 `persona`、工具限制作为 `toolFilter` 传入。详情编辑器把这些配置放在正文上方，并保存到同一 frontmatter。未指定模型或填写 `inherit` 时沿用父级选择；单独模型 id 必须唯一匹配一个 provider，显式 provider/model 配置则支持 provider 专用 id。无效或歧义配置在启动子代理前报错。
- **公共构件优先于逐面板复制**（`client/ui/panel.tsx`）：`PanelShell`（标题/操作/滚动体）、`BusyIndicator`（全局进行中加载动画，含浮层变体）、`EntryEditorModal`、`ConfirmModal`、`SourceBadge` 与共享的 `panel.module.css`。三个用户面板在字面上是同一个组件（`UserPanelSurface`）按 kind 参数化；市场与 MCP 面板嵌入同一加载动画，`SearchFilterToolbar` 增加统一的 `＋ 新增` 席位。
- **反馈工具是 model 工具，不是命令。** `report_market_issue` 通过 `ctx.tools` 注册，受既有 `dsh-agent-plugins-market` 命名空间中 `feedbackEnabled` 设置字段（默认 true）控制；watcher 实时挂载/卸载。存在 `GITHUB_TOKEN`/`GH_TOKEN` 时直接开 GitHub Issue，否则追加 JSONL 到 `data/feedback/` 本地卷宗；时间戳文件以 60 秒为限防止连发。`@deepseek-ai/dsh-tools` 以可选身份加入 peer/dev 依赖——包缺失处工具 simply 不挂载。

供应商和模型使用联动下拉，读取 DSH 当前 LLM 注册表。`model-catalog` 只返回公开身份字段，每次只读取选中供应商的模型，等待上限为十秒。切换供应商时取消或忽略旧请求；未在目录中的已保存模型仍展示并保留，直到用户主动选择替换。插件启动时不读取模型目录。

兼容页面适配器只在打开时挂载工作区，不与其他扩展争抢“新会话”紧邻位置；MutationObserver 忽略工作区内部变更，避免多个侧栏扩展反复重排导致浏览器失去响应。关闭工作区释放组件树和未保存草稿。

## 已考虑的替代方案

- 渲染六条 `settings.section` 被否决：一个插件把侧栏撑成六行，而需求本就是「一页内 Tab 切换」。
- 把用户条目存进 `state.json` 被否决：技能/命令/角色卡是多行 Markdown 文档；文件形式可 diff、可手编，并与套件面对称。
- 通过翻转 invocation frontmatter 来禁用用户技能被否决：那会把作者的路由意图与面板的运行时控制混为一谈；独立的 `disabled` 键让两者都可逆。
- 每次删除源都自动删 checkout 被否决：从对话框默认值静默 `rm -rf` 一棵目录树站错了取舍的另一边；勾选框让破坏性路径显式化，同时保持一步可达。
- 保留详情弹窗内的覆盖编辑器（未安装时禁用）被否决：一份记录两个编辑器必然 UX 分叉；MCP 面板已经拥有凭据、重试与重新授权。

## 风险

- `SuiteDetailModal` 不再接收 `credentials`；外部嵌入方继续传参不受影响（可选 prop），但套件上下文中的凭据编辑变为跳转 MCP 面板。
- 仅当 HTTP 层拿到面板存储（`mountSuiteRoutes` 第三参数）时才挂载用户面板路由；不传的宿主看到的路由表与从前完全一致。
- `scrollbar-gutter: stable` 在每个面板保留 gutter；不支持的浏览器退化为自动 gutter（抖动回归，但无破坏）。
- 用户技能 rank 600，低于所有内建根：同名时用户技能永不遮蔽套件技能；改名是逃生通道。

## 验证

- `pnpm run check:refactor`（typecheck、lint、format、routes+contracts 测试、dependency-cruiser）全绿。
- 新增测试：`tests/user-panels.test.ts`（存储 CRUD、禁用往返、提供者发现、frontmatter 助手）、`tests/feedback-tool.test.ts`（本地卷宗、冷却、正文渲染）、条件面板路由与 `deleteCheckout` 透传的路由测试，以及证明收编的 `.sources` 检出在 `deleteCheckout: true` 下被删除、而外部 `local` 目录存活下来的 source-acquisition 用例。
- 全量 `pnpm run test`：46 个文件、300+ 测试全绿。

## 关联

- 扩展 [2026-09-01-source-acquisition-expansion](2026-09-01-source-acquisition-expansion.md) 的删除语义（`.sources/<id>` 检出获得可选物理删除，仅 `.sources/` 之外的本地目录受保护）。
