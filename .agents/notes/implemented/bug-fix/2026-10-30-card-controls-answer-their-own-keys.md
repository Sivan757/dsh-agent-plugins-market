# Agent Note: the keyboard can reach the controls inside a card

Status: implemented

Superseded in part by [the card-region note](../feature/2026-10-30-card-is-a-region-with-one-opener.md): the card no longer handles keys at all, so the guard recorded below had nothing left to guard. The three naming decisions (switch names, filter label, view switch) still stand.

## Problem

An accessibility review of the shared list found that the card's own keyboard handling swallowed the controls inside it. `interactiveCardProps` gave the card `role="button"` plus a keydown handler that called `preventDefault()` and opened the entry on Enter or Space. The edit button and every icon action stopped the click and not the keydown, so pressing Enter on **编辑** bubbled to the card, had the button's own activation cancelled, and opened the detail instead of the editor: no keyboard user could edit or run an icon action on any surface.

The same review found three naming defects around the same cluster: every switch was named "启用/停用" with no row (`~971` indistinguishable switches), the filter tab strip took the search field's name as its accessible name ("搜索插件…"), and the view switch announced "切换到列表, 按下" — an action name beside a pressed state that described the opposite.

## Decision

- **A key event aimed at a control is that control's.** The card handler returned unless `event.target === event.currentTarget`, in `interactiveCardProps`, so every card, on every surface, got it once. The card is now a plain region with a name button and has no key handling to guard.
- **A switch names its verb and its row.** `toggleLabel + ' ' + name` ("停用 firebase"), which is the shape the edit button beside it already used.
- **The filter strip names itself.** `ResourceSurface` takes a `filterLabel` (defaulting to a new `按状态筛选` / "Filter by status" key) and no longer borrows the search field's label for the tablist.
- **The view switch states the action, not the mode.** `aria-pressed` is gone; the name continues to say where a click leads, and `data-view-switch` carries the mode for anything that needs it.

## Alternatives considered

- **Stop the keydown on each nested button.** Rejected: five call sites inside the renderer plus every future one, and the guard belongs where the card's handler is.
- **Keep `aria-pressed` and rename the switch to the mode ("Grid view").** Rejected: the same control must then mean two things depending on state, and the panels' dictionaries already carry action wording.
- **Name the switch by the row alone.** Rejected: "firebase" does not say what pressing it does; the verb is the part that changes state.

## Consequences

- Every icon action and the editor are reachable with Enter and Space again.
- A screen reader reading a switch hears which row it belongs to.
- The filter strip is announced as a filter, not as a search box.
- A surface that wants a different filter name can pass one; the default fits every current call site.

## Verification

- `packages/market-ui/test/resource-surface.test.ts` presses Enter on the edit button and asserts the detail did not open and the edit did, and asserts the switch's accessible name is "verb + entry".
- `packages/market-ui/test/filter-toolbar.test.ts` asserts the view switch has a name that says the action, no pressed state, and the mode in `data-view-switch`.
- The four typechecks, `check:refactor` and the full suite pass.
