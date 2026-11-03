# Agent Note: one filter, and both surfaces draw it from one table

Status: implemented

## Problem

Every list cut on its own axis. The market hid uninstalled suites, the service panels hid whatever "needs attention", the user panels hid disabled rows and offered source as well, the language engine repeated the attention cut, and the preset manager hid everything that was not switched on. The same toolbar therefore asked a different question per tab, and two of those questions (installed state, switched-on state) were already answered by the card's rail and its state word.

## Decision

- **The only facet is who provides the row.** A suite brought it, or a person wrote it. Each face words its two providers in its own vocabulary (a project file against a user-level one, a suite service against a direct one), because the product's own nouns differ per surface, but the mechanism, the position, the order and the zero-count hiding are shared.
- **The table lives in one module and both surfaces read it.** `ui/surface-facets.ts` declares the words per workspace tab and builds the cuts; the settings panels and the preset manager call `surfaceProviderCuts` with their own "who provides this row" function. Neither surface can add a filter the other does not have.
- **A face with one provider draws no facet.** The market and the hook list can only hold suite rows: 全部 1000 beside 套件 1000 would be the same list twice. The rule is in the table, not in a conditional at each call site.
- **State cuts are gone.** A failed connector, a disabled skill, an uninstalled suite: the card already says so through its rail, its state word and its action. Hiding the other rows was the only thing the cut added.

## Alternatives considered

- **Keep a uniform state cut on every face (已启用/已停用 everywhere).** Rejected: the owner's point is that this state is visible in the list already, and a uniform useless filter is not more honest than a varied useful one.
- **Let each panel keep its own facets and align only the labels.** Rejected: labels were already aligned; the divergence was which question was asked.
- **Put the table in `workspace/`.** Rejected by the architecture gate: `ui/` may not import from `workspace/`, and the surface that draws the cuts is in `ui/`. The module moved there.

## Consequences

- Nine faces and nine preset faces now show the same facet row for the same data.
- A new list gets the facet by naming its providers; it cannot invent a third axis.
- The preset manager and the settings page can be compared field by field: the facets are identical, and the remaining differences are data scope and which actions are offered.

## Verification

- Measured in `market-dev` on both surfaces. Settings: 技能 全部 157 · 套件 157; 快捷指令全部 22 · 套件 21 · 用户 1; 连接器 全部 5 · 套件 2 · 用户 3; 系统提示词 全部 1 · 用户级 1; 输出风格全部 1 · 套件 1; 市场 and 钩子 no facet. The preset manager reports the same rows, with 系统提示词 reading 全部 3 · 项目 2 · 用户级 1 because it reads the session's full chain — same facet, wider data.
- `surface-facets.test.ts` pins the table: two cuts in one order for dual-provider faces, none for single-provider faces, and an unknown row belongs to neither half.
- The full suite passes (2526), the architecture gate is clean, and the three tests that asserted the old cuts were updated to the shared facet.
