# Agent Note: the destructive action lives on the card, and a card action names its row

Status: implemented

## Problem

市场页没法在卡片上卸载套件了，每个功能的卸载也都落到了详情里不同的位置。一位读者要先打开卡片、在对话框里翻找那个唯一的不可逆按钮，才能删掉一个条目——他报上来的正是自己每天在用的那个入口不见了：破坏性操作以前就是卡上 hover 显形的一个扁平图标。

2026-10-30 的唯一渲染器迁移造出了这个形状。三个页面交出了自己的卡片实现，连同卡上的操作一起交了出去。背后的规则来自[卡片行那条记录](../bug-fix/2026-10-30-card-rows-and-the-switch-that-never-hides.zh.md)：卡片的点击意味着「打开」，所以唯一的不可逆动作要往里走一步。

结果是参差而不是一致。市场卡片成了最后一个还留着卸载的页面，于是负责人要求把它搬回来；另外三个从来没有卡上操作的页面，各自在详情里长出了一个，位置还各不相同。造出这个形状的规则写在两处，必须跟着代码一起改：共享渲染器的模块说明，和 `AGENTS.local.md` 的第 4 条。

同一个控件簇里还坐着同一个毛病：可访问名字只有裸动词的图标按钮，在每一张卡片上念出来都是同一句话。开关与编辑按钮早就答对了这个问题——开关的名字是动词加行名，编辑按钮的可访问名字是 `panelEdit` 加行名，两者的 tooltip 都是裸动词——但破坏性操作没有名字，因为它本来就不在卡上。

## Decision

- **卡片是这个动作的入口，删除仍由面板的确认流程负责。** 每个拥有破坏性操作的页面，现在都在该条目的卡片上放一个扁平的危险图标按钮：`IconTrashOutlineMedium`、`danger: true`，共享渲染器把它画成 `card.iconBtnDanger` 并盖在 `card.revealOnHover` 之下。点它打开的是页面既有的确认流程——共享的 `ConfirmModal`——它自己不删除任何东西。卡片打开的详情里保留原有的那个按钮，这条路径因此不会消失。

- **卡片操作的可访问名字是动词加行名，tooltip 是裸动词。** 这现在是产品里每一个卡片操作的约定，不只是破坏性操作这一个：
  - 可访问名字是动词加上它作用的那一行——「卸载 <套件>」「删除连接器 <连接器>」「删除 <条目>」「删除输出风格 <风格>」「删除文件 <路径>」；
  - tooltip 是裸动词，因为 tooltip 回答的是「这个按钮做什么」，而它作用的行就在屏幕上；
  - 渲染器把两种形状分开承载：`ResourceCardAction` 多了一个可选的 `title`，按钮渲染成 `aria-label = action.label` 与 `title = action.title ?? action.label`。

  这正是本仓库在同一个渲染器里两次定下的形状：[卡片控件那条记录](../bug-fix/2026-10-30-card-controls-answer-their-own-keys.zh.md)（「开关说出自己的动词和自己的行」，当时的毛病是「971 个分不清彼此的开关」），开关自己的 `toggleLabel + ' ' + entry.name` 配裸动词 title，以及编辑按钮的 `panelEdit + ' ' + entry.name` 配裸动词 title。重构前的 MCP 卡片也是同一件事：`title = t('mcpDelete')`，`aria-label = t('mcpDelete') + ' ' + displayName`。

  市场套件卡片是同一个形状：它的卸载是 `t('uninstall') + ' ' + suite.name`，tooltip 是裸的 `t('uninstall')`；它本来就有的刷新动作以前在每张卡上都只念「刷新」，现在也说出自己刷新的那个套件。

  裸动词键有两个本来没有，已在 zh 与 en 两块里各加一条：`outputStylesDelete`（'删除输出风格' / 'Delete output style'）与 `instructionsDelete`（'删除文件' / 'Delete file'）。MCP 连接器、用户面板与市场卡片本来就有自己的动词。

- **哪些行可以删，没有变。** 每个页面都复用自己详情里已经在用的判断，既不放大也不缩小：
  - MCP 连接器：`features/mcp/StatusPanel.tsx` 里的 `deletable()`——用户自建的直接声明（`kind === 'direct'`，且有 suite id 与 server key）。套件在自己的 `mcp.json` 里声明服务，套件那一行归来源删，不归这个面板删。
  - 用户面板（技能、命令、人设）：`entry.origin === 'user'`。套件带来的文件随套件卸载。
  - 输出风格：`row.source === 'user'`。套件的风格与工作区的风格不是读者能删的。
  - 指令：列出的每一行，也就是链条里每一个真实存在的文件。
  - 市场套件卡片：只有已安装的套件卡片带卸载，这正是条目映射本来就用的那个判断。没安装的套件卡片保留那个安装主按钮，没有垃圾桶。

- **渲染器除了名字没有重写。** `ui/ResourceSurface.tsx` 早就把每一条 `entry.actions` 画成扁平图标按钮，`action.danger === true` 时带危险色 hover；它只需要那个可选的 `title` 来承载两种名字形状。模块说明也改了：它原来写的是破坏性操作属于卡片打开的详情，现在写的是反过来的话。`primary` 依然不做破坏性操作——卡上唯一可见的按钮仍然是文字按钮。

- **常驻规则跟着代码一起改。** `AGENTS.local.md` 第 4 条现在是「破坏性操作上卡」：破坏性操作是卡上 hover 显形的扁平危险图标，点它打开页面既有的确认流程，没有一键删除，详情里保留自己的按钮，能删哪些行由页面自己的规则判。

## Alternatives considered

- **保留规则，只把卸载还给市场卡片。** 否决：负责人报的是每一个页面上的这种丢失，不是一个页面；同一套卡片解剖配两条规则，正是当初漂移的开始。
- **让卡片一键删除。** 否决：确认框是 hover 就能够到的垃圾桶图标与不可逆删除之间唯一的闸门。每个页面本来就有确认流程，这次是复用它，不是替换它。
- **把可删的范围放大，让每张卡片都带这个图标。** 否决：可删性是一条信任边界，不是一个显示选择。套件的文件属于套件，卡上的图标会变成一个按下去就失败的按钮。
- **把详情里的按钮去掉，让这个动作只有一个家。** 否决：详情才是讲清这个文件事实的地方。一个为了读清楚才打开条目的读者，不该为了删它再回到列表。
- **给渲染器另加一个破坏性操作的入口。** 否决：`entry.actions` 配 `danger: true` 已经是那个入口。再加一种机制就是同一件事的第二种写法。
- **按钮用裸动词命名。** 否决：三十个连接器排在一起时，三十个都写着「删除」的按钮没有说明哪一个对应哪一行。可访问名字带上行名，tooltip 保持裸动词。
- **用对话框的标题整句当可访问名字。** 否决：「删除 MCP 服务「x」」是给对话框的一句话，不是控件的名字；本仓库的形状是动词加行。

## Consequences

- 读者现在可以从列表里删掉一个条目：悬停卡片，按垃圾桶图标，确认。
- 危险图标在网格里 hover 显形，在列表视图里常显，所以不能悬停的行也仍然看得见自己的操作。
- 屏幕阅读器在按钮里听到的是动词加行名（「删除 reviewer」），所以九十七个按钮是九十七个分得清的按钮。
- 各页面的确认文案、错误处理与重读都没有变：卡上的图标只是打开了详情原本打开的那个对话框。
- 卡片多了一个控件，操作簇因此宽一个按钮。开关仍然读在最后，也仍然不会隐藏。
- 新增两个裸动词 locale 键（`outputStylesDelete`、`instructionsDelete`）；对话框标题键（`mcpDeleteTitle`、`panelDeleteTitle`、`outputStylesDeleteTitle`、`instructionsDeleteTitle`）留给确认框继续用。

## What this note supersedes

三条唯一渲染器记录原样保留；这条记录只取代它们各自的一条子句，仅此而已：

- [MCP 清单那条记录](../simplification/2026-10-30-mcp-list-renders-through-the-one-renderer.zh.md)决定的是「**删除移入详情对话框。** 卡片的点击意味着「打开」，唯一的不可逆动作放在里面一步，确认与重读仍由面板既有的确认流程负责。」中间那句被取代：唯一的不可逆动作回到了卡上。最后那句仍然成立：确认与重读仍由面板既有的确认流程负责。
- [用户面板那条记录](../simplification/2026-10-30-user-panels-render-through-the-one-renderer.zh.md)的前提是那些页面「把破坏性操作留在详情里」，并因此把删除动作从卡上搬走。这个前提被取代：删除动作回到了卡上，闸门仍然是面板的确认流程。
- [市场页那条记录](../simplification/2026-10-30-market-page-renders-through-the-one-renderer.zh.md)否决了「**把卸载留在卡上、用确认框兜底**」，理由是渲染器契约与三个已迁移页面都把破坏性操作放在详情里一步。这个否决被取代：把卸载留在卡上、用确认框兜底，现在正是决定，五个页面都一样。

[市场卡片平台化那条记录](2026-09-02-market-card-platform-affordances.zh.md)早就把一个扁平的卸载图标放上了套件卡片；这条记录把这个形状补回失去它的那些页面，并定下这个控件簇一直没定下来的命名约定。

## Verification

- `packages/market-ui/test/mcp-status-render.test.ts` 证明：用户自建连接器的卡片带着名为「mcpDelete <连接器>」的危险图标，点它打开共享确认而不删除任何东西，确认之后删除声明并重读，而套件声明的服务根本没有这个图标。
- `packages/market-ui/test/user-panel-surface.test.ts` 证明：用户自建条目的卡片带着名为「panelDelete <条目>」的删除，套件条目的卡片不带；点它打开确认而不删除任何东西；详情对话框里用户条目仍有自己的按钮，套件条目仍然没有。
- `packages/market-ui/test/client-instructions-panel.test.ts` 证明：指令卡片带着名为「instructionsDelete <路径>」的删除，点它打开共享确认，对话框自己的那条路仍然可用，也仍然报出删除后失效的别名。
- `packages/market-ui/test/client-output-styles-panel.test.ts` 证明：用户风格卡片带着名为「outputStylesDelete <风格>」的删除，套件风格卡片不带，确认之后仍然会删掉那个风格。
- `packages/market-ui/test/resource-surface-parity.test.ts` 证明：两个页面画出的卡片骨架仍然一样，现在操作簇是其中的一行。
- `packages/market-ui/test/market-section-render.test.ts` 证明同一个决定的另一半：套件卡片的卸载说出自己那个套件，tooltip 是裸动词，危险色 class 在，第一次点击打开风险确认且不调任何接口，确认之后才发出卸载。
- `pnpm run typecheck` 与 `pnpm run lint` 对改到的文件干净；`packages/market-ui` 整个测试目录全绿；`check:css`、`check:single-renderer`、`check:reuse` 与 `check:doc-links` 通过。
