# 客户端 UI 自研面 vs 官方 ui-primitives（rc.2）对照矩阵

任务：盘点 `src/client/ui/*` 与 `src/client/features/*` 的自建 UI 组件/工具，对照 npm 已发布的 `@deepseek-ai/dsh-client-ui-primitives@0.1.7-rc.2`（及 `dsh-client-ui-settings` / `dsh-client-ui-slots` / `dsh-client-ui-theme` / `dsh-client-store`）的真实导出，给出复用判定。

## 证据基线（2026-09-26 核验）

- 判定权威 = npm registry 精确版本元数据 + tarball 实文件，不是宿主 checkout：
  - `@deepseek-ai/dsh-client-ui-primitives@0.1.7-rc.2`、`dsh-client-ui-settings@0.1.7-rc.2`、`dsh-client-ui-slots@0.1.7-rc.2`、`dsh-client-ui-theme@0.1.7-rc.2`、`dsh-client-store@0.1.7-rc.2`、`dsh-client-ui-plugin-manager@0.1.7-rc.2`、`dsh-client-ui-settings-plugins@0.1.7-rc.2` —— registry 精确版本全部 HTTP 200（已发布），tarball 下载到 `/tmp/reuse-audit-tarballs/` 解包核对 `files`。
  - 本仓库 `node_modules/@deepseek-ai/*` 实装 rc.2，`package.json` exports 与 tarball 一致，双核验通过。
- rc.2 tarball 的 `exports["./src/*"]` 指向包内不存在的 `src/`（tarball 无 src），**唯一可 import 面是 `lib/index.js`（+ settings/theme/plugin-manager 的 `./client`）与 `.d.ts` 类型 + `.module.css`**；`d.ts` 从 `lib/types/` 实读。
- ui-primitives 公开导出面（`lib/types/index.d.ts`，96 行逐条核对）：原子 Button、Checkbox、Input、Switch、Pill、Tag、StateDot、Tooltip、Toast、Modal、RiskConfirmation、DisclosureRow、SegmentedControl、SegmentedTabs、SegmentedControlOption、Menu/MenuSurface、HoverCard、ShortcutKeys、PathLabel、ConnectionIndicator、TextShimmer、JsonTree、TerminalBlock、ReadBlock、DiffBlock、SearchBlock、WebBlock、ImageLightbox、FileTypeIcon、图标全集（`Icon*Regular`/`Icon*Medium`）、plugin/guide artwork、FishLogo/BrandWordmark；工具 relativeTime、rankByName、fileSizeText、writeClipboard、focusWithoutRing、observeComposition、closeTopModal/isBehindModal/modalSelector/useModalLayer、useAnchoredPosition/useAnchoredMaxHeight、useDismissOnOutsidePointer、CODE_HIGHLIGHT_EXTENSIONS/languageForPath/useCodeHighlighter、projectUserText、extractMarkdownPlainText、MarkdownText/CodeBlock/JsonBlock/MarkdownDelegateProvider 及 MarkdownLabels 类型、SettingsForm/SettingsSecretField/SettingsValueField/SettingsFormModel/settingsNumberField/settingsTextField 及类型；`CodeToolbarLabels` 类型公开（组件未公开）。
- 宿主 master（477b4f4205，前瞻参考）grep `BusyOverlay|DetailRow|ResourceCard|StatusBand|SearchFilterToolbar` 于 `packages/client`：零匹配 —— 官方没有这些形态，也不在可见的前瞻线上。

## 总览结论

1. **消费面已经很宽**：`src/client` 有 27 个文件、31 条 import 直接消费官方包（`src/client/index.ts` 还带 `missingPrimitives` 降级守卫）。组件层的「纯自研」只剩 7 个文件：ResourceCard、DetailRows、StatusBand、BusyOverlay、SearchFilterToolbar、SourceTabsRow/SourceTab、PluginWorkspace 的 tab 行，外加 SearchFilterToolbar 内 2 个自绘 view glyph。
2. **最大一块可评估的官方替换不在原语层，而在卡片层**：`plugin-card-controller.ts`（348 行）自建的暂存/保存/修订围栏模型，与 rc.2 **已公开导出**的 `SettingsFormModel` + `settingsNumberField`/`settingsTextField` + `SettingsForm`/`SettingsSecretField` 职责重合 —— 建议立项迁移（P1）。
3. **rc.2 新发布的 `SegmentedControl`/`SegmentedTabs` 是本矩阵最大的新增替换机会**：本仓库 4 处手工段控（SearchFilterToolbar 过滤段、MarketSection 状态 tab、ServerConfigEditor form/json 切换、PluginWorkspace 主 tab）都可用它收敛（P2）。
4. 剩余自研全部有 JSDoc/ADR 级别的成文理由（DisclosureRow 形状不合、官方无编辑器、官方无目标遮罩等），归「有意自建/维持」。
5. css-modules 与 `--dsw-*` token 合规不在本次范围（任务书明确跳过）。

## 矩阵一：src/client/ui 组件层

| 自研实现(文件) | 规模(行) | 官方对应物(包@版本/导出名) | 发布状态 | 判定 | 处置建议 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| ui/ResourceCard.tsx（ResourceCard/ResourceCollection） | 23 | 无（官方无卡片容器原语；Pill/Tag/StateDot 是行内原子） | - | 有意自建 | 维持 | ui-primitives rc.2 `lib/types/index.d.ts` 无 Card 类导出；宿主 master grep 无 ResourceCard。卡片 3px 状态边条形态归 AGENTS.local.md 样式规范 |
| ui/resource-card.module.css | 434 | 同上 | - | 有意自建 | 维持 | 同上；token 合规范围外 |
| ui/DetailModal.tsx（DetailFooterAction/DetailSize） | 37 | `dsh-client-ui-primitives@0.1.7-rc.2` / Modal（已消费） | 已发布 | 用宿主（薄壳合成） | 维持 | 源文件 import Modal；size 三档 + footer 动作 portal 是本仓库对话框语言，官方 Modal 无此座 |
| ui/DetailRows.tsx（DetailRows/DetailRow） | 59 | `…primitives@0.1.7-rc.2` / DisclosureRow | 已发布 | 有意自建 | 维持；backlog(P3) 可再评估 | 文件头 JSDoc：DisclosureRow 是 24px 单行流式行、chevron 前置 hover 才现、无 hover/展开底色，与三列带（名/摘要/尾 chevron）不可从外部调和。已消费其 IconChevron* |
| ui/SearchFilterToolbar.tsx | 117 | Input、Pill（已消费）；过滤段 ↔ SegmentedControl（未用） | 已发布 | 部分可替换 | backlog(P2)：过滤段换 SegmentedControl；视图单键保留 | rc.2 SegmentedControl d.ts：受控 tablist+roving tabindex；现实现用 Pill+aria-pressed 手工段。视图切换是单键两态，官方无独立原语 |
| ui/SearchFilterToolbar.module.css | 74 | - | - | 有意自建 | 维持 | 样式范围外 |
| ui/StatusBand.tsx | 97 | StateDot、DisclosureRow（已消费） | 已发布 | 有意自建（领域复合件） | 维持 | 组合官方原子；失败分类句、诊断 disclosure、3px 边条语义是 MCP/LSP 领域语言 |
| ui/CodeEditor.tsx | 115 | 无（官方 ReadBlock/CodeBlock/TerminalBlock 均只读） | - | 有意自建 | 维持 | 文件头 JSDoc 记录理由；CodeMirror 6 主题全走 --dsw-* token |
| ui/BusyOverlay.tsx | 164 | 无 | - | 有意自建 | 维持 | 租约模型(busy-operation)+目标级 inert/focus-trap+20s 慢操作看门狗；官方 Toast/Modal/TextShimmer 无目标遮罩语义；宿主 master grep 无 BusyOverlay |
| ui/MarkdownDocument.tsx | 28 | `…primitives@0.1.7-rc.2` / MarkdownText（已消费，labels 契约随 locales） | 已发布 | 用宿主（领域薄壳） | 维持 | frontmatter 原样展示是「诚实预览」的领域决策；0.1.2 起 MarkdownText 需 labels，已由 locales 提供 |
| ui/panel.tsx（PanelActions/PanelHeader/BusyIndicator/EntryEditorModal/ConfirmModal） | 257 | Button、Modal（已消费）；ConfirmModal ↔ RiskConfirmation | 已发布 | 有意自建（组合层） | 维持；backlog(P3) 评估 ConfirmModal 是否并到 Risk 形态 | RiskConfirmation 是 in-page 确认（acknowledged 门控），ConfirmModal 是 Modal 危险确认+可选 checkbox，形态不同职责近邻 |
| ui/RoleMetadataFields.tsx | 144 | 无（persona provider/model/reasoning 路由=领域） | - | 有意自建 | 维持 | fetchModelCatalog 驱动的路由字段，官方 settings-form 是 settings 卡片域，不管 persona frontmatter |
| ui/ServerConfigEditor.tsx | 557 | Button、IconPlus/Trash（已消费）；form/json 切换 ↔ SegmentedControl（未用） | 已发布（切换器） | 领域自建+局部可替换 | backlog(P2)：切换段换 SegmentedControl | JSON 双视图（非法 JSON 保留）、模板、粘贴解析是 mcp/lsp 配置域核心；官方 settings-form 是 settings 卡片域不覆盖 |
| ui/ServerConfigDetail.tsx | 175 | Button（已消费） | 已发布 | 用宿主（组合层） | 维持 | 组合 ServerConfigEditor+DetailFooterAction |
| ui/UserPanelSurface.tsx | 390 | Switch、Tag、IconEdit/Trash（已消费） | 已发布 | 用宿主（组合层） | 维持 | 一套实现驱三个面板（skills/commands/personas），检索/过滤/CRUD 已组件化 |
| ui/UserEntryDetail.tsx | 117 | StateDot、Tag（已消费） | 已发布 | 用宿主（组合层） | 维持 | 组合 DetailModal/MarkdownDocument/DetailRows |
| 图标面（各组件内 import 的 Icon*Medium） | - | `…primitives@0.1.7-rc.2` / icons 全集 | 已发布 | 用宿主（已用） | 维持 | 11 个文件 import 官方图标；唯一自绘例外是 SearchFilterToolbar.ViewIcon 的列表/网格 glyph，官方无 grid glyph，维持 |

## 矩阵二：src/client/ui 非组件工具

| 自研实现(文件) | 规模(行) | 官方对应物(包@版本/导出名) | 发布状态 | 判定 | 处置建议 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| ui/busy-operation.ts | 48 | 无 | - | 有意自建 | 维持 | 租约计数+useSyncExternalStore 快照；官方无操作租约原语 |
| ui/error-message.ts | 18 | 无 | - | 有意自建 | 维持 | RequestTimeoutError 词汇归一；8 行逻辑 |
| ui/failure-guidance.ts | 105 | 无 | - | 有意自建 | 维持 | 20 类失败分类器（mount/MCP SDK/LSP/宿主 backend 词汇），领域知识 |
| ui/frontmatter.ts | 78 | 无（yaml 库直用） | - | 有意自建 | 维持 | parseDocument 保留注释/嵌套；argument-hint 双写法兼容 |
| ui/json-tree-labels.ts | 27 | `…primitives@0.1.7-rc.2` / JsonTreeLabels 类型（已消费） | 已发布 | 用宿主（已用） | 维持 | 三处 JSON 树共用一份措辞工厂 |
| ui/last-change.ts | 23 | `…primitives@0.1.7-rc.2` / relativeTime（已消费） | 已发布 | 用宿主（已用） | 维持 | 桶归一在宿主、措辞在本地，正是官方分工 |
| ui/workspace-view.ts | 57 | `dsh-client-store@0.1.7-rc.2` / createSnapshotStore({persist})（已消费） | 已发布 | 用宿主（已用） | 维持 | 浏览器本地偏好走平台 store 持久化，账目底稿第 4 条 |
| ui/server-form.ts | 304 | 无 | - | 有意自建 | 维持 | mcpServers/harness 命名空间文档模型+粘贴解析+超时策略，wire 契约域 |

## 矩阵三：src/client/features/*

| 自研实现(文件) | 规模(行) | 官方对应物(包@版本/导出名) | 发布状态 | 判定 | 处置建议 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| features/settings-card/plugin-card-controller.ts | 348 | `dsh-client-ui-primitives@0.1.7-rc.2` / settings-form 导出组：SettingsFormModel、SettingsFieldSpec、settingsNumberField、settingsTextField、SettingsFormShell、SettingsFormActions + `dsh-client-ui-settings@0.1.7-rc.2` / ConfigForm（已消费 scope） | 已发布 | **可替换（官方模型已可用）** | backlog(P1)：迁移到 SettingsFormModel+SettingsForm/fields；迁移时验证 plugins.item 的 inject 面（hooks 座）与官方 actions 的对接 | rc.2 公开 index 明确导出 SettingsFormModel 组（ConfigField 反而未进 index）；官方模型覆盖暂存/修订围栏保存/失败保留草稿/unset 复位，与自建语义逐条对应。现 controller 只消费 ConfigForm+createSnapshotStore 自拼 |
| features/settings-card/McpPluginCard.tsx | 209 | Switch、Tag（已消费）+ `dsh-client-ui-plugin-manager@0.1.7-rc.2` / plugins.item 契约（已消费，type-only）+ `dsh-client-ui-slots@0.1.7-rc.2` / PropsRuntime（已消费） | 已发布 | 用宿主（契约已用） | 维持；随 P1 迁移改用 SettingsForm 渲染 | 卡片走宿主 plugins.item summary/page 双视图，契约类型由 plugin-manager/client 提供 |
| features/market/MarketSection.tsx | 431 | Button/Modal/RiskConfirmation/Toast（已消费）；状态 tab 行 ↔ SegmentedControl（未用） | 已发布（切换器） | 组合层维持+局部可替换 | backlog(P2)：状态 tab（all/installed/uninstalled）换 SegmentedControl | 现为 SearchFilterToolbar.filters 的 Pill 段；SegmentedControl 受控 tablist 语义等价 |
| features/market/SuiteCard.tsx | 168 | Button/IconRefresh/IconTrash/Switch/Tag/Tooltip（已消费） | 已发布 | 用宿主（组合层） | 维持 | 卡片解剖归 AGENTS.local.md 形态规范 |
| features/market/SuiteDetail.tsx | 325 | Button/JsonTree/StateDot/Tag（已消费） | 已发布 | 用宿主（组合层） | 维持 | JSON 树 labels 经 json-tree-labels 工厂 |
| features/market/SourceTabsRow.tsx | 142 | 无（可折叠 pill 网格+trailing 编辑/删除=领域控件） | - | 有意自建 | 维持 | SegmentedTabs 无法承载 trailing 动作钮；折叠展开交互是领域行为 |
| features/market/SourceTab.tsx | 61 | 无 | - | 有意自建 | 维持 | 同上 |
| features/market/SourceEditorModal.tsx | 119 | Button/Modal（已消费） | 已发布 | 用宿主（组合层） | 维持 | - |
| features/market/InstallConfirmModal.tsx | 84 | Modal（已消费）；RiskConfirmation（未用） | 已发布 | 职责近邻 | backlog(P2)：评估改 RiskConfirmation（acknowledge 勾选+确认），保留面数概要需确认其 description 可承载 | rc.2 RiskConfirmation d.ts：in-page 确认，acknowledged 门控主操作；现实现是 Modal+计数+风险句 |
| features/market/market-resource.ts | 68 | 无（概览缓存+进度轮询；宿主 schedule 包语义不同，见账目底稿） | - | 有意自建 | 维持 | 已定决策：reconcile/缓存类不迁 ctx.jobs |
| features/market/market-view-model.ts | 55 | 无（纯函数） | - | 有意自建 | 维持 | 过滤/计数推导，可测纯层 |
| features/market/suite-detail-resource.ts | 20 | 无（纯函数） | - | 有意自建 | 维持 | 最新请求胜出守卫 |
| features/mcp/StatusPanel.tsx | 297 | Button/IconEdit/Switch/Tag（已消费） | 已发布 | 用宿主（组合层） | 维持 | 形态规范参照件（3px 边条状态卡） |
| features/mcp/McpDetailModal.tsx | 305 | Button/IconRefresh/IconSearch/Input/Tag（已消费） | 已发布 | 用宿主（组合层） | 维持 | - |
| features/mcp/McpAddModal.tsx | 202 | Button（已消费） | 已发布 | 用宿主（组合层） | 维持 | - |
| features/mcp/McpConfigModal.tsx | 22 | -（组合 ServerConfigEditor） | - | 用宿主（组合层） | 维持 | - |
| features/mcp/McpCredentialEditor.tsx | 159 | `…primitives@0.1.7-rc.2` / SettingsSecretField（settings-form/fields，未用） | 已发布 | 职责重叠 | backlog(P1)：随 plugin-card-controller 迁移一并评估；其语义绑定 SettingsFormModel 的 SettingsSecretSpec，单拆无意义 | rc.2 公开 index 导出 SettingsSecretField/SettingsValueField/SettingsFieldProps；现编辑器自带写-only 流（值只过线一次），语义可映射到 SettingsSecretSpec.write |
| features/mcp/detail-helpers.ts | 65 | 无（领域） | - | 有意自建 | 维持 | 工具参数行+凭证用量 |
| features/mcp/detail-actions.ts | 18 | 无（领域） | - | 有意自建 | 维持 | 动作表 |
| features/mcp/state-helpers.ts | 50 | 无（领域） | - | 有意自建 | 维持 | 卡片状态/Tag tone/dot 映射 |
| features/mcp/mcp-status-view-model.ts | 116 | 无（纯函数） | - | 有意自建 | 维持 | 过滤/计数推导 |
| features/lsp/LspStatusPanel.tsx | 511 | Button/IconEdit/Switch/Tag（已消费） | 已发布 | 用宿主（组合层） | 维持 | 声明+诊断模型是 LSP 自供域（已定决策） |
| features/lsp/lsp-status-view-model.ts | 66 | 无（纯函数） | - | 有意自建 | 维持 | 过滤/严重度排序 |

## 矩阵四：workspace 与根级客户端文件（补全盘点）

| 自研实现(文件) | 规模(行) | 官方对应物(包@版本/导出名) | 发布状态 | 判定 | 处置建议 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| workspace/PluginWorkspace.tsx | 112 | 主 tab 行 ↔ `…primitives@0.1.7-rc.2` / SegmentedTabs（未用） | 已发布 | 部分可替换 | backlog(P2)：tab 行换 SegmentedTabs；保留 hash 深链（#/agent-plugins/<tab>）与 per-tab 滚动 | rc.2 SegmentedTabs d.ts：受控等宽 tab+滑动指示器+roving tabindex；现手写 role=tablist 按钮行 |
| workspace/page-mode.tsx | 249 | 无（旧壳 DOM 适配） | - | 有意自建 | 维持 | 旧宿主回退，能力判定在 page-mode-selection |
| workspace/page-mode-selection.ts | 13 | 无（纯函数） | - | 有意自建 | 维持 | - |
| ErrorBoundary.tsx | 38 | 无（React 类边界，第三方内容降级） | - | 有意自建 | 维持 | 不可信预览内容的失败封闭 |
| layout-label.ts | 21 | 无（领域） | - | 有意自建 | 维持 | 布局标签映射 |
| request-error.ts | 16 | 无（领域） | - | 有意自建 | 维持 | 超时词汇独立于 wire 模块 |
| api.ts / credentials.ts / locales.ts / index.ts | - | index.ts 消费 primitives 全量+settings/client ConfigForm（已消费） | 已发布 | 用宿主（已用） | 维持 | index.ts 带 missingPrimitives 降级守卫（REQUIRED_PRIMITIVES 五件） |

## 有意自建的理由（AGENTS.md「Alternatives considered」对账）

- **DetailRows vs DisclosureRow**：文件头 JSDoc 记录形状不可调和（24px 单行流式 vs 三列带）——成立，维持。
- **CodeEditor**：官方只有只读块（ReadBlock/CodeBlock/TerminalBlock），无编辑器；CodeMirror 6 主题走平台 token——成立，维持。
- **BusyOverlay**：官方无目标遮罩/操作租约原语，宿主 master 亦无前瞻——成立，维持。
- **market-resource 缓存/轮询**：`ctx.jobs`/`packages/schedule` 语义不同（账目底稿已定）——成立，维持。
- **卡片暂存模型（plugin-card-controller）**：当年契约记录为「只能照契约自建」；rc.2 起官方模型与表单件已公开导出，理由**已失效**，这是本矩阵唯一建议立项的替换（P1）。
- css-modules 与 --dsw-* token 使用合规：范围外，未评估。

## 未决清单

1. **SegmentedControl/SegmentedTabs 的视觉契合度**：tablist 语义等价已证实，但按下态填充、折叠行为与本仓库列表卡片规范（AGENTS.local.md）是否一致，需实现 spike 验证后才能把 P2 各项从 backlog 转「已排期」。
2. **InstallConfirmModal → RiskConfirmation 的信息架构**：官方组件的 description 是纯文本位，安装确认的「per-surface 计数块」能否无损承载是产品判断，未决。
3. **McpCredentialEditor → SettingsSecretField**：官方字段绑定 SettingsFormModel 生命周期（不独立可用），只能随 P1 整体迁移；迁移后 credentials 写-only 语义（值只过线一次）是否被 SettingsSecretSpec.write 完整保留，需在迁移设计中确认。
4. **Taskflow 提示**：本次核验时 `dsh-client-ui-theme@0.1.7-rc.2` 已发布但未进本仓库 devDependencies 镜像；本插件客户端不直接消费 theme 包（token 从宿主样式表继承），暂无动作，仅记录。

## 前瞻（宿主 master 有、npm 未发）

- **ConfigField**（`ui-primitives`）：宿主 master `src/ConfigField.tsx` 存在，rc.2 tarball 有 `lib/types/ConfigField.d.ts` 但**未进公开 index**（不可稳定 import）。若后续版本转正，矩阵三 P1 的表单字段层可再评估一次。
- **CodeCard**：rc.2 tarball 已带 `lib/CodeCard.module.css` 但无组件类型/导出；宿主 master 有 CodeCard+CodeToolbar（CodeToolbarLabels 类型已公开）。代码查看卡片若转正，CodeEditor 的「预览半边」可部分让位（编辑半边仍是 CodeMirror）。
- **BusyOverlay/操作租约、卡片列表容器（ResourceCard 形态）、DisclosureRow 三列带变体**：宿主 master `packages/client` grep 零匹配，无前瞻替换项，维持自建。
- 其余宿主 client 能力包（ui-jobs、ui-deliverables、ui-directory-picker-browse/native、ui-layout、ui-settings-plugins 等）rc.2 **均已发布**，与本客户端 UI 组件层的重叠评估归任务 #2（host-capability-matrix.md），本文件不展开。
