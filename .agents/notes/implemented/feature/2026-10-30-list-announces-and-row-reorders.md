# Agent Note: the list announces what it holds, and the row reorders from the keyboard

Status: implemented

## Problem

Two more findings from the accessibility review, both about a reader who cannot see the screen.

**A search or a filter changed the list silently.** Typing in the search field, pressing a status tab or growing the page replaced the collection with no live region: the counts live inside tab labels, and the empty state is a plain paragraph. A screen-reader user got no signal that their input had any effect.

**Reordering a row was pointer-only.** Dragging a tab (hold, then move) was the only way to change its position on the preset surface. The same component backs the workspace row, which already accepted Alt+Arrow through its own wrapper; a surface that only passed `onReorder` had no keyboard path at all (WCAG 2.1.1 and 2.5.7).

## Decision

- **The surface carries one polite status line.** `ResourceSurface` renders a visually hidden `role="status"` paragraph that says "N of M shown", where M is the matched set rather than the whole inventory: after a search it reads "1 of 1", and while paging it reads "120 of 971". The line is hidden visually because the tabs and the "show more" button already carry the same numbers on screen.
- **Alt+Arrow moves the tab itself, in the component.** `TabRail` handles Alt+Left/Right when `onReorder` is supplied, moves focus with the tab so a second press continues from there, and leaves plain arrows moving only the selection. Both surfaces that render the rail inherit the keys, so the two rows cannot drift apart again.

## Alternatives considered

- **Announce only when the result count changes.** Rejected: the reader also needs the total they are browsing, and a "1 of 1" after a search answers both questions at once.
- **Put the live region in each panel.** Rejected: six copies of the same sentence, and the shared list is what knows the numbers.
- **Let each surface wire its own key handler, as the workspace row does.** Rejected: that is exactly how one surface ended up without the keys while its neighbour had them.

## Consequences

- A screen-reader user hears the result count after searching, filtering, and growing the page.
- The preset manager's row can be reordered without a pointer, with the same gesture as the workspace row.
- The status paragraph exists on every surface, empty until the first change.

## Verification

- `packages/market-ui/test/resource-surface.test.ts` searches and asserts the status line reads "N of M" and is a polite live region.
- `packages/market-ui/test/tab-rail-drag.test.ts` presses Alt+Arrow and asserts the reorder callback fires, and that the same key without Alt moves only the selection.
- The four typechecks, `check:refactor` and the full suite pass.
