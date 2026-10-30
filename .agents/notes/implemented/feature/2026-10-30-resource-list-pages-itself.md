# Agent Note: the resource collection pages itself

Status: implemented

## Problem

The market page opens on the reader's whole inventory. One real profile carries 1,000 suites, 971 of them not installed, and the shared renderer mounted every card at once: opening the section measured 306ms to the first cards and left 16,000 nodes in the document. That cost is paid on every open, grows with every source the reader adds, and makes every later filter re-render a thousand cards.

## Decision

- **One page of cards at a time, in the renderer.** `ResourceSurface` renders `RESOURCE_PAGE_SIZE` (120) entries and appends the next page when a sentinel at the end of the collection comes into view. Because the list is shared, every surface gets the same rule without asking for it.
- **A button carries the same action.** The sentinel is a "show N more" button: it works without `IntersectionObserver`, it is the visible affordance rather than an invisible trigger, and it is what a keyboard or screen-reader reader activates.
- **Filtering and search run over the whole set, before paging.** The tab counts stay the counts of what the filter matches, and a search that matches an entry past the first page still finds it; only the rendering is paged.
- **A filter or a search starts over at the first page.** Keeping the page would drop the reader into the middle of a set they never scrolled.

## Alternatives considered

- **Virtualize the grid.** Rejected for now: variable-height cards, two view modes and a shared renderer make measurement and focus handling a much larger change; paging removes the measured cost with a fifth of the code.
- **Raise the page size until the number looked right.** Rejected: any fixed number is wrong on one machine and right on another; 120 keeps an open under one frame on the profile that motivated this and still fills a large viewport.
- **Page in the market page only.** Rejected: the cost belongs to the shared list, and a per-surface pagination would be the second implementation the renderer exists to prevent.

## Consequences

- A reader who wants the 900th suite scrolls or presses "show more" instead of it already being mounted; the tab count still tells them the set's size.
- The DOM stays proportional to what the reader has looked at, not to their inventory.
- The page size is a constant one place: changing it changes every surface together.

## Verification

- `packages/market-ui/test/resource-surface-paging.test.ts` pins the page size, the reveal, that a search reaches an entry past the first page, and that a search starts over at page one.
- The `market-dev` profile against the built bundle, same profile and same 1,000-suite inventory: first cards went from 306ms to 55ms and the document from 16,046 nodes to 2,498; scrolling to the end grew the list 120 to 240 with the button reading "再多显示 120 个".
