# Agent Note: The project resource window reuses host primitives and the surface-toggle state pattern

Status: implemented · Date: 2026-10-04

## Problem

The finalized prototype (docs/scratch/prototypes/surface-filter-entry, commit 2b0f839) asks for one composer-entry window that lists this workspace's installed resources across six faces, filters individual entries per project, and stores complete switch snapshots as cross-project favorites — with zero custom visual language.

## Decision

- **Every control is a host primitive.** The window rides Modal (dialog chrome, Escape, mask, close button), SegmentedTabs (six face tabs; SegmentedTabs — unlike SegmentedControl — takes a ReactNode label, so each label carries the face word plus a small count span), Input (search, leading IconSearchOutlineMedium), Switch (row toggles), Pill (favorite chips), Tag (provenance), and Toast (apply/save/delete feedback). The card/list switch is a two-segment aria-pressed icon group styled after the prototype's .segc: SegmentedControl's string labels cannot carry icons, and the group semantics (pressed/not pressed) is not tablist semantics. The composer entry is a 2×2 grid of filled rounded cells with a filter dot, drawn inline like the prototype's .plugin-entry (currentColor, no chrome); no primitives export a grid glyph, and the prototype's unstyled `<span class="plus">` residue is not part of the finalized visual.
- **Rows ride the shared ResourceCard anatomy, not a lookalike.** The list container is a ResourceCollection (grid view = the window's card stack, list view = compact rows) inside a size container, and each row fills the anatomy's areas (rowId/rowActions/rowBody/rowFoot) with the card itself toggling the entry — the same chrome, hover behavior, and narrow-branch container queries the market and MCP cards get for free. The 3px state rail paints enabled versus filtered, so no state word repeats it.
- **State extends the surface-toggles pattern instead of forking it.** Entry filters live in the same per-workspace document (hashed path key) as a v2 entries section that the v1 writer preserves on a single-surface flip; favorites live in one global data-root file because their value is replaying a setup in another workspace. Runtime gates follow the surface-switch shape: each mount contributor answers the deny set where it computes its wanted rows, keeping faces orthogonal; a market-face deny is the one deliberate snapshot filter because its row IS the suite.
- **One aggregation, no second scan.** The inventory route composes overview() + panel stores + mcpStatus() + lspStatus() into the window payload; a favorite's active state is derived by exact snapshot match, so any manual flip leaves the workspace custom.
- **Dictionary isolation.** The window's zh/en keys ship in locales-resources.ts and merge into the one namespace at registration, so the main locales.ts (held by a parallel work stream) stays untouched; Translate stays keyed to the main dictionary and the merged-dict fact is asserted once at the slot wiring.

## Alternatives considered

- A bespoke window component set was rejected: the host primitives already implement the exact anatomy (tablist semantics, controlled switches, portal toasts), and the repo's style rules forbid a second visual language.
- Pixel-first entry placement was rejected as unreachable: the host InputBar renders its native plus button, the permission/plan slots, and then conversation.input.left last, so the entry is the first plugin control in the left cluster but can never precede the host's own buttons without a DOM hack.
- Window-module row classes were rejected after the first implementation round proved them inert: CSS-module class names hash per file, so a window-module .rowId never matches the anatomy's rules — only importing the resource-card module (rc.*) over the shared ResourceCollection activates the shared view behavior.
- Storing favorites per workspace was rejected: replaying one setup across projects is the feature; per-workspace files would make every favorite a copy.
- Filtering the shared enabled-suite snapshot for every face was rejected (and is what the surface-switch note already warns about): it would unmount sibling surfaces' mounts. Only the market face filters the snapshot, because its rows are suites.
- Widening the shared Translate union to carry the resource keys was rejected: it breaks existing zh[key] identity translations in committed tests; the merge is a property of the registered dictionary, asserted at the one wiring site.

## Risks

- The composer entry replaces the six-pill ComposerSurfaceToggles; users who flipped surfaces from the composer now do it from the window's rows and favorites. The six-way state itself is unchanged and still live-reconciling.
- Favorite entry ids are name-based (suite/source ids, server names, panel entry names); renaming an entry invalidates a favorite's reference to it, which degrades to the entry staying on rather than an error.
