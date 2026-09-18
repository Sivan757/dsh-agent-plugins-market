### 十一、详情弹窗按原型复核

卡片与编辑器对齐后，套件详情仍是更早一版的 IA（标题带版本、副行是操作提示、概览第 4 格是关键词、分组标题 `子代理` / `AGENT PLUGINS 目录` / `校验问题`、空分组渲染 `—`、技能行的长 frontmatter 描述撑成一段）。本轮按原型（截图 30）改齐。

| # | 条目 | 落点 | 实测 |
| --- | --- | --- | --- |
| H1 | 标题只写名称 | `SuiteDetail.tsx` | 标题 `aliyunlog`，版本留在状态带的胶囊里 |
| H2 | 副行改为 `插件套件 · <来源>` | 新增 `detailKicker` | 走查中显示 `插件套件 · agent-plugins` |
| H3 | 概览四格按原型 | 第 4 格改「最近变更」：`SuiteDetail.updatedAt`（检出目录 mtime，ISO）由 `buildSuiteDetail` 计算，客户端用宿主 `relativeTime` 分桶 + 本地文案渲染 | 走查中 `来源套件 agent-plugins / 布局 Claude Code / 作者 Agent Plugins / 最近变更 3 天前` |
| H4 | 分组与用语 | `agentsSection` 子代理→代理角色、`rootLabel`→根目录、`errors` 校验问题→校验诊断、`sourceLabel` 来源→来源套件；`block()` 在空分组时整组不渲染，校验诊断始终渲染（无问题给出通过说明） | 走查中分组只剩 `概览 / 描述 / 根目录 / 技能 (1) / 校验诊断 (0)` |
| H5 | 行摘要压成一行 | `row()` 的 `collapsedContent` 改为带 `.rowSummary`（`flex:1`、`min-width:0`、`padding-left:10px`、省略号）的 span | 走查中技能行是单行省略，不再撑成段落 |

### 走查配方更正（重要）

插件客户端 bundle 由宿主按**内容哈希 rev** 寻址：`/plugins/??<id>/client.js&rev=<hash>`，而这个 URL 来自启动时生成的 boot 载荷。**重建 `client/` 后仅刷新页面不会生效**——页面仍在请求旧 rev，浏览器命中旧模块缓存。已实测：`build:client` 后 reload，改动不可见；重启 `dsh web` 后同一处改动立刻可见。

因此每次改客户端都要**重启承载该 profile 的 `dsh web` 进程**（或同时跑 `pnpm run dev:web`，由 HMR 链推送新 rev）。本次排查中，用户界面所在进程 `dsh web` 起于当天 09:59，早于全部构建，这是「改了几遍都还是旧界面」的直接原因。

Agent Plugins 工作台 UI 优化 — 落地进度

跟踪文件：本文件即进度看板。设计与范围见 [plugin-workspace-ui-optimization.md](plugin-workspace-ui-optimization.md)，视觉基准见 `workspace-redesign/preview-a.png` 与 `workspace-redesign/preview-a-detail.png`（原型文件已移出仓库，临时存放于 `/tmp/dsh-proto-shots/prototype/prototype-a-unified-grid.html`）。

状态：**已按原型复核并补齐交互、显隐、编辑页与编辑器表单样式**（见第七、九节）。决策记录见 [.agents/notes/implemented/feature/2026-09-14-workspace-card-anatomy-and-host-affordances.md](../../../../.agents/notes/implemented/feature/2026-09-14-workspace-card-anatomy-and-host-affordances.md)、[.agents/notes/implemented/feature/2026-09-16-workspace-live-card-affordances.md](../../../../.agents/notes/implemented/feature/2026-09-16-workspace-live-card-affordances.md) 与 [.agents/notes/implemented/feature/2026-09-16-workspace-editor-chrome.md](../../../../.agents/notes/implemented/feature/2026-09-16-workspace-editor-chrome.md)。

## 一、主体改动

| # | 条目 | 落点 | 验证 |
| --- | --- | --- | --- |
| C1 | 统一卡片句法 | 新增共享槽位层 `src/client/ui/resource-card.module.css`（`rowId / rowBody / rowFoot / rowActions` + `name / version / desc / monoLine / provenance / count / countValue / iconBtn / revealOnHover`）；`features/market/SuiteCard.tsx`、`ui/UserPanelSurface.tsx`（`UserEntryRow`）、`McpStatusPanel.tsx`（`McpCard`）、`LspStatusPanel.tsx`（`LspRow`）全部改写 | 独立 profile 走查下六页签同句法、同行等高 |
| C2 | 栅格几何 | `repeat(auto-fill, minmax(320px, 1fr))`、`grid-auto-rows: 122px`、列表行 56px；断点改容器查询 | 走查中面板宽 750px 时 2 列，窄容器降至 1 列 |
| C3 | 操作簇放身份行右侧 | `resource-card.module.css` 网格模板 `'id act' / 'body body' / 'foot foot'` | 暗色截图 `aliyunlog v1.7.1 用户级 [安装]` 同行，描述整宽 |
| C4 | 仓库来源条保持现状 | 未改动 `features/market/SourceTabsRow.tsx`、`SourceTab.tsx` 与相关 CSS；只修正了与调用方 chip 顺序矛盾的模块注释 | 走查中胶囊、两行折叠、选中来源改名、前导 `全部` 与线上一致 |
| C5 | 工具栏分段控件 | `SearchFilterToolbar.tsx` + `.module.css`：筛选与视图各一段宿主 `Pill`；删除从未渲染的 `icon` 属性与两个自绘筛选图标函数 | `filter-toolbar.test.ts` 断言两段按下态；走查中 `全部/已安装/未安装` 与网格/列表可见 |
| C6 | 弹窗三档 + 详情分块 | `ui/DetailModal.tsx`（`sm 460 / md 640 / lg 880`）+ `ui/detail.module.css`；`SuiteDetail.tsx` 重写为状态带 + 概览 + 描述 + 根目录 + 按表面分组的可展开条目；新增 `ui/UserEntryDetail.tsx` | 套件详情实测八个分组；用户条目详情可用 |
| C7 | 编辑器双栏 + 分页面标题 | `ui/panel.tsx`（`editorPanes`）+ `ui/panel.module.css`；标题 `新建技能 / 新建命令 / 新建代理角色` | 走查中三个编辑器均 880px 且标题各异 |
| C8 | 卸载走风险确认 | `MarketSection.tsx` 用宿主 `RiskConfirmation`（勾选后主操作可用）；移除来源保留「删除／保留文件」选择框 | 见 Agent Note 的 Alternatives |
| C9 | 宿主组件替换 | `Switch`、`StateDot`、`Tag`、`Pill`、`DisclosureRow`、`JsonTree`、`RiskConfirmation` 全部接入；新增 `ui/json-tree-labels.ts` | `JsonTree` 十项文案中英成对 |
| C11 | 文案与双语 | `locales.ts` 新增 29 组中英 key | `client-locales` 测试通过 |
| C12 | 测试与门禁 | 更新 `tests/user-panel-surface.test.ts`、`tests/filter-toolbar.test.ts` | `check:refactor` 绿；`pnpm run test` 81 文件 / 634 用例绿；`pnpm run build` 成功 |

## 二、收尾轮次（R1–R5）

| # | 条目 | 落点 | 验证 |
| --- | --- | --- | --- |
| R1 | MCP / LSP 详情内部布局 | 两处都改为共享槽位：`McpStatusPanel.tsx` 的 `McpDetailModal`（状态带 + 概览 + 原因 + 凭证编辑 + 工具清单 + 服务配置），`LspStatusPanel.tsx` 的 `LspDetailModal`（状态带 + 概览 + 原因 + 语言扩展名逐行 + 服务配置）；新增 `mcpTagTone` / `mcpStateLabel` / `lspDotState` / `lspTagTone` 与六个 MCP 状态文案；删除 `dotClass` / `pillClass` / `.statusDot` / `.statePill` 一族 | `tsc` + `eslint` 绿；走查中 MCP 详情渲染出概览与工具清单 |
| R2 | 添加来源弹窗宽度 | `market.module.css .editorDialog` 从 `500px` 收到 `640px`（md 档） | 走查实测 640px |
| R3 | 死代码与死规则清理 | 删除 `ui/ToggleSwitch.tsx`、`ui/StatusIcon.tsx` 与 `panel.tsx` 的 `SourceBadge`；用一次性脚本按「导入方实际引用」清掉四个样式表里的失效规则（market 52 条、mcp-status 45 条、panel 25 条，字节 49055 → 30887） | 清理后 `tsc` + `eslint` + `pnpm run test` 全绿；`grep` 确认三者无残留引用 |
| R4 | 来源条过期注释 | `SourceTabsRow.tsx` 模块头改为说明「由调用方决定 chip 顺序：`全部` → 选中来源 → 其余按 id」，与实际行为一致 | 与 props 文档、`MarketSection.tsx` 三者一致 |
| R5 | Agent Note 与用户文档 | 新增 `.agents/notes/implemented/feature/2026-09-14-workspace-card-anatomy-and-host-affordances.md` + `.zh.md`；按实现现状修正 `2026-09-02-market-card-platform-affordances` 的中英两版（计数与来源同行、布局标签移入详情、操作簇落在身份行）并互链；`docs/user/usage.md` 与 `usage.zh.md` 同步「三档窗口 / 卡片结构 / 详情分组 / 卸载确认」 | 中英行数保持 171 / 171；`format:check` 绿 |

## 二之二、第三轮（你上手后按反馈的卡片密度）

| # | 反馈 | 处理 | 实测 |
| --- | --- | --- | --- |
| D1 | 卡片模式最少保留两栏 | 轨道下限 `320px` → `260px`，并删掉「容器 ≤700px 时强制单列」那条规则——面板实际只给 556px，320px 下限在那里排不出两列 | `271px 271px`（两列） |
| D2 | 描述与底部清单间隙过大 | 三行改为从顶部堆叠 + 预留两行正文（`min-height: 34px`）+ 身份行固定 28px，卡片高度 122px → 110px | 描述底到来源行顶恒定 **4px**（原 18px） |
| D3 | 窄卡里来源名被压成 `a…`（D1 的副作用） | 网格卡片的来源行只放计数，来源名移到列表视图；用户内容卡片改放路径；`rowFoot` 保留 16px 最小高度保证行位一致 | 市场 `技能 1 · Hooks 2 · 命令 1 · 子代理 2`；技能显示路径；MCP `3 工具 · streamable-http`；LSP `8 种扩展名` |
| D4 | MCP/LSP 正文落在名称旁边（D1 暴露的既有缺陷） | 四个卡片组件的正文补上 `rowBody`：只带槽位类的正文会被网格自动排进没有操作的卡片那个空 act 列 | `jetbrains__jetbrains` 完整显示，端点独立成行 |

本轮后：`check:refactor` 绿、`pnpm run test` 81 文件 / 634 用例绿、走查零 console 错误。

## 三、走查配方（可复现）

```sh
# 1) 独立 profile：复制现有 web profile（其中的插件仍软链到本仓库）
cp -Rc ~/.dsh/profiles/web ~/.dsh/profiles/ui-check

# 2) 用户自撰资源根指向临时目录，避免写进真实 ~/.agents
mkdir -p /tmp/dsh-ui-check/agents/{skills,commands,agents}
#   并放入 fixture：skills/demo-skill/SKILL.md、commands/demo-command.md、
#   agents/demo-agent.md、mcp.json、lsp.json

# 3) 独立端口启动
DSH_AGENTS_HOME=/tmp/dsh-ui-check/agents dsh --profile ui-check --port 3099 --no-open --skip-auth
```

走查要点：六个页签各截一张；套件详情展开一条技能行；三个编辑器各开一次（确认 880px 与分页面标题）；技能/命令/角色详情各开一次；MCP 与 LSP 详情各开一次；添加源弹窗（确认 640px）；市场切列表视图；切暗色再看一次市场与详情。判定标准：全程零 console 错误、零 pageerror。

### 走查记录

| 轮次 | 结果 |
| --- | --- |
| 主体改动后 | 六页签渲染真实数据（市场 1026 / 技能 101 / 命令 22 / 代理角色 15 / MCP 3 / LSP 2 张卡片）；套件详情、三个编辑器（880px）、技能与命令详情、MCP 详情、添加源弹窗（本轮到 R2 前为 500px）、暗色主题均确认；零 console 错误 |
| 收尾后 | 见文末「最终验证」 |

## 四、最终验证

- `pnpm run check:refactor`：绿（typecheck × 4 个项目、eslint、format:check、test:contract、dependency-cruiser 147 模块 / 524 依赖无违规）。
- `pnpm run test`：**81 文件 / 634 用例全绿**。
- `pnpm run build`：成功；`client/style.css` 由 70.86 kB 降到 50.49 kB（死规则清理的直接结果）。
- 收尾后走查（`dsh --profile ui-check --port 3099`，零 console 错误、零 pageerror）：

| 项目             | 结果                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 六页签           | 插件市场 1026 / 技能 101 / 命令 22 / 代理角色 15 / MCP 服务 3 / LSP 服务 2 张卡片                                               |
| 套件详情         | 概览 · 描述 · Agent Plugins 目录 · 技能 (1) · MCP 服务 (0) · 命令 (0) · 子代理 (0) · Hooks (0) · LSP 服务 (0)，技能行可就地展开 |
| 三个编辑器       | 新建技能 / 新建命令 / 新建代理角色，均 880px 且双栏                                                                             |
| 技能详情         | 文档行存在并可展开                                                                                                              |
| MCP 详情（R1）   | 概览 · 服务配置 · 工具 (0)                                                                                                      |
| LSP 详情（R1）   | 概览 · 原因 · 扩展名与语言映射 (1) · 服务配置                                                                                   |
| 添加源弹窗（R2） | 640px                                                                                                                           |
| 列表视图         | 视图段 网格=true→false、列表=false→true；`data-resource-view=list`；行高实测 56px                                               |
| 暗色主题         | 市场网格与套件详情正常，无为主题写任何分支                                                                                      |

截图目录：`/tmp/proto-shots/final-*`。

## 五、本次改动文件

新增：`src/client/ui/UserEntryDetail.tsx`、`src/client/ui/json-tree-labels.ts`、`.agents/notes/implemented/feature/2026-09-14-workspace-card-anatomy-and-host-affordances.md` + `.zh.md`、本文件。

修改：`src/client/LspStatusPanel.tsx`、`MarketSection.tsx`、`McpStatusPanel.tsx`、`SearchFilterToolbar.tsx`、`SearchFilterToolbar.module.css`、`SuiteDetail.tsx`、`features/market/SuiteCard.tsx`、`features/market/SourceTabsRow.tsx`、`locales.ts`、`market.module.css`、`mcp-status.module.css`、`ui/DetailModal.tsx`、`ui/detail.module.css`、`ui/UserPanelSurface.tsx`、`ui/panel.tsx`、`ui/panel.module.css`、`ui/resource-card.module.css`、`tests/user-panel-surface.test.ts`、`tests/filter-toolbar.test.ts`、`docs/user/usage.md`、`docs/user/usage.zh.md`、`.agents/notes/implemented/feature/2026-09-02-market-card-platform-affordances.md` + `.zh.md`。

删除：`src/client/ui/ToggleSwitch.tsx`、`src/client/ui/StatusIcon.tsx`。

> 工作树在本任务开始前已有其他未提交改动（settings/card 复用宿主、插件卡片控制器等），上面只列本次 UI 优化触及的文件。

## 七、复刻复核（原型为交互权威）

截图只能表达静态形态；本轮把原型 HTML 当成交互与显隐的唯一权威，逐条对照后补齐。核到一处**此前从未生效**的缺陷：`@container` 规则全部挂在查询容器上，而插件市场页的根元素 `.market` 不是容器（只有 `panel.module.css .shell` 是，且仅用户内容面板复用），所以窄容器分支此前对市场页完全没起作用——列数、间距、行高、操作簇定位一直落在基线上。

| # | 条目 | 落点 | 实测 |
| --- | --- | --- | --- |
| E1 | 市场页补查询容器 | `market.module.css .market` 增加 `container-type: inline-size` | 面板 564px 下 `@container (max-width: 700px)` 生效；网格由 1 列 552px 变为 2 列 274px |
| E2 | 卡片几何回到原型 | `resource-card.module.css`：`minmax(280px, 1fr)`、窄容器 `repeat(2, minmax(0, 1fr))` + `gap: 4px` + `grid-auto-rows: max-content`；描述去掉预留高度，改回按内容收尾 | 两列 274px、间距 4px、两行描述卡 104px |
| E3 | 来源行恢复来源名 | 删掉 `[data-resource-view='grid'] .provenance { display: none }`；`.provenance` 跟随原型的等宽字体 | 网格卡底行 `agent-plugins · 技能 1` |
| E4 | 操作簇整簇显隐 | 窄容器下 `.rowActions` 绝对定位到身份行右上角、`padding-right` 预留 88px（MCP/LSP 46px），整簇（含开关与主操作）默认 `opacity: 0`，hover 或 `:focus-within` 淡入 | 默认态零操作；hover 后 `安装` / 刷新·删除·开关 出现在名称同行，零位移 |
| E5 | 卡片悬停过渡 | `.card` 增加 `border-color / background 0.14s ease` | 计算样式确认 |
| E6 | MCP/LSP 卡片补启停开关（接真实后端） | 新增路由 `set-mcp-server-enabled` + `McpService.setServerEnabled`；客户端 `setMcpServerEnabled`；LSP 复用既有 `lsp-servers/enabled` | 实机点开关：`jetbrains__jetbrains` 由「连接失败」转为 `data-resource-state=disabled` + 「已禁用」，再点回来恢复 |
| E7 | MCP/LSP 状态表达按原型 | 去掉状态圆点，身份行改为常显状态胶囊；来源标签单独包 `.provenanceChip`，窄容器隐藏 | 卡片显示 `连接失败` / `已连接` / `已禁用` / `已挂载` |
| E8 | MCP/LSP 补「已禁用」过滤 | 两个 view-model 增加 `disabled` 项、停用条目不再被过滤掉；计数与可见行同一个判断 | 六页过滤栏统一四项；点「已禁用」列出停用条目 |
| E9 | 工具栏：视图收成一个图标按钮 | `SearchFilterToolbar.tsx`：单个 `Pill`，显示当前模式字形 + 按下态底色，`title/aria-label` 说明点击去处；新增 `switchToGrid` / `switchToList` | 网格态一个按钮；点击后字形变列表、名称变「切换到网格」 |
| E10 | 搜索框放大镜 | 复用宿主 `Input` 的 `icon` 槽 | 搜索框左侧出现放大镜 |
| E11 | 页头动作收成图标按钮 | `ui/panel.tsx` `PanelActions` 改用共享 `rc.iconBtn`（24px 方形、无外框） | 页头 24×24 两个图标，宽度不再随语言变 |
| E12 | 归属标签只说归属 | 市场卡片与套件详情改用 `panelSourceUser` / `panelSourcePlugin`；删除 `dimensionUser` / `dimensionProject` 两个死文案 | 卡片与详情显示 `用户` / `插件`，不再有 `用户级` / `项目级` |
| E13 | 来源条折叠态裁剪与抬层 | `market.module.css`：折叠态 `clip-path: inset(-6px …)`，hover 撤裁剪并 `z-index: 20`；选中来源后保持裁剪 | 展开浮层盖住工具栏与首行卡片，折叠态不越过「未纳入来源」那行 |
| E14 | 工具栏换行阈值 | 700px → 480px | 面板 564px 下搜索框与两段控件同一行（与原型一致），只有真窄容器才换行 |
| E15 | 减少动效偏好 | `resource-card.module.css` 的过渡在 `prefers-reduced-motion: reduce` 下关闭 | 原型同款 |
| E16 | 测试与文案 | 更新 `tests/filter-toolbar.test.ts`、`tests/client-view-models.test.ts`、`tests/user-panel-surface.test.ts`、`tests/routes.test.ts`；新增 `mcpFilterDisabledHint` / `lspFilterDisabledHint` / `switchToGrid` / `switchToList` 中英 | 门禁与全量测试见下 |

### 与原型不同、有意为之的两处

1. **开关表达的是「启用」而不是「已连接」。** 原型 demo 把 `aria-checked` 写成 `state === 'active'`，于是失败条目显示为关；本实现里关态只表示用户停用了它——`连接失败` / `降级` 的条目仍然是启用状态（左边条与状态胶囊已经说明它坏了），这样点开关才真的能把一个坏服务停掉。
2. **控件几何用宿主件。** 筛选段与归属标签走宿主 `Pill` / `Tag`（胶囊圆角与平台一致），原型的 6px 圆角矩形与 4px 圆角标签没有照搬；这是仓库「先复用宿主能力」的既有取舍。

### 本轮验证

- 独立 profile（`dsh --profile ui-check --port 3101` + `DSH_AGENTS_HOME` 指向临时目录）实机走查，零 console 错误：
  - 六页签默认态、网格两列 274px / 间距 4px / 来源行显示来源名；
  - 未安装卡 hover 现出「安装」、已安装卡 hover 现出刷新·删除·开关（与名称同行、零位移）；
  - MCP/LSP 卡 hover 现出开关；实点开关往返一次，状态由 `error` → `disabled`（已禁用）→ 恢复；
  - 来源条 hover 就地展开为浮层、盖住工具栏与首行卡片；
  - 列表视图按原型堆叠（身份行 / 来源行 / 单行描述）；
  - 套件详情底部 `关闭` + `安装`，状态带显示 `未安装 用户 v1.7.1`；
  - 亮色与暗色两套均正确（暗色由 token 自动生效，无主题分支）。
- `pnpm run check:refactor`：绿（typecheck × 4、eslint、format:check、test:contract、dependency-cruiser 147 模块 / 527 依赖）。
- `pnpm run test`：**82 文件 / 638 用例全绿**。
- `pnpm run build`：成功；`client/style.css` 52.70 kB。

截图目录：`/tmp/ui-check/`（`L-*` 亮色、`D-*` 暗色）。

## 八、复核轮次改动文件

新增：`.agents/notes/implemented/feature/2026-09-16-workspace-live-card-affordances.md` + `.zh.md`。

修改：`src/client/features/market/SuiteCard.tsx`、`src/client/features/market/SourceTabsRow.tsx`（注释之外无行为改动）、`src/client/MarketSection.tsx`、`src/client/McpStatusPanel.tsx`、`src/client/LspStatusPanel.tsx`、`src/client/SuiteDetail.tsx`、`src/client/ui/UserPanelSurface.tsx`、`src/client/ui/panel.tsx`、`src/client/ui/ResourceCard.tsx`、`src/client/ui/resource-card.module.css`、`src/client/SearchFilterToolbar.tsx`、`src/client/SearchFilterToolbar.module.css`、`src/client/market.module.css`、`src/client/api.ts`、`src/client/locales.ts`、`src/client/features/mcp-status/mcp-status-view-model.ts`、`src/client/features/lsp-status/lsp-status-view-model.ts`、`src/contracts/market.ts`、`src/routes.ts`、`src/application/catalog.ts`、`src/application/queries.ts`、`src/application/mcp-service.ts`、`tests/filter-toolbar.test.ts`、`tests/client-view-models.test.ts`、`tests/user-panel-surface.test.ts`、`tests/routes.test.ts`、`docs/user/usage.md`、`docs/user/usage.zh.md`、`.agents/notes/implemented/feature/2026-09-14-workspace-card-anatomy-and-host-affordances.md` + `.zh.md`。

## 九、编辑页复刻（截图 40–49）

上一轮只把卡片与详情按原型对齐，编辑页停在上一版自有的外壳上：没有标题副行、窗格头没有 chip、底部没有提示、命令少「参数提示」、服务编辑器只是光秃秃的新增表单、来源编辑器没有只读的「来源 ID / 作用域」。本轮按原型逐个补齐。

| # | 条目 | 落点 | 实测 |
| --- | --- | --- | --- |
| F1 | 编辑器统一头部：标题 + 副行 | `ui/panel.tsx` `EntryEditorModal` 新增 `subtitle`，透传宿主 `Modal` 的 `description` | 新建显示落盘目标（`保存后写入 ~/.agents/skills/<名称>/SKILL.md` 等），编辑显示 `<名称> · <路径>` |
| F2 | 两个窗格各带 chip | 左窗格头 chip = 文档文件名（`SKILL.md` / `<名称>.md`），右窗格头 chip = `editorLive` | `编辑 MARKDOWN · SKILL.MD` / `预览 · 实时` |
| F3 | 字段提示与底部提示 | `hint` 移到文本域下方；新增 `footerHint` 与 `.editorFooterGrow` | 文本域下方 `frontmatter 的 description 决定触发，正文写执行步骤。`；底部 `创建后立即生效，可在列表里停用` + `取消` + `创建` |
| F4 | 命令补「参数提示」 | 新增 `renderNamePairField`（渲染型 prop）与 `readArgumentHint`；新建态与名称同排 2 列 | 名称旁出现 `参数提示` 输入（占位 `[--force]`），读写 frontmatter 的 `argument-hint` |
| F5 | 标签改原型写法 | 各页面的 `nameLabel` / `textLabel` / `hint` 改为 `名称` + `文档` / `命令正文` / `系统提示词` + 各自提示 | 走查中三页标签与提示齐全 |
| F6 | 角色「当前路由」提示 | `RoleMetadataFields` 的 `运行配置` fieldset 内提示行改为 `当前路由：<route>。<既有说明>` | 走查中显示 `当前路由：继承主会话。路由声明必须同时给出供应商与模型才会生效…` |
| F7 | 服务编辑器补副行 / 底部提示 / 主操作按钮 | `McpAddModal`、LSP 新增弹窗：`description` + `editorFooterCreate` + `创建` 主操作 | 标题 `新建 MCP 服务` / `新建 LSP 服务`，副行写出 mcp.json / lsp.json |
| F8 | 名称与传输方式同一行 | `ServerConfigEditor` 新增 `nameField`，在模式切换之下渲染身份行（MCP 与传输方式成对），身份字段在表单与 JSON 两种视图都可见 | 走查中 `服务名称` + `传输方式` 同排，`命令` / `参数` / `环境变量` / `工作目录` 各占整宽 |
| F9 | OAuth 成组 | `detail.module.css` 新增 `.oauth` / `.inlineCheck`，OAuth 复选框与 scope 收进带图例的 fieldset | 走查中 http 形态下出现 `OAuth` 分组 |
| F10 | 服务表单纵向堆叠 | `命令` / `URL` / `工作目录` 加 `wide`，与行编辑器一样跨两列 | 与原型单列表单一致 |
| F11 | 来源编辑器补固定事实 | `SourceEditorModal`：分段文案改 `Git 仓库` / `归档包` / `本地路径`；编辑态增加只读「作用域」`本地目录 · N 个套件`；标题 `添加来源` / `编辑来源`（编辑态副行为来源 id）；底部 `移除来源` 去掉图标 | 走查中编辑 agent-plugins：`源 id` 只读 + `作用域 本地目录 · 19 个套件` + 底部 `移除来源 / 取消 / 保存` |
| F12 | 文案与死键清理 | `locales.ts`：新增编辑器相关中英键，改 `编辑 Markdown` / `传输方式` / `命令` / `参数` / `请求头` / `语言扩展名映射` 等；删除不再引用的 `editorHint` / `panelTextPh` / `sourceMode*` / `lspSave` | 双语键保持成对 |

### 表单样式统一（严格按原型）

上一轮只补齐了编辑器的结构，字段本身仍各写一套几何：三处表单的圆角 4px / 6px / 8px / 10px 混用、内边距 8px 与 7px 9px 混用、标签有的 13px/400 有的 12px/600、名称框用宿主 `Input`（14px 文字、0.5px `border-l4`）而旁边的命令框是原生 12px `border-l2`、`表单|JSON` 画成两颗独立按钮、行编辑器的「新增」是裸文字按钮。本轮统一到一张按原型数值写的表单样式表。

| # | 条目 | 落点 | 实测 |
| --- | --- | --- | --- |
| G1 | 新增共享表单样式表 | 新增 `src/client/ui/form.module.css`：`.field`（12px/600 次级色标签 + `gap:5px`；input/select/textarea `7px 9px`、`radius 8px`、`1px border-l2`、`12px`；textarea `min-height:240px`、等宽 `12/19`）、`.form`（`flex column`、`gap:14px`）、`.formGrid`（2 列 `gap:12px`）、`.seg`（一条带边框轨道 + 24px 按钮）、`.readonly`（虚线 `border-l3` + `interactive-bg-hover` + 等宽）、`.rows`/`.row`（含 34% / 26% 键列）、`.iconBtn`（扁平 24px 删除）、`.addRow`（26px 带边框）、`.inlineCheck`、`.fieldset`、`.panes`、`.previewBox`、`.footer` | 实测输入框 31px 高、`7px 9px`、`radius 8px`、`1px border-l2`、12px；标签 12px/600 `label-secondary`；文本域 240px、12px 等宽 |
| G2 | 三个编辑器改用该表 | `ui/panel.tsx`（`EntryEditorModal` 的窗格/字段/提示/底部）、`ui/ServerConfigEditor.tsx`（整表重写）、`features/market/SourceEditorModal.tsx`、`features/personas/RoleMetadataFields.tsx` | 三处字段几何一致；`运行配置` fieldset 用 `.fieldset` |
| G3 | 编辑器字段改原生控件 | 名称、参数提示、来源地址等不再用宿主 `Input`（宿主 `Input` 仍是面板搜索框） | 名称框与旁边的命令框同为 12px `border-l2`、`radius 8px` |
| G4 | 行编辑器按原型 | `StringRows` 改 `.rows`/`.row` + 扁平 24px 删除按钮 + 带边框的 `添加参数 / 添加变量 / 添加请求头 / 添加映射`；`表单｜JSON` 用 `.seg` | 走查中 MCP 的 `参数 / 环境变量 / 工作目录` 与来源分段控件都是一条轨道 |
| G5 | 底部次级动作改描边 | 六个编辑器的 `取消`、`移除来源` 改 `Button variant="outline"`（原型 `取消` 是带边框的 `.btn lg`） | 走查中底部三颗按钮为「描边 / 描边 / 主色填充」 |
| G6 | 占位文案 | 名称字段不再用标签当占位：`my-new-skill` / `my-command` / `my-agent` / `my-mcp-server` / `my-language-server` | 走查中五处新建表单占位各不相同 |
| G7 | 清理被取代的样式 | 删除 `panel.module.css` 17 条编辑器规则 + `roleFields`、`detail.module.css` 13 条、`market.module.css` 9 条 | dependency-cruiser 148 模块 / 531 依赖无违规 |

### 与原型不同、有意为之

1. **角色表单没有 `工具` 选择器**：原型那颗控件是只有 `全部` / `只读` 两个选项的演示，背后没有产品语义（本面板在 frontmatter 里存任意 `tools` 列表），映射上去等于发明一个 executor 未实现的含义；改为写出实际生效的路由。
2. **编辑条目不重命名**：条目以文件名为主键，编辑态改为显示将写入的路径，不提供存储层无法兑现的重命名。
3. **MCP/LSP 既有服务仍在详情弹窗里编辑配置**：那里拿得到已解析、已脱敏的配置；卡片上的编辑器仍只负责新增。

### 本轮验证

- 独立 profile（`dsh --profile ui-check --port 3103` + `DSH_AGENTS_HOME` 指向临时目录）实机走查：技能 / 命令 / 代理角色 / MCP / LSP / 添加来源 / 编辑来源七个弹窗逐一核对标题、副行、窗格 chip、字段提示与底部提示，全部与原型一致；截图见 `/tmp/ui-check/E-*.png`。
- `pnpm run check:refactor` 绿；`pnpm run test` **82 文件 / 638 用例全绿**；`pnpm run build` 成功。

## 十二、详情弹窗的展开行与文档正文

上一轮把详情的信息架构对齐了原型，但**展开行本身**与正文里的 frontmatter 还是另一套：行用了宿主 `DisclosureRow`（24px 单行、箭头在标题前、只在悬停出现、无悬停/展开底色），frontmatter 被渲染成 `元数据` 定义列表。三处详情（套件 / 用户条目 / LSP 扩展名）各画一套分组与正文类。

| # | 条目 | 落点 | 实测 |
| --- | --- | --- | --- |
| I1 | 一个共享的详情行组件 | 新增 `ui/DetailRows.tsx` + `ui/detail-rows.module.css`：`.rows` 带边框圆角分组（radius 10、`overflow: hidden`、行间 `border-l1` 细线）；`.row` 三列 `minmax(110px,max-content) · 1fr · 14px`、`9px 12px`、悬停 `interactive-bg-hover`、展开 `state-business-tertiary`；`.name` 等宽半粗、`.summary` 单行省略；`.chevron` 贴右端（关→右、开→下）；`.body` `12px 14px` + 顶部 `border-l2` + 悬停底色 | 实测展开行底色 `rgb(228, 237, 253)`；行高 34px（`9px 12px` 内边距）；摘要 `ellipsis / nowrap`；分组边框 radius 10 |
| I2 | 三处调用点改用它 | `SuiteDetail.row()`、`ui/UserEntryDetail.tsx` 的文档行、`LspStatusPanel` 的扩展名行 | 三处同一形态；LSP 扩展名行作为不可展开的静态带渲染 |
| I3 | frontmatter 按原文展示 | `MarkdownDocument`：`frontmatter()` 新增 `raw`（匹配到的原文块），预览里改为等宽 + 边框 + `markdown-code-block` 底色的 `pre`，位于渲染正文之上 | 走查中展开行正文以 `---` 原块开头，编辑器预览同步生效 |
| I4 | 用户条目详情概览按原型 | 新增 `diskPathLabel`（磁盘路径）、`updatedLabel`（最近变更）与 `docSectionSkill/Command/Persona`（技能文档 / 命令文档 / 角色定义）；`UserPanelEntry.updatedAt` 由 `panel-resources.ts` 在列表组装处对每个条目文件统一 stat 得到；`ui/last-change.ts` 抽出 `lastChangeLabel` 供两处详情共用 | 走查中读作 `来源套件 用户 / 类型 用户 / 磁盘路径 … / 最近变更 29 分钟前`，分组标题 `技能文档` |
| I5 | 清理 | 删除 `panel.module.css` 的 `.docs`/`.docsBody`、`market.module.css` 的 `.rowSummary`、`detail.module.css` 的 `.metadata`/`.values`/`.value`/`.section`/`.heading`；`tests/client-detail-editors.test.ts` 的断言由 `<dl` 改为 `<pre` | dependency-cruiser 151 模块 / 538 依赖无违规 |

> 注意：详情行现在用的是插件自己的 `DetailRow`，不再是宿主 `DisclosureRow`；理由是宿主那条 24px 流式行改不出原型的三列带（箭头位置、行高、两层底色都是它自己的决定）。取舍写在 `2026-09-16-detail-row-and-document-body` 的 Alternatives 里。

## 十、编辑页改动文件

新增：`src/client/ui/form.module.css`、`.agents/notes/implemented/feature/2026-09-16-workspace-editor-chrome.md` + `.zh.md`。

修改：`src/client/ui/panel.tsx`、`src/client/ui/panel.module.css`、`src/client/ui/detail.module.css`、`src/client/market.module.css`、`src/client/ui/UserPanelSurface.tsx`、`src/client/ui/ServerConfigEditor.tsx`、`src/client/ui/detail.module.css`、`src/client/McpStatusPanel.tsx`、`src/client/LspStatusPanel.tsx`、`src/client/mcp-status.module.css`、`src/client/features/market/SourceEditorModal.tsx`、`src/client/features/personas/RoleMetadataFields.tsx`、`src/client/features/personas/frontmatter.ts`、`src/client/locales.ts`、`docs/user/usage.md`、`docs/user/usage.zh.md`、`.agents/notes/implemented/feature/2026-09-14-workspace-card-anatomy-and-host-affordances.md` + `.zh.md`。

## 十三、编辑区的多行文本域换成编辑器

上一轮把编辑表单的几何对齐了原型，但**多行正文**仍是原生 `<textarea>`，而且编辑态在正文之上又叠了两行重复身份：副行复述详情弹窗的概览，`名称` 输入框与只读路径复述标题与窗格 chip。它们同时把左右两个窗格错开——编辑框比预览框起步低、收尾高度也不同。

| # | 条目 | 落点 | 实测 |
| --- | --- | --- | --- |
| J1 | 多行正文用真正的编辑器 | 新增 `ui/CodeEditor.tsx` + `ui/code-editor.module.css`：CodeMirror 6 的受控封装（`value`/`onChange`、`markdown`/`json` 语法、无障碍 `label`、`minHeight`）；主题由 `EditorView.theme` 从 `--dsw-alias-*` 构建，行号槽、当前行、选区、光标全部走 token，两种主题零分支 | 走查中行号、语法高亮、当前行底色、括号匹配均生效；浅色与深色均正确 |
| J2 | 编辑态只留文档 | `ui/panel.tsx` 的 `EntryEditorModal`：`mode === 'edit'` 不再渲染副行与身份行（`名称` 输入框 + 只读路径框）；新建态保留，因为没有别的地方提供名称 | 编辑弹窗只有标题 + 两个窗格 + 提示 + 底部 |
| J3 | 两个窗格框尺寸一致 | `.previewBox` 补 `box-sizing: border-box`；`.editor` 改为 flex 列、`.cm-editor` `flex: 1; min-height: 0`，编辑框同样受 240px 下限约束 | `getBoundingClientRect`：编辑框与预览框均为 **240 × 408**，top 同为 192、bottom 同为 432 |
| J4 | 窗格头部等高 | `.paneHead` 加 `min-height: 16px`，`.chip` 钉 `line-height: 14px`——两种文字（拉丁 `SKILL.MD` 与中文 `实时`）的 chip 曾让头部一个 14px、一个 16px，把其中一个窗格整体下推 2px | 实测两个 `header` 高度一致，窗格框 top 对齐 |
| J5 | 文档标签移入无障碍名称 | `文档` / `命令正文` / `系统提示词` 不再作为框上方可见一行渲染，改为 `CodeEditor` 的 `aria-label`；窗格头部已用 `编辑 Markdown` 说明界面 | 视觉上不再有重复标签，读屏仍能拿到文档名 |

> 依赖：客户端因此新增 `@codemirror/state`、`view`、`commands`、`language`、`lang-markdown`、`lang-json`（`devDependencies`，像 React 一样打进 client bundle）。宿主 `@deepseek-ai/dsh-client-ui-primitives` 只导出只读代码视图（`CodeBlock`、`JsonBlock`、`ReadBlock`、`DiffBlock`、`TerminalBlock`、`MarkdownText`），harness 各包也未声明 CodeMirror / Monaco，故无宿主能力可复用；取舍与体积代价写在 `2026-09-16-workspace-document-editor` 的 Alternatives 与 Risks 里。

## 十四、本轮改动文件

新增：`src/client/ui/CodeEditor.tsx`、`src/client/ui/code-editor.module.css`、`.agents/notes/implemented/feature/2026-09-16-workspace-document-editor.md` + `.zh.md`。

修改：`src/client/ui/panel.tsx`、`src/client/ui/form.module.css`、`package.json`、`pnpm-lock.yaml`、`.agents/notes/implemented/feature/2026-09-16-workspace-editor-chrome.md` + `.zh.md`。

## 十五、编辑器外壳去文案与表单控件统一

上一轮把正文换成编辑器后，编辑弹窗里仍留着两类「说明性」文本（标题下的落盘目标、字段下方的机制说明），服务/来源表单里还嵌着平台 `Input`（一个值两道边），行列表的新增动作占着行下方一整行。

| # | 条目 | 落点 | 实测 |
| --- | --- | --- | --- |
| K1 | 删除所有编辑器的副行 | `ui/panel.tsx` 去掉 `subtitle`；`LspStatusPanel` / `McpStatusPanel` / `SourceEditorModal` 去掉 `description`；`editorTarget*`（10 项）与 `editorSourceSubtitle` 从 locales 删除 | 六个编辑器都只有标题 |
| K2 | 删除所有字段提示 | 删除 `editorDocHint*`、`detailJsonHint`、`personaModelHint`，以及来源编辑器的 `urlGitHint`/`urlArchiveHint`/`urlLocalHint`/`branchHint`/`sha256Hint`；示例改由 placeholder 承担（新增 `sourceUrlEg*`、`branchEg`） | 弹窗内 `[class*=hint]` 计数为 0；保留 `personaRouteIgnored`（校验反馈）与底部 `editorFooter*`（保存后果） |
| K3 | 编辑器内只用样式表的控件 | MCP / LSP 的 `nameField.control` 与来源编辑器的 URL / 分支 / SHA256 由平台 `Input` 改为原生 `input` | 服务名称输入框 `border-width: 1px`，字段包裹层 `0px`（此前两层） |
| K4 | 行列表新增动作移到 label 行 | `ServerConfigEditor.StringRows` 自己渲染字段：`.rowHead`（label + 扁平 `addIcon` 20px）＋ `.rows`；`form.module.css` 删除 `.addRow`，新增 `.rowHead`/`.addIcon`；无障碍名称保持 `<添加> <对象>` | 参数 / 环境变量 / 语言扩展名映射各一个 `addIcon`；`tests/client-detail-editors.test.ts` 的 `panelAdd detailEnv`、`panelAdd detailArgs` 断言不变 |
| K5 | 新建态的 markdown 与预览对齐 | 身份行（名称，及命令的「参数提示」）从左侧窗格移到 `.panes` 之上，两个窗格都只剩「头部 + 框」 | 新建：编辑框与预览框均 `240×408`，top 241 / bottom 481；编辑：均 `240×408`，top 215 / bottom 455 |

> 取舍写在 `2026-09-16-workspace-editor-chrome-cleanup` 的 Alternatives 里：字段提示是**删除**而不是搬进 tooltip；行下方的带边框添加按钮虽与原型一致，但按本项目「行内动作用扁平图标」的既有规范有意偏离。

## 十六、本轮改动文件

新增：`.agents/notes/implemented/feature/2026-09-16-workspace-editor-chrome-cleanup.md` + `.zh.md`。

修改：`src/client/ui/panel.tsx`、`src/client/ui/UserPanelSurface.tsx`、`src/client/ui/ServerConfigEditor.tsx`、`src/client/ui/form.module.css`、`src/client/LspStatusPanel.tsx`、`src/client/McpStatusPanel.tsx`、`src/client/features/market/SourceEditorModal.tsx`、`src/client/features/personas/RoleMetadataFields.tsx`、`src/client/locales.ts`、`docs/user/usage.md`、`docs/user/usage.zh.md`、`.agents/notes/implemented/feature/2026-09-16-workspace-editor-chrome.md` + `.zh.md`、`.agents/notes/implemented/feature/2026-09-16-workspace-document-editor.md` + `.zh.md`。

## 十七、编辑表单改单栏，markdown 预览改为按钮切换

上一轮的编辑弹窗仍把源码与渲染结果左右并排，两栏栅格与插件里其他编辑器（MCP / LSP / 来源）的单列表单不一致，预览还在每次按键时重渲染整份文档。

| # | 条目 | 落点 | 实测 |
| --- | --- | --- | --- |
| L1 | 一次只显示一个视图 | `EntryEditorModal`：两栏 `panes` 结构删除，正文在 `CodeEditor` 与 `previewBox` 之间二选一，`minHeight` 提到 300 | 编辑视图与预览视图各自通宽，长文档不再挤在半宽栏里 |
| L2 | 切换控件贴着正文 | 调用方传入 `modeControl`（`.seg` 分段：`编辑 Markdown` / `预览`，复用服务编辑器 `表单` / `JSON` 的轨道样式），由 `EntryEditorModal` 渲染在文档标签行（`文档` / `命令正文` / `系统提示词`）的右端；状态在 `UserPanelSurface` 的 `showPreview`，打开编辑器总是落在编辑视图 | 标签行左文右切换，紧贴编辑框上方；`aria-pressed` 随视图翻转，切预览时 `.cm-editor` 卸载，切回时文档保留 |
| L3 | 预览按需渲染 | 编辑视图内打字不触发任何预览渲染 | 编辑视图打字时 `previewBox` 不存在 |
| L4 | 清理 | `form.module.css` 删除 `.panes`/`.pane`/`.paneHead`/`.chip`；locales 删除 `editorLive`（中英）；`EntryEditorModal` 的 `docName` prop 删除 | 两处 CSS 类、一处 locale 键均无引用 |
| L5 | 弹窗顶部间距归一 | `panel.module.css`：`.editorDialog` 自设 `gap: 12px` 并清掉宿主 `.body` 的 `margin-top: 20px`（宿主按「标题下有一句说明」设定间距，这些编辑器没有说明） | 标题到第一个字段实测 12px，此前约 52px |
| L6 | fieldset 图例不再压边框线 | `form.module.css`：`.fieldset` 顶部内边距改为 2px，图例的行盒自己占住上边框，文字改 `label-secondary`、行高 18px | `运行配置` / `OAuth` 图例与边框线不再重叠 |
| L7 | 行列表新增按钮与面板头部加号统一 | `form.module.css` 的 `.addIcon` 由 20px/次级色改为 24px/`brand-primary`，悬停、禁用态与卡片 `.iconBtn` 同规格；行列表头保持 24px 行高 | MCP 行列表 `+` 与面板头部 `+` 实测同为 24×24、同色、同圆角 |
| L8 | 名称完整显示，悬停操作盖在顶层 | 窄栅格里名称不再自行截断（去掉 `overflow: hidden`/`ellipsis`，身份行与正文行只留 `overflow: hidden` 防溢出卡片边缘）；操作簇浮在身份行尾端，自带胶囊形不透明底板（`bg-layer-1`、圆角 16、外扩阴影羽化边缘），`z-index: 1` 盖过归属标签；悬停期间卡片保持原底色，底板与卡片浑然一体 | 长名称卡（46 字符）静止时全名可见；悬停时操作簇覆盖名称尾部与标签，无硬边、无残影；安装 CTA / 刷新 / 删除 / 开关同板 |

> 取舍写在 `2026-09-16-workspace-document-editor-single-view` 的 Alternatives 里：并排两栏保留、隐藏式预览、防抖实时预览、标题行标签条，均被否决。

## 十八、本轮改动文件

新增：`.agents/notes/implemented/feature/2026-09-16-workspace-document-editor-single-view.md` + `.zh.md`。

修改：`src/client/ui/panel.tsx`、`src/client/ui/UserPanelSurface.tsx`、`src/client/ui/panel.module.css`、`src/client/ui/form.module.css`、`src/client/locales.ts`、`docs/user/usage.md`、`docs/user/usage.zh.md`、`.agents/notes/implemented/feature/2026-09-16-workspace-document-editor.md` + `.zh.md`、`.agents/notes/implemented/feature/2026-09-16-workspace-editor-chrome-cleanup.md` + `.zh.md`。
