# Agent Note: the collection reads as a list of a known size

Status: implemented

## Problem

Two gaps left by the accessibility review, both about what a surface says rather than how it looks.

**The collection had no list semantics.** It was a plain region of `<article>` cards with no `role="list"`, no size and no position. Because the surface pages itself, the DOM alone cannot tell a reader whether they are in a list of five or of a thousand, or where the card they are on sits.

**Only three surfaces said their state in words.** The card's state is a 3px rail, so the words matter; the market, the connector list and the language-engine list supplied them, while the skill/command/persona lists, the hook list and the preset manager still left the rail as the only statement of state.

## Decision

- **The collection is a list, and its size is the matched set.** `ResourceCollection` carries `role="list"`, each card is a `listitem`, and the surface passes `aria-posinset` and `aria-setsize` from the matched set rather than from the rendered page: 150 matches show "1 of 150" while 120 cards are mounted, and a search that narrows to one shows "1 of 1".
- **Every surface that paints a state says it too.** The user panels (skills, commands, personas), the hook list and the preset manager now supply `stateLabel` from the keys their own tabs and details already use (已启用, 已停用, 受限, 可运行, 不可用). A surface with no state to state (the instructions list, whose rows carry a visible status tag) supplies nothing.
- **The rail stays the visual cue.** The words are rendered for assistive technology only; nothing about the card's look changes.

## Alternatives considered

- **Rely on the rendered order and skip `aria-setsize`.** Rejected: with self-paging the rendered order is a prefix of the set, so the last mounted card would claim to be the last item.
- **Give the status line the position instead of the cards.** Rejected: the reader learns position when they land on a card, which is later than the status line's announcement.
- **Add a visible state chip so no hidden text is needed.** Rejected: the rail is the designed cue and a chip on 971 uninstalled cards is noise; a hidden word serves the reader who needs it without repainting the surface.

## Consequences

- A screen reader hears the list's size and each card's place in it, after a search, a filter or a page growth.
- Every surface's card state is reachable without seeing colour.
- The words are the surfaces' own, so a state is never mislabelled by a shared default.

## Verification

- `packages/market-ui/test/resource-surface-paging.test.ts` mounts 150 entries, asserts the collection is a list, the first card is item 1 of 150, and the last mounted card is item 120 of the same set.
- `packages/market-ui/test/resource-surface.test.ts` and `resource-surface-parity.test.ts` pin the card's `listitem` role and its hidden state word.
- The four typechecks, `check:refactor` and the full suite pass.
