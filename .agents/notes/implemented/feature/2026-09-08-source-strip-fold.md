# Agent Note: Equal-width source pill grid that folds in place

Status: implemented

## Problem

The market header listed every source as a pill in a wrapping grid (`repeat(auto-fill, minmax(118px, 1fr))`). With 20 registered sources the strip grew to six rows (~164px) and, together with the unmanaged-checkout row and the toolbar gaps, consumed ~208px of fixed header height — `.header` is `flex-shrink: 0`, so the card grid paid for it. Those pills also carried an `已收编` badge for adopted checkouts, naming an implementation detail (a `.sources/<id>` directory registered in place) as if it were a user-facing state, while the leading `全部 754` chip repeated the toolbar's `全部 754` scope on the same screen.

## Decision

- **The strip stays an equal-width pill grid.** `.sourceTabsRow` keeps `repeat(auto-fill, minmax(118px, 1fr))`, so every pill in a row has the same width and a long id ellipsizes instead of stretching its column. Chips remain pills; the grid — not a dropdown, not a horizontal scroller — carries them.
- **The grid folds to two rows and expands in place.** `.sourceTabsRowFold` caps it at `max-height: 52px` with `overflow: hidden` (two 24px pills plus the 4px gap), and a right-aligned text toggle below it (`展开全部` / `收起`, `.sourceFoldToggle`) removes the cap. `SourceTabsRow` decides whether the toggle is needed by comparing the grid's `scrollHeight` with the folded height, so no per-chip measurement is involved and a grid that fits two rows renders no toggle at all.
- **The selected source is always visible.** `MarketSection` orders chips `全部` first, the selected source second, then the rest by id. Folding therefore never hides the active scope or its edit and delete controls.
- **The pill owns the label's horizontal padding.** `.srcTab`/`.srcTabOn` carry `padding: 0 10px` and `.srcTabMain` drops its own padding, so the label keeps the same 10px gap on both sides whether or not the trailing `✎`/`×` controls are present; those controls only add a 4px lead-in.
- **No adoption badge.** Chips carry only `本地` / `压缩包`; an adopted checkout is storage the manager happens to own, not a state the user chooses between. `sourceAdopted` is gone from both dictionaries.
- **The unmanaged banner is cleared by resolving the directories, not by ignoring them.** `unmanagedSources()` lists only directories that exist under `.sources/` and are absent from `state.json`, so deleting or adopting them removes the row; an `ignore` action remains unimplemented.

## Alternatives considered

- **A `+N` overflow menu on a single row** — implemented first and rejected: a dropdown hides sources behind an extra interaction, and the requirement was uniform equal-width pills that stay on the page.
- **A horizontally scrolling single row** — keeps every pill, but horizontal scrolling in a settings header is worse than wrapping, and hidden pills are as unreachable as a menu.
- **An inner vertical scroller (`max-height` + `overflow-y: auto`)** — rejected earlier in [the workspace-tabs note](2026-09-06-workspace-tabs-user-panels.md) for nested-scroll jitter; adding one inside the header would replay that.
- **Folding by rendering only the first N chips** — N depends on the responsive column count, so it needs per-chip measurement; clipping the grid at a row boundary costs nothing and cannot clip a pill in half.
- **Keeping the `已收编` badge** — it answers a question only the implementation asks, and the deletion semantics it implied were documented wrongly anyway.

## Consequences

- Folded, the strip is 52px plus a ~18px toggle row; expanded, it returns to the natural grid height, so the card grid keeps the space in the common case.
- The toggle appears only when the grid needs more than two rows, which keeps a short source list free of dead chrome.
- `全部` in the strip and `全部` in the toolbar still read identically when no source is selected; only chip order changed, since the selected source now moves to second place.
- This change also corrects the stale "adopted directories are protected from deletion" claim in README, the usage guide, the site FAQ, the `removeSource` JSDoc, and two Agent Notes: `removeSource(id, deleteCheckout)` removes any `.sources/<id>` checkout, adopted included, and only a `local` source pointing outside `.sources/` is protected.

## Verification

- `tests/market-section-render.test.ts` pins that an adopted source renders as an ordinary chip, that no adoption badge is rendered, and that a strip which cannot be measured (jsdom) keeps every chip and no toggle.
- `pnpm run check:refactor` and `pnpm run test`.

## Related

- Extends the source vocabulary of [2026-09-01-source-acquisition-expansion](2026-09-01-source-acquisition-expansion.md) without changing its adoption semantics.
- Keeps the card-side affordances of [2026-09-02-market-card-platform-affordances](2026-09-02-market-card-platform-affordances.md) intact; only the header strip changed.
