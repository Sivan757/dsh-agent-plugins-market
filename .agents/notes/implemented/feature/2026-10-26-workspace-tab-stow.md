# Agent Note: Stowing workspace tabs

Status: implemented

## Problem

The plugin workspace renders every surface it owns as one tab: market, skills, commands, personas, MCP, LSP and hooks, with more surfaces arriving. A user who works in two of them pays for the other five on every visit, and the row had no way to say so. The tab row is also the one control the host owns end to end: `SegmentedTabs` owns the roving tab stop, the Left/Right/Home/End walk and the sliding indicator, so anything added there had to leave that contract intact.

## Decision

### One trailing control, outside the tab list

`packages/market-ui/src/ui/ResourceTabs.tsx` gained one optional `trailing` slot, rendered as a sibling of the `role="tablist"` element inside the row wrapper. The slot is generic because the row is shared: the preset manager passes none and renders exactly what it did before.

`packages/market-ui/src/workspace/TabStowControl.tsx` fills the slot with a host `Button`, a count badge, and a host `Menu` anchored to it. The menu lists the stowed tabs first, then a separator, then the manage row. The manage row renders even with nothing stowed, so the entry point never disappears.

The manage dialog is the host `Modal` with one host `Checkbox` per tab in display order, a short hint on each row, and a `Show all` footer action. The control that would leave the row empty is disabled with the same hint stated as text, so the reason is readable and not only a tooltip.

The row policy stays in the CSS module: the row is a nowrap flex line, the tabs take the remaining width and shrink first, and the trailing control keeps its size, which keeps the existing ellipsis behavior and introduces no sideways scroll.

### Which tabs a row renders

`rowTabs` in `PluginWorkspace.tsx` is `visibleTabs(TAB_ORDER, layout, active)`: every tab that is not stowed, plus the active tab even when it is stowed. The second half is what keeps a hash deep link working for a stowed tab. The reveal is derived from the layout and the selection on every render and is never written back, so following a link cannot change the saved layout.

The row is built from `TAB_ORDER`, and `TAB_ORDER` is `WORKSPACE_TAB_KEYS` itself rather than a copy, so one list owns the tab set. That list is the contract's, because it is also what the server validates a stow request against. `WorkspaceTab` is an alias of `WorkspaceTabKey` for the same reason.

Adding a tab therefore means three things, each of which fails to compile until it is done: the key in `WORKSPACE_TAB_KEYS`, the paired label in both locale dictionaries, and the panel case in `renderTab`, whose closed union ends in an exhaustiveness check. Nothing else changes: `TAB_ORDER`, the stow menu, the manager, the routes and the store all read that one list.

Stowing the active tab moves the selection to the first tab that is not stowed. That computation reads the stow list alone rather than the row, so it does not depend on which tab is pinned or where the pinned tab sits in the order.

### Persistence, per workspace

`packages/market-runtime/src/application/state/tab-layout.ts` owns `tab-layout/<sha256(workspace).slice(0,24)>.json` under the plugin data root. The document is `{ version: 1, workspace, hidden: string[] }`, written through `writeJsonDocument` and read-modified-written under `withFileLock`, which is the same shape as the surface-toggle policy beside it.

It is a separate document and a separate owner on purpose. `workspace-policy.ts` already has one writer, and a second writer sharing the file would clobber whichever mutation lost the race.

`TabLayoutService` is the runtime owner: it serializes mutations on a tail promise, publishes only what persistence committed, and hands out a detached snapshot from `currentLayout()`.

### The clamp lives in the shared contract

`packages/market-contracts/src/contracts/tab-layout.ts` is imported by both sides, so one function decides what a stow list is:

- `resolveHiddenTabs` drops unknown keys, non-strings, duplicates and the pinned `market` tab, and returns the survivors in display order so one layout always writes the same bytes.
- The pinned `market` tab is the clamp: it is never stowed, so the row always has a tab and no file and no request can empty it.
- `visibleTabs` holds the reveal rule in one place, so the optimistic client row and the persisted layout agree.

The route refuses rather than corrects what a caller asked for: an unknown key and the pinned key are both 400s with the reason, while stowing every other tab is legal because the pinned tab remains.

### Failure behavior

The layout is read once on mount. A failed read leaves every tab visible and states the reason inside the manage dialog, so a broken layout file cannot block the workspace. A stow is optimistic: the row paints first, the write follows, and a failed write restores the last confirmed layout and says why in the same dialog.

`loadTabLayout` treats unparsable text as nothing stowed rather than as a failure, because a corrupt document must let the workspace open and be replaced by the next write. Every other read failure still throws, since a permission problem must surface.

## Alternatives considered

- **A per-tab context menu, where right-clicking a tab stows it,** was rejected on three counts. It is not discoverable: nothing tells a user that a tab can be right-clicked, and the one user who needs it most is the one who has already given up on the row. It leaves nowhere to restore from: once a tab is stowed its own context menu is gone with it, so the way back would have to be invented somewhere else anyway. And it puts a second interactive element inside the tab strip, where the host owns the walk and the selection, so the row would stop being a pure tab list. The single trailing menu answers all three: it is visible without knowing anything, it lists every stowed tab as the one place to restore from, and it leaves the tablist untouched.
- **Drag to reorder, with stowing as the drag endpoint** was rejected because the host tab row has no drag affordance and adding one would replace the sliding indicator and the walk keys with a second interaction model. Order is also not a problem the owner reported: the cost of a long row is attention, not sequence.
- **A switch in the settings card only, listing every tab as a boolean** was rejected because it moves a per-visit decision to a page the user visits twice. The row is where the cost is paid, so the control belongs beside it, and the settings card already carries the switches that are genuinely global.
- **Hiding every stowed tab unconditionally, including the active one** was rejected because a hash link to a stowed tab would then select nothing visible, or worse, render a panel whose tab the row does not show. The reveal keeps the invariant and costs one clause.
- **Storing the layout inside the existing surface-toggle document** was rejected for the reason above: one owner per document, or two writers lose each other's changes.
- **Storing the layout per profile rather than per workspace** was rejected because the dimension is the same one the surface toggles already use. A tab worth stowing in one project is often worth keeping in another.

## Consequences

A workspace can now hold a tab row sized to the work it does, and every tab stays one menu away. The trade-offs:

- A stowed tab is one interaction further away than a visible one. That is the point of stowing, but it means the menu must stay discoverable, which is why the trigger is always rendered and badged with the count.
- The store is a second file per workspace under the plugin data root, beside the surface-toggle document.
- The tab key set now has a second home on the server, in `WORKSPACE_TAB_KEYS`. A tab added to `TAB_ORDER` alone would stow to a key the server drops, so a drift assertion in the client test fails when the two disagree.
- A stow is optimistic, so a failed write is visible as a row that moves back. The dialog explains it, and the alternative, waiting on a local file write, made the click feel late.

## Verification

`packages/market-ui/test/client-workspace-tab-stow.test.ts` drives the real workspace and the real fetch helpers against a stub server for both routes:

- `TAB_ORDER` is the contract's own array, and every tab in it renders a chip and opens its own panel,
- stowing removes the chip, adds the menu row, keeps display order and reaches the server,
- choosing a stowed tab from the menu selects it and renders its panel without writing,
- stowing the active tab moves the selection to the first visible tab,
- the last visible tab's control is disabled and says why,
- a document naming every tab still leaves the pinned tab in the row,
- a deep link to a stowed tab selects it, renders its chip and leaves the stored layout alone,
- `Show all` restores every tab,
- a failed write reverts the row and reports in the dialog,
- a failed read leaves every tab visible and reports in the dialog.

`packages/market-bundle/test/integration/tab-layout-service.test.ts` covers the store and the service: round trip, one hashed file per workspace, six kinds of unusable document, unknown keys and the pinned tab dropped, display-order output, every-tab documents clamped by the pinned tab, three concurrent mutations serialized, detached snapshots, reload, show-all, a failed write leaving the published layout alone, and a workspace-less service keeping its layout in memory.

`packages/market-bundle/test/integration/tab-layout-routes.test.ts` covers the transport: the two constants registered and released together, a served layout and a committed one, an unknown key rejected, the pinned key rejected, every other tab accepted, a non-array body rejected, a cross-origin write rejected, and an unreadable body rejected.
