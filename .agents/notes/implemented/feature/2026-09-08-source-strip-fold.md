# Agent Note: Equal-width source pill grid that unfolds as an overlay

Status: implemented

## Problem

The market header listed every source as a pill in a wrapping grid (`repeat(auto-fill, minmax(118px, 1fr))`). With 20 registered sources the strip grew to six rows (~164px) and, together with the unmanaged-checkout row and the toolbar gaps, consumed ~208px of fixed header height — `.header` is `flex-shrink: 0`, so the card grid paid for it. Those pills also carried an `已收编` badge for adopted checkouts, naming an implementation detail (a `.sources/<id>` directory registered in place) as if it were a user-facing state, while the leading `全部 754` chip repeated the toolbar's `全部 754` scope on the same screen.

## Decision

- **The strip stays an equal-width pill grid.** `.sourceTabsRow` keeps `repeat(auto-fill, minmax(118px, 1fr))`, so every pill in a row has the same width and a long id ellipsizes instead of stretching its column. Chips remain pills; the grid — not a dropdown, not a horizontal scroller — carries them.
- **The grid folds to two rows, and the fold hints at itself with a bottom fade.** `.sourceTabsBoxFold` reserves 52px (two 24px pills plus the 4px gap); the grid is lifted out of the flow with `inset: -6px -6px auto`, `max-height: 64px` (52px of content plus 6px overlay padding) and `overflow: hidden`, and a `mask-image` gradient fades the last visible row.
- **Hover or keyboard focus expands the same grid as an overlay.** `.sourceTabsBoxFold:hover .sourceTabsRow` and `.sourceTabsBoxFold:has(:focus-visible) .sourceTabsRow` raise `max-height`, add a ring/shadow and drop the mask, so the strip grows over the toolbar and cards without reflowing anything below it. Expansion is pure CSS; there is no toggle control, no dropdown and no extra row of chrome. The focus half is `:focus-visible`, never plain `:focus-within`: a mouse click leaves the picked chip focused, and plain focus would reopen the strip by itself once the post-pick suppression expired.
- **Picking a source folds the strip again immediately.** The pill's select handler sets `picked`, which keeps the grid at the folded height while the pointer is still inside. Clearing it waits out a 300ms `LEAVE_GRACE_MS` after `onMouseLeave`, because the fold itself can sweep the pointer out of the box — without the grace, the next pointer move reopens the strip. Focus leaving the strip (`onBlur` with a `relatedTarget` check) clears it at once.
- **Chips read `全部` first, then the picked source, then the rest by id.** The picked source moves next to `全部` so the folded strip still shows the active scope with its `✎` control; the other chips keep their id order.
- **The selected pill uses the harness primary color.** `.srcTabOn` fills with `--dsw-alias-brand-primary` and labels with `--dsw-alias-label-primary-foreground` — the same pair the harness's primary Button and the toggle switch's ON track use (near-black on light, near-white on dark). The earlier soft business tint (`state-business-tertiary`) was tried and dropped: the highlight should read as the harness's primary surface, not as a tinted chip.
- **`SourceTabsRow` only decides whether folding applies.** It compares the grid's `scrollHeight` with the folded height (52px + 6px top padding) — `scrollHeight` reports the full content height even while clipped, and does not change when the overlay opens, so the fold state stays stable under the pointer. A strip that fits two rows keeps the plain in-flow grid and no fade.
- **The pill owns the label's horizontal padding.** `.srcTab`/`.srcTabOn` carry `padding: 0 10px` and `.srcTabMain` drops its own padding, so the label keeps the same 10px gap on both sides whether or not the trailing `✎`/`×` controls are present; those controls only add a 4px lead-in.
- **No adoption badge.** Chips carry only `本地` / `压缩包`; an adopted checkout is storage the manager happens to own, not a state the user chooses between. `sourceAdopted` is gone from both dictionaries.
- **The unmanaged banner is cleared by resolving the directories, not by ignoring them.** `unmanagedSources()` lists only directories that exist under `.sources/` and are absent from `state.json`, so deleting or adopting them removes the row; an `ignore` action remains unimplemented.

## Alternatives considered

- **A `+N` overflow menu on a single row** — implemented first and rejected: a dropdown hides sources behind an extra interaction and the requirement was uniform equal-width pills that stay on the page.
- **Two rows plus an explicit `展开全部` / `收起` toggle** — implemented next and rejected as well: the toggle costs a row of its own, only 8 of 21 sources stay visible, and expanding pushes the card grid down.
- **A horizontally scrolling single row** — keeps every pill, but horizontal scrolling in a settings header is worse than wrapping, and hidden pills are as unreachable as a menu.
- **An inner vertical scroller (`max-height` + `overflow-y: auto`)** — rejected earlier in [the workspace-tabs note](2026-09-06-workspace-tabs-user-panels.md) for nested-scroll jitter; adding one inside the header would replay that.
- **Folding by rendering only the first N chips** — N depends on the responsive column count, so it needs per-chip measurement; clipping the grid at a row boundary costs nothing and cannot clip a pill in half.
- **Keeping the `已收编` badge** — it answers a question only the implementation asks, and the deletion semantics it implied were documented wrongly anyway.

## Consequences

- Folded, the strip is a constant 52px with no extra chrome; expanded, it overlays the toolbar and cards, so the card grid keeps its position in every state.
- The overlay covers the toolbar while open. That is deliberate — the pointer is already inside the strip — but it means a click on the search box requires leaving the strip first.
- Sources below the fold are clipped, not removed: they stay in the DOM for screen readers and keyboard focus, and focusing a pill expands the overlay.
- Because the picked source is moved next to `全部` and the strip folds on pick, the active scope stays visible while the rest of the list stays put; the toolbar's counts and the filtered cards confirm the change.
- A source list that fits two rows keeps the plain in-flow grid with no fade and no overlay, so short lists pay nothing for this.
- This change also corrects the stale "adopted directories are protected from deletion" claim in README, the usage guide, the site FAQ, the `removeSource` JSDoc, and two Agent Notes: `removeSource(id, deleteCheckout)` removes any `.sources/<id>` checkout, adopted included, and only a `local` source pointing outside `.sources/` is protected.

## Verification

- `tests/market-section-render.test.ts` pins that an adopted source renders as an ordinary chip, that no adoption badge is rendered, that a strip which cannot be measured (jsdom) keeps every chip unfolded, and that picking a source moves it next to `全部` while the rest stay in id order.
- `pnpm run check:refactor` and `pnpm run test`.

## Related

- Extends the source vocabulary of [2026-09-01-source-acquisition-expansion](2026-09-01-source-acquisition-expansion.md) without changing its adoption semantics.
- Keeps the card-side affordances of [2026-09-02-market-card-platform-affordances](2026-09-02-market-card-platform-affordances.md) intact; only the header strip changed.
