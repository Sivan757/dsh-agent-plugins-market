# Agent Note: the MCP inventory renders through the one resource list

Status: implemented

## Problem

The MCP services panel still assembled its own toolbar, collection and inventory card, so the repository held three card implementations of one anatomy and the migration ratchet kept it on the list. Two costs came with it. The delete action sat on the card while the shared renderer's contract says destructive actions belong to the detail the card opens, and the panel's search and filter counts ran through a bespoke view model that the renderer would have to duplicate the moment the panel moved.

## Decision

- **The entry contract gains the fields an inventory needs.** `source` leads the source row as its provenance token, `monoBody` sets an endpoint or command in the mono face, `keywords` widen the search haystack to text the card does not render, `toggleLabel` names the switch by what it does, `canEdit` and `editDisabled` gate the editor per row, `chip` and `surface` carry the entries that wear a provenance chip and the layout that hides it, and a filter can carry a hint. None of them is surface-specific: each is a fact a list can state about one row.
- **The panel keeps only its domain work.** It maps status rows onto entries, then handles open, toggle and edit by id; the renderer owns the toolbar, the filters, the search, the view switch and the cards.
- **Deleting moves into the detail dialog.** The card's click means "open", the one irreversible action waits one step inside it, and the panel's existing confirmation still owns the confirm-and-re-read flow. This matches [the card rows note](2026-10-30-card-rows-and-the-switch-that-never-hides.md) and the two surfaces that already keep destruction inside the detail.
- **The superseded view model goes.** `deriveMcpStatusViewModel` lost its last caller; `matchesMcpFilter` stays because it is the one predicate the renderer counts tabs through, so a tab's number is still exactly the rows clicking it shows.
- **The ratchet shrinks.** `features/mcp/StatusPanel.tsx` leaves the single-renderer list, and the panel's dead toolbar and empty styles go with it.

## Alternatives considered

- **Add an `onDelete` capability to the shared renderer.** Rejected: it would let every surface put an irreversible action on a card, which is the contract this migration is meant to enforce.
- **Keep the card delete for MCP alone.** Rejected: one surface would keep the old grammar, and the panel could not then use the shared card at all.
- **Keep the view model for counts and search.** Rejected: two implementations of the same predicate drift, and the renderer already derives both from the entries it renders.
- **Migrate the user panel and the market page in the same change.** Rejected: each carries its own destructive and primary actions; one surface per change keeps the failing assertions attributable.

## Consequences

- Deleting a user-declared service now takes one more click: open the service, then delete.
- The narrow-grid chip rule keeps working through `chip` and `surface`, so the MCP card still drops its provenance tag where the source row already names the suite.
- The panel no longer keeps its own search or filter state; the renderer's view switch and filter tabs are the only ones.
- Two lists still assemble themselves: the settings user panels and the market page.

## Verification

- `packages/market-ui/test/mcp-status-render.test.ts` proves the delete now lives in the detail (and not on the card), the confirmation still removes and re-reads, a failure reports in the panel without dropping the row, and the editor and credentials paths are unchanged.
- `packages/market-bundle/test/integration/client-view-models.test.ts` proves the surviving filter predicate keeps switched-off rows reachable by scope and by the disabled tab.
- The preview harness renders MCP-shaped entries through the real renderer at 760px and 560px: mono endpoint on the body row, suite, tool count and transport on the source row, the reconnecting sentence on a warning rail, and the provenance chip hidden in the narrow grid.
- `check:css` and `check:single-renderer` are green with the migrated panel; the client, test-client and server projects typecheck clean.
