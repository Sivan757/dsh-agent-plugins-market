# Agent Note: the user content panels render through the one resource list

Status: implemented

## Problem

The skills, commands and persona panels share one component that still assembled its own toolbar, collection and card. That left one card anatomy with two implementations and put the delete action on the card while [the card rows note](../bug-fix/2026-10-30-card-rows-and-the-switch-that-never-hides.md) and the other surfaces keep destructive actions inside the detail. The generic `panelEditTitle` label also named no entry, so a screen reader heard the same button on every card, and the panel carried its own filter and search state beside the renderer's.

## Decision

- **The three panels map onto the shared entry contract.** A command's title is its flattened call name and its raw name rides the hint; `source` is the owning suite for a plugin file and the file's own path for a user-authored one; `keywords` carry the name, description, suite and path into search; `toggleLabel` says enable or disable; `canEdit` admits user entries and plugin personas (whose pencil edits routing only) and withholds plugin skills and commands; `editDisabled` follows the panel's busy state.
- **Deleting moves into the entry detail.** The panel keeps its confirmation and re-read, and the detail closes into that confirmation so the outcome is never hidden behind a dialog that already ran its action.
- **The renderer names the pencil.** Its accessible name is `panelEdit <entry>`, so the nine assertions that required the generic label now match by prefix and a reader can tell the buttons apart.
- **The view switch keeps the panel's own words.** The renderer accepts `toListLabel` and `toGridLabel`, so both the MCP panel and these panels keep the copy they shipped instead of borrowing the renderer's defaults.

## Alternatives considered

- **Keep the card delete for these panels.** Rejected: the card's click means "open", and two surfaces would then keep the older grammar the last two migrations removed.
- **Keep the generic edit label.** Rejected: a repeated accessible name across a grid of entries is worse than a per-entry one, and the renderer already names the row it edits.
- **Give each kind its own entry builder.** Rejected: the three kinds differ only in the title (commands), the edit gate (personas) and the copy; one mapping with three inputs stays one implementation.

## Consequences

- Deleting a user-authored entry now takes one more click: open the entry, then delete.
- The filter tabs, the search and the view switch belong to the renderer, so the panel no longer keeps that state or its own empty line.
- One list still assembles itself: the market page.

## Verification

- `packages/market-ui/test/user-panel-surface.test.ts` proves the three kinds keep their switches and editors, plugin skills and commands carry no pencil, plugin personas open the routing-only editor, and the delete appears only inside a user entry's detail.
- `packages/market-bundle/test/integration/user-panel-cache.test.ts` proves the editor's own save still lands in the row cache under the new accessible name.
- `check:single-renderer` now reports one remaining list; `check:css` is green with the panel's own toolbar and empty styles gone.
