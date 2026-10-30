# Agent Note: a filter bar answers "what needs me?", not "who declared this"

Status: implemented

## Problem

A product review of the nine tabs' filter bars found one mechanical defect and one pattern.

**The connector bar rendered 全部 twice.** `MCP_FILTERS` still carried `'all'` after the panel moved onto the shared renderer, and the renderer adds its own `all` segment: two segments with value `all`, duplicate React keys, duplicate DOM ids, both reading selected, and ArrowRight from 全部 dead because the walk landed on the second one.

**Most tabs repeated a chip.** 用户/插件 on the connector, language-engine, skills, shortcuts and experts bars restates a chip printed on every row. 已加载/内容重复 on 系统提示词 named two of seven statuses over a list of at most two rows, and 已加载 hid the truncated rows someone opens that page to find. 钩子's 可运行 equals 全部 whenever nothing is limited, and its 受限 contradicted the warning words on the rows it found. Meanwhile neither status surface could isolate the rows that need a click, although both payloads already carry per-state totals nobody rendered.

## Decision

- **A status surface filters by state, not by owner.** 连接器 and 语言引擎 replace 用户/插件 with 需处理: failed, degraded, missing credentials, orphaned (MCP) and failed, conflicting, missing components (LSP). 已禁用 stays as the reversible-state cut.
- **A list short enough to scan carries no tabs.** 系统提示词 and 钩子 lose their filter pairs; the tag and the warning already name each row's state.
- **The renderer hides the segment when a surface has no cuts.** A strip with one tab ("all") is chrome that says nothing, so `ResourceSurface` renders no `SegmentedControl`, no `tabpanel` role and no empty panels unless the surface supplies at least one filter.
- **One vocabulary for one axis.** 输出风格's 自建/来自套件 become 用户/插件, matching every other surface, and the market's source chip reads 全部来源 so one column does not carry two different 全部 numbers.
- **The dead LSP view model goes.** `lsp-status-view-model.ts` had no production caller; the renderer filters, counts and pages, and matching on the card's own state replaced comparing translated copy.

## Alternatives considered

- **Keep 用户/插件 and add 需处理.** Rejected: three tabs over seven connectors is a bar wider than the list.
- **Keep the status tabs and rely on the tag.** Rejected for 系统提示词 and 钩子 only, where the lists are tiny; the state surfaces keep their 需处理 because a status list is scanned for problems.
- **Hide the lone all-tab in CSS.** Rejected: the tab would still own a panel id, an aria-labelledby and a keyboard stop the reader can reach but not see.

## Consequences

- 连接器 on a real profile now reads 全部 5 · 需处理 3 · 已禁用 0, where the rows needing a click are one press away.
- A surface with no filters has an empty toolbar segment gap instead of a one-tab strip.
- Two untranslated-looking hint keys and one dead view model are gone; the dictionaries carry only what renders.

## Verification

- `packages/market-bundle/test/integration/client-view-models.test.ts` pins 需处理 as the failure/degradation cut and 已禁用 as the switched-off cut.
- `packages/market-ui/test/client-instructions-panel.test.ts` asserts no tab strip renders when a surface supplies no filters.
- In `market-dev` against the built bundle: 市场 全部 1000 · 已安装 29 · 未安装 971; 连接器 全部 5 · 需处理 3 · 已禁用 0; 语言引擎 全部 1 · 需处理 0 · 已禁用 1; 系统提示词 and 钩子 render no tabs; 输出风格 reads 全部 · 用户 · 插件.
