# The three remaining lists: migration map

Working note for the single-renderer migration. Scope is read-only measurement: no surface, test, or script is changed by this document. English only, per [docs/AGENTS.md](../../AGENTS.md).

Postscript: the anatomy change landed as `42c470b`, and it replaced the concatenation in section 3.4 with a template literal, so `check:css` reads 17 analyzed sheets again. The panel-intro copy pass landed as `f5840c7`. Everything else below is unchanged.

Baseline: `dev` @ `e57a1bd`. Baseline evidence, recorded on this tree:

- `pnpm exec vitest run` over the eight suites that render or compare these panels: 8 files, 86 tests, all green.
- `node scripts/check-single-renderer.mjs`: `single renderer: 4 list module(s), still migrating: ui/UserPanelSurface.tsx, features/mcp/StatusPanel.tsx, features/market/MarketSection.tsx`, exit 0.
- `node scripts/check-css-classes.mjs`: 20 stylesheets, 17 analyzed, 10 findings, 10 recorded, exit 0.

The working tree is being edited at the same time as this report, by the change this report maps. Two states are therefore cited separately. **Committed** means `e57a1bd`, the state every "today" column describes. **Working tree** means the uncommitted anatomy work described in section 0.3, which had already landed in `ResourceCard.tsx`, `ResourceSurface.tsx`, `resource-card.module.css`, `resource-surface.module.css` and the three surface files by the time this file was written.

The two earlier attempts left no revert commit, no stash, and no branch. `git log --oneline -25` and `git reflog` show only forward work, so the "8-10 expectations broke" figure in [the handoff](resource-surface-handoff.md) cannot be reconstructed from history. Section 2 rebuilds the breaking set from the assertions in the tree instead.

## 0. Two decisions the migration cannot make on its own

Both decisions change product behavior and both are cheaper to settle once than per surface.

**D1. Does a destructive action live on the card or in the detail?**

`ResourceSurface.tsx:8-10` fixes the contract: "destructive actions belong to the detail the card opens, not to the card". Two of the three surfaces ship the opposite today, and their tests assert it:

- MCP: `StatusPanel.tsx:364-379` (card trash, danger hover) with `mcp-status-render.test.ts:353-364, 366-386, 398-415` asserting its presence, and `mcp-status-render.test.ts:388-396` asserting its **absence** from the dialog.
- User panels: `UserPanelSurface.tsx:481-494` with `user-panel-surface.test.ts:211-214` asserting presence on the card and `229-230, 343` asserting absence on plugin rows.

Options:

| Option | Product effect | Cost |
| --- | --- | --- |
| (a) move delete into the detail footer, as `InstructionsPanel.tsx:188-198` and its editor footer `241` already do | one extra click, uniform with instructions and LSP | flips 8 assertions. Also leaves `.iconBtnDanger` (`resource-card.module.css:387-390`) with no user, so `check:css` fails and the class must be deleted or recorded in [the ledger](../../reference/css-classes.md) |
| (b) add `onDelete` plus a danger slot to the card contract | zero product change | contradicts the written contract and `AGENTS.local.md` rule 4, and needs the docblocks in `ResourceSurface.tsx:8-10` and `resource-card.module.css:1-19` rewritten |

Recommendation: (a), with the ledger row for `.iconBtnDanger` kept until a visual pass. The precedent exists in this repository, the tests that flip are named in section 2, and (b) trades a documented invariant for one click.

**D2. Is the switch readable at rest, or only on hover?**

The stylesheet and the new primitive docblock disagree today:

- `resource-card.module.css:153-175`: under `@container (max-width: 700px)` the whole `.rowActions` plate is `opacity: 0` and appears on `:hover` or `:focus-within`. The comment at `resource-card.module.css:15-19` calls the narrow container "the shape users see", because the settings column hands a list about 560px.
- `ResourceCard.tsx:80-88` (uncommitted `CardActions`): "the control that says whether an entry is on never hides behind a hover, only the secondary icons fade in".

Under the current CSS every hand-built card hover-reveals its switch in the branch users actually see. The renderer today does the opposite and keeps it permanently visible, but at `position: absolute; top: 12px; right: 12px` (`resource-surface.module.css:10-15`) rather than in the action column. Neither state is a deliberate decision: one is a plate rule written for icon rows, the other is an unpositioned hack.

Recommendation, and it is already the working tree's answer: switch always visible, in flow at the identity row's trailing edge, with the hover plate holding only secondary icons and `.revealOnHover` (`resource-card.module.css:401-409` at `e57a1bd`) applied to those. The uncommitted CSS deletes the plate rule, keeps the cluster in the `act` area at both widths, and lets the name ellipsize beside the switch. See section 0.3. Reasons: the switch's position is the entry's primary state, hover-revealed state is unreadable on touch, and no `@media (hover: none)` rule exists anywhere in these sheets. The classes that hack needed, `.toggle`, `.edit` and `.editButton`, are already deleted in the working tree together with `.description`, `.counts` and `.meta`.

### 0.3 What the working tree already changed, and what is still open

The uncommitted change lands the anatomy and settles D2. Verified by `git diff` and by the nine-suite run in section 6.

| Landed | Where | Effect on this map |
| --- | --- | --- |
| anatomy primitives | `ResourceCard.tsx:64-96` | `CardBody`, `CardFoot`, `CardActions`, `CardCount({ first })` |
| renderer wired to them | `ResourceSurface.tsx` (uncommitted) | identity, body and foot rows, counts with `first`, warning and separators inside the foot, `hoverHint` on the body and the source, edit button in the cluster with `revealOnHover`, switch last |
| switch visible at rest (D2) | `resource-card.module.css` (uncommitted) | plate rule deleted, cluster keeps the `act` area at both widths, `.name` ellipsizes beside the switch |
| renderer-owned boxes | `resource-surface.module.css` (uncommitted) | `.toggle`, `.edit`, `.editButton`, `.description`, `.counts` and `.meta` deleted, `.results` added |
| hand-built cards on the primitives | `SuiteCard.tsx`, `features/mcp/StatusPanel.tsx`, `UserPanelSurface.tsx` (uncommitted) | `.rowBody`, `.rowFoot` and `.rowActions` now have the renderer as a fourth user, so a surface migration no longer risks orphaning them |

Still open. The section that specifies each one is the last column.

| Still missing                                                     | Evidence in the working tree                              | Section    |
| ----------------------------------------------------------------- | --------------------------------------------------------- | ---------- |
| `surface` on the card, so `data-resource-surface` can appear      | no `surface` in `ResourceSurfaceProps`                    | 1.1        |
| `version` entry field                                             | `CardIdentity` is called without `version`                | 1.3        |
| mono body variant for endpoints and commands                      | the body is always `card.desc`                            | 1.1        |
| a second foot token, so a source and a trailing value can coexist | the foot holds one `meta` plus counts                     | 1.1        |
| `keywords` for the search haystack                                | search still reads name and description                   | 1.1 to 1.3 |
| `toggleLabel`                                                     | the `Switch` still labels itself with `entry.name`        | 1.2        |
| `canEdit` and `isEditDisabled`                                    | `onEdit` is surface-wide and the button is never disabled | 1.1, 1.2   |
| edit label format and glyph                                       | still `panelEdit + ' ' + name` with `✎`                   | 1.2        |
| `toListLabel` and `toGridLabel`                                   | still `t('list')` and `t('grid')`                         | 1.2        |
| `ResourceFilter.hint`                                             | not forwarded to the toolbar                              | 1.1        |
| an action slot for a primary CTA                                  | the cluster holds edit and switch only                    | 1.3        |
| `onDelete` and the D1 decision                                    | no destructive slot and no detail-footer delete           | 0 D1       |
| `warnings` as a list                                              | one `warning` string in the foot                          | 1.3        |
| an empty foot rendered anyway                                     | `foot.length === 0 ? null : CardFoot`                     | 4.1        |

## 1. What each surface needs, and where the capability belongs

The distinction used throughout: a gap belongs to the **shared contract** when the missing piece is a CSS slot, an interaction, or a field whose meaning every list shares. It belongs to the **surface mapping** when the surface owns the value, the predicate, or the scoping and the renderer only needs to accept it.

The "today" column in each table describes the committed renderer at `e57a1bd`. Section 0.3 lists which of those renderer-side gaps the working tree has already closed, so read the two together before scheduling the work.

### 1.1 MCP status panel (`features/mcp/StatusPanel.tsx`)

| Need, with today's code | `ResourceSurface` today | Belongs to | Smallest repair |
| --- | --- | --- | --- |
| `surface: 'mcp'` on the card (`StatusPanel.tsx:335`). It drives the narrow-width chip hiding (`resource-card.module.css:187-190`) and six test selectors (`[data-resource-surface="mcp"]`) | never passed (`ResourceSurface.tsx:151-158`) | contract | add `surface?: ResourceCardSurface` to `ResourceSurfaceProps`, spread it on `ResourceCard` |
| mono, two-line clamped endpoint on the body row, with a full-text hover hint (`StatusPanel.tsx:393`, `${rc.rowBody} ${rc.monoLine}`) | `p.surface.description` (`ResourceSurface.tsx:187`), no `rowBody`, no clamp, no hint, no mono | contract | render `CardBody` with a `mono` variant of `.desc` and `hoverHint` |
| identity: display name as title, raw `demo__service` as hint, `mono`, provenance chip wrapped so the narrow grid can hide it (`StatusPanel.tsx:340`, `chip: true`) | title, hint and `mono` supported. `chip` is not exposed even though `CardIdentity` takes it (`ResourceCard.tsx:54`) | contract | pass `entry.chip` through |
| foot: source, tool count with singular/plural label, transport (`StatusPanel.tsx:394-405`) | `counts` renders `label value` pairs (`ResourceCard.tsx:90-96`). `meta` is one string, so the source and the transport cannot both appear | contract for the slot split, mapping for the words | give the entry a `source` (mono, leading in the foot) and keep `meta` as the trailing token. The surface picks `mcpTool`/`mcpTools` by count |
| pencil only for a switchable row (`StatusPanel.tsx:346-361`, gated on `suiteId && serverKey && state !== 'foreign'`) | `onEdit` is surface-wide, with no per-entry gate. `hideToggle` exists (`ResourceSurface.tsx:47-48`), `hideEdit` does not | contract | mirror `hideToggle` as `entry.canEdit` |
| pencil disabled while busy (`StatusPanel.tsx:349-360` has no `disabled`, so busy is not blocked there either). A card-level delete would need the same | the edit button has no `disabled` (`ResourceSurface.tsx:185`) | contract | `isEditDisabled?: (id) => boolean` |
| switch labelled `enable`/`disable` and disabled for foreign rows (`StatusPanel.tsx:380-390`) | switch label is `entry.name` (`ResourceSurface.tsx:172`). `isToggleDisabled` exists | contract for the label, mapping for the predicate | `entry.toggleLabel` |
| per-filter hover hints (`StatusPanel.tsx:211`, `mcpFilterHint`) | `SearchFilterToolbar` takes `hint` (`SearchFilterToolbar.tsx:23-24, 91`). `ResourceFilter` does not (`ResourceSurface.tsx:59-64`) | contract | pass `hint` through |
| filter counts from the view model (`StatusPanel.tsx:205-212`) | the renderer counts `entries.filter(match).length` (`ResourceSurface.tsx:111-120`) | mapping, verified equal | `matchesMcpFilter` (`mcp-status-view-model.ts:61-65`) is 1:1 with the predicates the surface can pass, and `filterCounts` is computed by that same predicate (`31-46`) |
| search over name, source, endpoint, transport, reason, credential refs (`mcp-status-view-model.ts:72`) | search covers name and description only (`ResourceSurface.tsx:103-110`) | contract | `entry.keywords` |
| error line with a retry button, rendered as the tabpanel content (`StatusPanel.tsx:222-227`) | the renderer owns the panel div and shows only the empty line | mapping | render the error line above `ResourceSurface` (the precedent is `features/hooks/StatusPanel.tsx:54`) and accept that the list now renders under the error instead of being replaced |

### 1.2 User panel surface (`ui/UserPanelSurface.tsx`, three kinds)

| Need, with today's code | `ResourceSurface` today | Belongs to | Smallest repair |
| --- | --- | --- | --- |
| pencil with `aria-label` exactly `t('panelEditTitle')` and a `title` (`UserPanelSurface.tsx:471-477`) | `'✎'` glyph, `aria-label: t('panelEdit') + ' ' + entry.name`, no `title` (`ResourceSurface.tsx:185`) | contract | `entry.editLabel`, or a prop that replaces the glyph and the label format |
| pencil only where the document is the user's, or a plugin persona's routing (`UserPanelSurface.tsx:347`) | surface-wide `onEdit` | contract | `entry.canEdit` (same field MCP needs) |
| pencil and delete disabled while busy (`UserPanelSurface.tsx:475, 489`) | no `disabled` on the edit button | contract | `isEditDisabled` |
| delete on user-authored cards only (`UserPanelSurface.tsx:481-494, 349`) | absent | D1 | see section 0 |
| switch labelled `enable`/`disable`, disabled while busy or when the document failed validation (`UserPanelSurface.tsx:445, 498-504`) | label is `entry.name`, no title. `isToggleDisabled` exists | contract for the label, mapping for the predicate | `entry.toggleLabel` |
| mono title for commands, flat call name as title with the raw path as hint (`UserPanelSurface.tsx:440-444`) | supported (`mono`, `hint`) | mapping | none |
| two-line clamped description with a hover hint, translated via `useDisplayText` (`UserPanelSurface.tsx:508`) | unclamped paragraph, no hint | contract | `CardBody` plus the same clamp |
| foot: `suiteName` or the disk path, mono and ellipsized (`UserPanelSurface.tsx:509-518`) | `span.surface.meta` (`resource-surface.module.css:30-36`), sans, no mono | contract | the foot's leading value is `source`, rendered with `.provenance`/`.path` |
| search over name, description, suite name and path (`UserPanelSurface.tsx:173`) | name and description only | contract | `entry.keywords` |
| view-switch accessible names `switchToList` / `switchToGrid` (`UserPanelSurface.tsx:316-317`) | hard-coded `t('list')` / `t('grid')` (`ResourceSurface.tsx:135-136`) | contract | `toListLabel` / `toGridLabel` props. This is also a live accessibility defect in the renderer: the toolbar documents those labels as "where a click leads" (`SearchFilterToolbar.tsx:43-46`) |
| loading text and empty text as two states (`UserPanelSurface.tsx:329-332`) | one `emptyText` | mapping | compute it, as `features/lsp/LspStatusPanel.tsx:170` and `features/hooks/StatusPanel.tsx:77` do |
| own `role="tabpanel"` wrapper (`UserPanelSurface.tsx:321-328`) | renderer emits it (`ResourceSurface.tsx:140-144, 201-203`) | mapping | delete `css.body` |
| `filterId` base `${kind}-panel-filter` (`UserPanelSurface.tsx:55`) | `useId()` | mapping, no test asserts the literal | none. Every kind still gets a distinct base because each mount has its own `useId` |
| text-view switch before the view switch (`UserPanelSurface.tsx:319`) | `beforeView` supported | mapping | none |

### 1.3 Market (`features/market/MarketSection.tsx` + `SuiteCard.tsx`)

| Need, with today's code | `ResourceSurface` today | Belongs to | Smallest repair |
| --- | --- | --- | --- |
| version chip (`SuiteCard.tsx:136`, `CardIdentity` `version`) | `ResourceEntry` has no `version` (`ResourceSurface.tsx:22-49`) | contract | one field, passed straight through |
| primary CTA in the cluster: install or add source (`SuiteCard.tsx:100-131`) | no slot for an arbitrary action | contract | an ordered action list per entry, rendered before the switch |
| secondary icon actions: refresh, uninstall (`SuiteCard.tsx:59-99`) | only the pencil | contract | same action list, with `.revealOnHover` on the secondary ones |
| identity: name, version, provenance tag, no hint (`SuiteCard.tsx:136`) | supported except `version` | contract | the field above |
| body: translated description, hover hint, two-line clamp (`SuiteCard.tsx:139`) | unclamped, no hint | contract | `CardBody` |
| foot: source id mono, then up to six surface counts, then two warnings each preceded by a separator (`SuiteCard.tsx:140-149`) | counts support exists. Warnings are a single string, rendered before the counts and outside any foot (`ResourceSurface.tsx:188-195`) | contract for warnings placement and plurality, mapping for the words | `entry.warnings: readonly string[]` rendered inside `CardFoot`, or one composed string if the two separate tooltips are not worth keeping |
| card state `installed && enabled ? 'active' : 'disabled'` (`SuiteCard.tsx:135`) | supported | mapping | none |
| keyboard: the card is clickable but has no `role`, `tabIndex`, or key handler (`SuiteCard.tsx:133-135`) | `interactiveCardProps` (`ResourceCard.tsx:39-51`) | contract, and it fixes a defect | migrating adds keyboard activation. Today the market card is mouse-only |
| tab filters with counts scoped to the selected source chip, and `uninstalled` as a derived count (`MarketSection.tsx:291-307`, `market-view-model.ts:23-44`) | filters and counts both computed inside the renderer | mapping, verified equal | pass the category-scoped entries, then `all` = `entries.length` = `scopeTotals.all`, `installed` = matching entries, `uninstalled` = the negation. Search loses keywords, see below |
| search over name, description and keywords (`market-view-model.ts:51`) | name and description only | contract | `entry.keywords` |
| install confirmation, risk confirmation, source editor, toast, unmanaged strip, error boundary (`MarketSection.tsx:362-503, 259-285`) | not the list's business | mapping | keep in the section |
| the source chip strip stays outside the renderer (`MarketSection.tsx:248-258`) | not modelled, and should not be | mapping | the section keeps `SourceTabsRow` |

### 1.4 The contract delta, in one list

Shared renderer work, in dependency order:

1. Render the anatomy: `CardIdentity` / `CardBody` / `CardFoot` / `CardActions` (`ResourceCard.tsx:54-88` in the working tree), with `CardCount({ first })` inside the foot.
2. `ResourceSurfaceProps`: `surface`, `toListLabel`, `toGridLabel`.
3. `ResourceEntry`: `version`, `source`, `keywords`, `chip`, `bodyMono`, `toggleLabel`, `canEdit`, `warnings`.
4. Per-entry callbacks: `isEditDisabled`, plus the action slot or `onDelete` from D1.
5. `ResourceFilter.hint` passthrough.

Reused locale keys only (`enable`, `disable`, `panelEdit`, `switchToList`, `switchToGrid`, `list`, `grid`, `panelDelete`, `mcpTool`/`mcpTools`), so `client-locales.test.ts:7-12` keeps passing without new pairs.

## 2. Tests that assert each surface, ranked by risk

Risk means the chance that a mechanical migration turns the assertion red for a reason the author did not intend, weighted by how hard the failure is to read. All line numbers are from the tree at `e57a1bd`.

### 2.1 MCP status panel

| Risk | File:line | Assertion | What breaks |
| --- | --- | --- | --- |
| 1 | `packages/market-ui/test/mcp-status-render.test.ts:388-396` | "keeps the detail dialog free of a delete action" | the exact inverse of the migration under D1(a). This test must be rewritten, not repaired |
| 2 | `mcp-status-render.test.ts:353-364, 366-386, 398-415` | card delete exists on a direct row, absent on a plugin row, confirms then re-reads, reports a failure | the click path becomes card, then detail, then footer, then confirm |
| 3 | `mcp-status-render.test.ts:197, 239, 302, 315-316, 328-329, 343` | `[data-resource-surface="mcp"]` on the card, plus `data-resource-state` | `data-resource-state` is already supported. `surface` is not passed by the renderer, so all six selectors return `null` and five of the file's ten tests fail on an empty selector |
| 4 | `mcp-status-render.test.ts:224, 288-294` | `[aria-label="panelEdit service"]` | label format and glyph differ. Survives if the entry's `name` is the display name and the label keeps the `panelEdit` prefix |
| 5 | `packages/market-ui/test/bilingual-toggle.test.ts:257-275, 389-415` | first `[role="button"]` is the MCP card, and the panel text holds `service` | survives if `name` maps to the display name. Breaks if the renderer ever wraps the name in its own `role="button"` |
| 6 | `packages/market-bundle/test/integration/client-mcp-detail.test.ts:58-63, 64-70` | the detail has no `panelEdit` text button and no switch | survives under D1(a) as long as the new footer button's text is not `panelEdit` |

Not at risk: `client-mcp-detail-actions.test.ts` (pure policy), `mcp-status.test.ts` (server route), `client-view-models.test.ts` (view model), `tab-layout-sharing.test.ts` and `client-workspace-tabs.test.ts` (they mock `McpStatusPanel`).

### 2.2 User panel surface

| Risk | File:line | Assertion | What breaks |
| --- | --- | --- | --- |
| 1 | `packages/market-ui/test/user-panel-surface.test.ts:211-214, 343` | delete on the user card, absent on the plugin card, absent for plugin skills and commands | D1. Under (a) four assertions move into the detail or editor footer |
| 2 | `user-panel-surface.test.ts:99, 132, 157, 161, 212, 214, 229, 344` and `packages/market-bundle/test/integration/user-panel-cache.test.ts:181` | `click('panelEditTitle')` and `button[aria-label="panelEditTitle"]` | the shared label appends the entry name and renders `✎`, so both the exact-`aria-label` match (`user-panel-surface.test.ts:68`) and the text match fail. Nine call sites |
| 3 | `user-panel-surface.test.ts:154` | `button[aria-label="switchToList"]` | the renderer hard-codes `t('list')`, so the selector finds nothing. This is the one break a reader will not predict from the diff |
| 4 | `user-panel-surface.test.ts:302-303` | `switchButton().title === 'disable'` | the shared switch has no title and labels itself with the entry name |
| 5 | `user-panel-surface.test.ts:229-230` | plugin skill and command cards carry no pencil | the renderer's `onEdit` is surface-wide. Breaks unless `canEdit` lands first |
| 6 | `user-panel-cache.test.ts:108-118, 153-167, 190-191` | loading text, `aria-checked` through the toggle, cached description | survives if the surface keeps `emptyText` computed and maps `isOn` to `!entry.disabled` |
| 7 | `bilingual-toggle.test.ts:221-255, 425-459` | description flips, switch present or absent with the setting, one read per mount | survives: `beforeView` is already supported |

Not at risk: `client-workspace-tab-row.test.ts`, `tab-layout-sharing.test.ts`, `client-workspace-tabs.test.ts` (all mock the surface), `client-detail-editors.test.ts` (editor dialogs only).

### 2.3 Market

| Risk | File:line | Assertion | What breaks |
| --- | --- | --- | --- |
| 1 | `packages/market-ui/test/market-section-render.test.ts:102-108` | exactly one `article button` whose text contains `install` | needs a primary CTA slot inside the card. Without one the CTA cannot render, and a CTA rendered outside the `article` scores zero |
| 2 | `market-section-render.test.ts:120` | `el.querySelector('article')` is not null | the renderer emits `article` (`ResourceCard.tsx:25`), so this holds. It fails only if a card is replaced by a wrapper |
| 3 | `market-section-render.test.ts:181-197` | the selected source chip exposes `.srcTabOn` and a `.srcTabControls` plate with two buttons | outside the renderer, untouched. Listed because the migration touches the section's toolbar region |
| 4 | `market-section-render.test.ts:216-240` | chip order and labels exclude buttons inside a `[role="tablist"]` | the renderer's segmented control is a tablist inside a tabpanel, so the filter still excludes it. Holds |
| 5 | `bilingual-toggle.test.ts:341-385` | cards flip text, then the first `article` opens the detail | survives if the entry's description carries `useDisplayText` output |
| 6 | `market-section-render.test.ts:140-179` | install confirmation, locked commit, local tree note | dialogs, untouched |

Not at risk: `market-overview-reads.test.ts` (data reads), `client-page-mode.test.ts` (mocks `PluginWorkspace` to `null`), `menu-row-faces.test.ts` and `client-menu-row-faces.test.ts` (settings menu), all `client-extension-preset*` suites (they render `ResourceList`, not `MarketSection`).

### 2.4 The shared contract's own tests

`packages/market-ui/test/resource-surface.test.ts:58-112` and `packages/market-ui/test/resource-surface-parity.test.ts:115-154` are the tests that must be **extended first** and that no migration may break:

- `resource-surface.test.ts:78-84`: the card carries no `aria-pressed`, the switch is its own control.
- `resource-surface.test.ts:68-76`: the switch toggles without opening. This is the assertion that makes a hover-hidden switch invisible to the test, so D2 cannot be caught here. Only a markup assertion on the cluster's opacity or a DOM-structure assertion would catch it.
- `theme-tokens.test.ts:17-40` scans every `*.module.css` for `var(--dsw-*)` names and fails on one the host does not define. Deleting rules is safe. New rules in `resource-surface.module.css` must use only the tokens listed there.
- `resource-surface-parity.test.ts:147`: the descendant tag sequence of an `InstructionsPanel` card must equal the sequence of a directly rendered card. Any slot added conditionally (version, counts, warnings) keeps both sides equal because both render through the renderer. Every slot must therefore be emitted unconditionally by the renderer and suppressed by the entry, not by branching in the consumer.

One guard is thinner than it looks. Only `user-panel-surface.test.ts:154` asserts the view-switch accessible name. MCP (`StatusPanel.tsx:217-218`) and Market (`MarketSection.tsx:312-313`) pass the same `switchToList`/`switchToGrid` pair, and no test asserts either, so replacing them with the renderer's hard-coded `list`/`grid` would regress two surfaces silently.

## 3. Dead CSS, and what `pnpm run check:css` can actually see

The gate reports a class only when its stylesheet's importers are all known, no importer indexes the stylesheet by a computed key, and the name appears neither as `ident.class` nor as a quoted string (`scripts/check-css-classes.mjs:107-162`). Three of the 20 sheets are skipped for that reason. This matters more than the class lists, because it decides which cleanups fail the build.

| Sheet                                | Analyzed? | Why                                                                                 |
| ------------------------------------ | --------- | ----------------------------------------------------------------------------------- |
| `ui/resource-card.module.css`        | yes       | plain imports only                                                                  |
| `ui/resource-surface.module.css`     | yes       | one importer, no computed key                                                       |
| `features/mcp/mcp-status.module.css` | yes       | four importers, no computed key                                                     |
| `ui/panel.module.css`                | **no**    | `features/extension-presets/ExtensionPresetEntry.tsx` concatenates `'x' + panelCss` |
| `features/market/market.module.css`  | **no**    | `workspace/page-mode.tsx` indexes `css[...]`                                        |
| `ui/source-strip.module.css`         | **no**    | same rule                                                                           |

### 3.1 MCP migration

| Class | Sheet:line | Last user | Gate |
| --- | --- | --- | --- |
| `.toolbar` | `mcp-status.module.css:11-13` | `StatusPanel.tsx:200` | fails the gate, must be deleted |
| `.empty` | `mcp-status.module.css:21-27` | `StatusPanel.tsx:225, 227` | fails the gate, must be deleted |
| `.monoLine` | `resource-card.module.css:299-308` | `StatusPanel.tsx:393` | fails the gate, must be deleted. **This is the one that matters**: deleting it deletes the mono endpoint, which is a user-visible regression unless the renderer grows a mono body slot first |

`.error` (`mcp-status.module.css:28-35`) stays, used by the hooks and LSP panels. `.surface` stays for the same reason.

### 3.2 User panel migration

| Class                     | Sheet:line                                  | Last user                       | Gate                                        |
| ------------------------- | ------------------------------------------- | ------------------------------- | ------------------------------------------- |
| `.body`                   | `panel.module.css:67`                       | `UserPanelSurface.tsx:324`      | invisible to the gate. Delete by inspection |
| `.empty`                  | `panel.module.css:167`                      | `UserPanelSurface.tsx:330, 332` | invisible to the gate                       |
| `.editorError`            | `panel.module.css:152`                      | `UserPanelSurface.tsx:294`      | invisible to the gate                       |
| `.desc`, `.revealOnHover` | `resource-card.module.css:290-297, 401-409` | also Market                     | survives this step                          |

`.shell` (`panel.module.css:9`) stays, used by the preset manager. `formCss.seg` and `formCss.field` stay, used by the editor modal.

### 3.3 Market migration

The market section keeps its own shell, source strip, unmanaged row and dialogs, so **no class in `market.module.css` becomes dead**: `.market` (`8`), `.pageMode` (`26`), `.marketControls` (`33`), `.header` (`58`), `.empty` (`169`, also used by `SuiteDetail.tsx`), `.modalFooter` (`196`, also used by `InstallConfirmModal.tsx`) and `.confirmCheck` (`205`) all keep a user. The sheet is skipped anyway.

### 3.4 Same measurement on the working tree

Three corrections follow from the uncommitted change.

1. **The anatomy classes are no longer at risk.** `ResourceSurface.tsx` and the three surface files now render `CardBody`, `CardFoot` and `CardActions`, so `.rowBody` (`227`), `.rowFoot` (`233`) and `.rowActions` (`246`) gained the renderer as a fourth user. On the committed renderer, nine classes would have lost their last reference at the final migration. With the anatomy wired, only two can still lose theirs: `.monoLine` (`299`, MCP only) and `.iconBtnDanger` (`387`, the three card-level destructive buttons, which D1 decides).
2. **`resource-surface.module.css` is clean.** `.toggle`, `.edit`, `.editButton`, `.description`, `.counts` and `.meta` were deleted with the anatomy, so the sheet still analyzes and has nothing dead.
3. **`resource-card.module.css` silently left the gate.** `ResourceSurface.tsx` composes the edit button's class as `card.iconBtn + ' ' + card.revealOnHover`. That matches the gate's concatenation rule (`scripts/check-css-classes.mjs:76-79`), so the sheet is now skipped in full. `node scripts/check-css-classes.mjs --json` reports `"sheets": 20`, **`"analyzed": 16`**, down from 17, and 0 findings. The stylesheet this whole migration exists to consolidate is now exempt from the rule that polices it, and every class in it, live or dead, is invisible to `check:css`.

The repair was one line: the class is a template literal again in `42c470b`, and `--json` reads `"analyzed": 17`. The `.monoLine` finding in section 3.1 now fails the build as it should. `.path` (`324`) is already masked for a different reason: `SearchFilterToolbar.tsx` contains the literal string `'path'` in an SVG.

## 4. The one card anatomy, and every delta from it today

### 4.1 What the renderer must emit

Four rows inside one `article[data-resource-state][data-resource-surface][data-resource-id]`, all grid areas claimed:

| Row | Class and anchor | Contents | Suppressed by |
| --- | --- | --- | --- |
| identity | `.rowId`, `data-card-row="id"` | name in a hover hint, in mono when technical, the version chip, the provenance tag | never |
| body | `.rowBody`, `data-card-row="body"` | one `p` clamped to two lines by `.desc` (or `.monoLine` for endpoints and commands), full text on hover | an absent description |
| foot | `.rowFoot`, `data-card-row="foot"` | source in mono and ellipsized, then `· count` pairs, then warnings | recommended: never, even when empty, so cards stay even. The working tree suppresses an empty foot (`foot.length === 0 ? null : CardFoot`), which leaves a row of uneven cards whenever one entry has no source and no counts |
| actions | `.rowActions`, `data-card-row="actions"` | occupies the `act` area: top right in the grid, trailing in the list, and in flow at the narrow container too. Secondary icons that fade in (`.revealOnHover`), then any primary action, then the switch last | the switch only when `hideToggle` |

Interaction, unchanged from `ResourceSurface.tsx:6-11`: card click opens, the switch stops propagation, the card carries no `aria-pressed`, and destructive actions live in the detail (D1).

### 4.2 Deltas per surface

| Slot | Target | MCP today | User panel today | Market today |
| --- | --- | --- | --- | --- |
| identity row | `CardIdentity` with hint, mono, version, tag, chip | display name + raw name hint + mono + chip (`StatusPanel.tsx:340`) | flat call name + path hint + mono for commands (`UserPanelSurface.tsx:463`) | name + version + provenance tag, no hint (`SuiteCard.tsx:136`) |
| body row | `.rowBody` + `.desc`, two-line clamp, hover hint | `.rowBody` + `.monoLine`, mono, `overflow-wrap: anywhere`, hover hint (`393`) | `.rowBody` + `.desc`, hover hint (`508`) | `.rowBody` + `.desc`, hover hint (`139`) |
| foot row | `.rowFoot`, source first in mono | `.rowFoot`: source, `·` tool count, `·` transport (`394-405`) | `.rowFoot`: `suiteName` or path only (`509-518`) | `.rowFoot`: source, counts, two warnings with separators (`140-149`) |
| counts | `CardCount` with `first` | inline, value before label ("0 tools"), singular/plural | none | `CardCount` per non-zero surface, label before value |
| warnings | inside the foot | none | none | two, each `CardWarning` with a preceding separator |
| edit affordance | icon button in the cluster, label and disabled per entry | always visible, no `.revealOnHover`, no disabled (`346-361`) | `.revealOnHover`, disabled while busy (`469-480`) | none |
| extra actions | ordered list in the cluster | none | none | refresh, uninstall, or a primary install/add-source CTA |
| destructive | detail footer (D1) | card, danger hover (`364-379`) | card, danger hover (`481-494`) | card, uninstall (`74-86`) and again in the detail |
| switch position | last in the cluster | last (`380-390`) | last (`495-505`) | last when installed (`87-98`), replaced by the CTA when not |
| switch label | entry-supplied `enable`/`disable` | `enable`/`disable` | `enable`/`disable` | `enable`/`disable` |
| switch visible at rest | yes (D2) | **no** under 700px container, yes in list view and above | same | same, and its secondary icons fade separately |
| keyboard | `interactiveCardProps` | yes (`322`) | yes (`450-459`) | **no**: `onClick` only (`133-135`) |
| `data-resource-surface` | set by the surface | `'mcp'` | `skills`/`commands`/`personas` (`462`) | `'market'` (`135`) |
| `data-resource-id` | set by the renderer | absent | absent | absent |

The table reads the committed renderer. At `e57a1bd` the renderer was the only implementation that emitted no `.rowBody`, no `.rowFoot`, no `.rowActions`, no `.provenance` and no clamped `.desc` at all, which is why all three hand-built cards were **closer to the documented anatomy than the shared one**. The working tree closed that gap (section 0.3), so the remaining deltas are the per-slot columns above. The market card is still the only implementation that is not keyboard-operable, so its migration fixes a real defect.

## 5. Commit sequence

Per the handoff, tests first. Each step is one commit. `pnpm exec vitest run` is deliberate, because `pnpm test` runs `pretest` (`check:quick`) first and hides whether the failing test is the one you just changed. Node must be 22 or newer for these suites (`node -v` printed `v22.23.1` here).

### Step 0, the shared renderer (partly landed)

Already in the working tree, so no separate commit: the anatomy primitives, the renderer wired to them, the D2 stylesheet ruling, and the deleted renderer slots.

The rest of step 0, tests first:

1. Extend `packages/market-ui/test/resource-surface.test.ts` (7 tests in the working tree) with the remaining contract: `surface`, `version`, the mono body, the second foot token, `toggleLabel`, `canEdit`, `isEditDisabled`, `keywords`, `hint` on a filter, `toListLabel`/`toGridLabel`, and the action slot or `onDelete` from D1. Run `pnpm exec vitest run packages/market-ui/test/resource-surface.test.ts`, expect red.
2. Add the fields and props. Run `pnpm exec vitest run packages/market-ui/test/resource-surface.test.ts packages/market-ui/test/resource-surface-parity.test.ts packages/market-ui/test/client-instructions-panel.test.ts packages/market-ui/test/client-output-styles-panel.test.ts packages/market-bundle/test/integration/client-hooks-status-panel.test.ts packages/market-bundle/test/integration/client-extension-presets.test.ts packages/market-bundle/test/integration/client-extension-preset-v5.test.ts`. Every already-migrated consumer renders through the renderer, so any red there means a slot became conditional and the parity assertion at `resource-surface-parity.test.ts:147` is doing its job.
3. Replace the edit button's class concatenation with a template literal, then run `node scripts/check-css-classes.mjs --json`. `"analyzed"` must read 17 again, not 16. This is the one step whose acceptance criterion is about the gate itself.
4. `pnpm run check:quick && pnpm exec prettier --check packages/market-ui`.

### Step 1, MCP (recommended first surface)

1. Rewrite the interaction contract in `packages/market-ui/test/mcp-status-render.test.ts`: card click opens, switch independent, delete reachable through the detail. Expect red on `pnpm exec vitest run packages/market-ui/test/mcp-status-render.test.ts`.
2. Add `onDelete` to `McpDetailModal`'s footer (`features/mcp/McpDetailModal.tsx:137` onward) and update `packages/market-bundle/test/integration/client-mcp-detail.test.ts:58-70` if the new button touches either assertion.
3. Replace the toolbar and `McpCard` with `ResourceSurface`, mapping the six fields from section 1.1. Run `pnpm exec vitest run packages/market-ui/test/mcp-status-render.test.ts packages/market-ui/test/bilingual-toggle.test.ts packages/market-bundle/test/integration/client-mcp-detail.test.ts packages/market-ui/test/resource-surface-parity.test.ts`.
4. Delete `.toolbar` and `.empty` from `mcp-status.module.css`, and `.monoLine` from `resource-card.module.css` only if step 0 did not absorb it. Run `node scripts/check-css-classes.mjs`.
5. Remove the entry from `REMAINING` (`scripts/check-single-renderer.mjs:24-31`). Run `node scripts/check-single-renderer.mjs`, expect `single renderer: 3 list module(s), still migrating: ui/UserPanelSurface.tsx, features/market/MarketSection.tsx`.
6. `pnpm run check:refactor`.

### Step 2, user panels

1. Rewrite `packages/market-ui/test/user-panel-surface.test.ts` (the nine edit-label sites, the delete location, `switchToList`) and `packages/market-bundle/test/integration/user-panel-cache.test.ts:181`. Red, verified with `pnpm exec vitest run packages/market-ui/test/user-panel-surface.test.ts packages/market-bundle/test/integration/user-panel-cache.test.ts`.
2. Give the delete a home under D1: `EntryEditorModal` (`ui/panel.tsx:104-181`) or `UserEntryDetailModal` (`ui/UserEntryDetail.tsx:105-176`, which has no footer today), following `InstructionsPanel.tsx:241`.
3. Replace the toolbar, the tabpanel wrapper and `UserEntryRow` with `ResourceSurface`. Run `pnpm exec vitest run packages/market-ui/test/user-panel-surface.test.ts packages/market-bundle/test/integration/user-panel-cache.test.ts packages/market-ui/test/bilingual-toggle.test.ts`.
4. Delete `.body`, `.empty` and `.editorError` from `panel.module.css` (`67`, `167`, `152`). The gate cannot see these, so verify by searching the three names across `packages/market-ui/src` before removing them.
5. Remove `ui/UserPanelSurface.tsx` from `REMAINING`, run `node scripts/check-single-renderer.mjs`.
6. `pnpm run check:refactor`.

### Step 3, market

1. Rewrite `packages/market-ui/test/market-section-render.test.ts` around the renderer's cards: one primary CTA inside the `article`, cards keyboard-operable, counts and warnings in the foot. Red, verified with `pnpm exec vitest run packages/market-ui/test/market-section-render.test.ts`.
2. Add the action list and the `warnings` field to the contract if step 0 did not, then replace `SuiteCard` with `ResourceSurface` and keep the dialogs in the section. Run `pnpm exec vitest run packages/market-ui/test/market-section-render.test.ts packages/market-ui/test/bilingual-toggle.test.ts packages/market-ui/test/resource-surface-parity.test.ts`.
3. Delete `features/market/SuiteCard.tsx`. Run `node scripts/check-css-classes.mjs` and expect the nine `resource-card.module.css` classes from section 3.4 to pass because the renderer now uses them. If any of the nine is reported, the renderer did not absorb the anatomy.
4. Remove `features/market/MarketSection.tsx` from `REMAINING`. Run `node scripts/check-single-renderer.mjs`, expect `every surface renders the one list`.
5. `pnpm run check:refactor`.

Overall order: step 0, then MCP, then user panels, then market. MCP first among the surfaces because it is the twin of the already-migrated `LspStatusPanel` (same stylesheet, same toolbar, same detail modal shape), its data mapping is the smallest of the three, and it is the only surface whose dead CSS the gate can actually see, so the cleanup is enforced rather than trusted.

### The single highest-value migration

**MCP status panel, immediately after step 0.** It retires the D1 product decision in the smallest blast radius (one dialog, four tests), it validates the extended renderer against a real surface that already has ten assertions about the card, and it converts `.toolbar`, `.empty` and `.monoLine` from live code into gate-enforced deletions. The market is the larger prize for visible uniformity, but it needs the whole contract at once (version, CTA slot, dual warnings, counts, keyboard), which is the shape of change that produced both reverted attempts.

## 6. What was verified, and what was not

Verified on this tree:

- The eight suites in section 0's baseline run, 86 tests green, on the committed state.
- The same surfaces plus the two already-migrated ones re-run against the uncommitted tree: 9 files, 85 tests green (`user-panel-surface.test.ts` grew from 13 to 16 tests, `resource-surface.test.ts` from 5 to 7).
- `check-single-renderer` green at both states, and `check-css` green at both, with the analyzed count dropping from 17 to 16 as section 3.4 explains.
- The per-class reference map behind sections 3.1 to 3.4, computed from all `*.tsx`/`*.ts` under `packages` with the gate's own rules (bound identifier plus `ident.class`, quoted-string fallback, `composes` credit, computed-key skip).
- The two seams for D1 and D2, by reading the assertions and the stylesheet rules quoted.

Not verified:

- No browser pass. The switch's hover behavior, the two-line clamp under the real settings column, and the card heights at 29 entries are read from CSS, not observed.
- No red-then-green run of the proposed test edits. They are instructions, not results.
- The uncommitted `ResourceCard.tsx` additions were read but not exercised by any test in this session, so their behavior (for example `CardCount` with `first`) rests on the diff alone.
- Which of the nine inherited `resource-card.module.css` classes the renderer will actually absorb is a design choice, not a measurement. Section 3.4 states the set that must be absorbed for the gate to stay green.
