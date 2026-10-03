# Agent Note: The project resource window reuses host primitives and the surface-toggle state pattern

Status: implemented · Date: 2026-10-04

## Problem

The finalized prototype (docs/scratch/prototypes/surface-filter-entry, commit 2b0f839) asks for one composer-entry window that lists this workspace's installed resources across six faces, filters individual entries per project, and stores complete switch snapshots as cross-project favorites — with zero custom visual language.

## Decision

- **Every control is a host primitive.** The window rides Modal (dialog chrome, Escape, mask, close button), SegmentedTabs (six face tabs with counts in the label string), SegmentedControl (card/list view switch), Input (search, leading IconSearchOutlineMedium), Switch (row toggles), Pill (favorite chips), Tag (provenance), and Toast (apply/save/delete feedback). The composer entry is a four-square glyph with a filter dot, drawn inline like the prototype's .plugin-entry (currentColor, no chrome); no primitives export a grid glyph. Row chrome reuses ResourceCard (3px state border, data-resource-view) exactly like the market and MCP cards.
- **State extends the surface-toggles pattern instead of forking it.** Entry filters live in the same per-workspace document (hashed path key) as a v2 entries section that the v1 writer preserves on a single-surface flip; favorites live in one global data-root file because their value is replaying a setup in another workspace. Runtime gates follow the surface-switch shape: each mount contributor answers the deny set where it computes its wanted rows, keeping faces orthogonal; a market-face deny is the one deliberate snapshot filter because its row IS the suite.
- **One aggregation, no second scan.** The inventory route composes overview() + panel stores + mcpStatus() + lspStatus() into the window payload; a favorite's active state is derived by exact snapshot match, so any manual flip leaves the workspace custom.
- **Dictionary isolation.** The window's zh/en keys ship in locales-resources.ts and merge into the one namespace at registration, so the main locales.ts (held by a parallel work stream) stays untouched; Translate stays keyed to the main dictionary and the merged-dict fact is asserted once at the slot wiring.

## Alternatives considered

- A bespoke window component set was rejected: the host primitives already implement the exact anatomy (tablist semantics, controlled switches, portal toasts), and the repo's style rules forbid a second visual language.
- Storing favorites per workspace was rejected: replaying one setup across projects is the feature; per-workspace files would make every favorite a copy.
- Filtering the shared enabled-suite snapshot for every face was rejected (and is what the surface-switch note already warns about): it would unmount sibling surfaces' mounts. Only the market face filters the snapshot, because its rows are suites.
- Widening the shared Translate union to carry the resource keys was rejected: it breaks existing zh[key] identity translations in committed tests; the merge is a property of the registered dictionary, asserted at the one wiring site.

## Risks

- The composer entry replaces the six-pill ComposerSurfaceToggles; users who flipped surfaces from the composer now do it from the window's rows and favorites. The six-way state itself is unchanged and still live-reconciling.
- Favorite entry ids are name-based (suite/source ids, server names, panel entry names); renaming an entry invalidates a favorite's reference to it, which degrades to the entry staying on rather than an error.
