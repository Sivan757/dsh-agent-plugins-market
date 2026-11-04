# Agent Note: source pills take the width of their ids

Status: implemented

## Problem

The market's source strip laid every pill in an equal-width grid cell. That looked tidy until the ids got long: `claude-code-plugins-plus-skills` and `claude-code-workflows` both ellipsized to `claude-code-plugi…` at 118px, and a reader picking a source had to hover each chip to tell them apart. The widths also wasted the space the short ids did not use.

## Decision

- **A pill is as wide as its label, up to a cap.** `.sourceTabsRow` wraps flex items that size to their content, each capped at 220px (the cap the one-line favourites variant already used), past which the label ellipsizes instead of stretching a row.
- **The fold still owns the height.** Two rows stay 52px whatever the labels say, and the fade, the overlay expansion, the picked-source ordering and the post-pick collapse are unchanged: only the track sizing moved.
- **The ids read at the width they need.** On the profile that motivated this, the longest chip now takes 207px and reads in full, and the strip shows more sources in the same two rows than the equal-width grid did.

## Supersession

This partially supersedes [the equal-width pill grid](../feature/2026-09-08-source-strip-fold.md): its fold, overlay, fade and post-pick rules all still hold, and only its first decision (equal-width tracks with a fixed 118px floor) is replaced. The fold was never the reason for equal widths; it was the height problem that note solved, and the fold keeps solving it.

## Alternatives considered

- **Raise the minimum cell width.** Rejected: 160px still truncates a 31-character id, and the wider floor fits fewer chips per row than natural widths do.
- **A horizontal scroller with fixed-width chips.** Rejected: it hides sources the fold currently shows, and the strip already had a scroller variant for the favourites row where that tradeoff is different.
- **Keep equal widths and show the full id only on hover.** Rejected: the reader has to hover every chip to find one, which is the cost this change removes.

## Consequences

- Rows end ragged instead of flush; the fold's fade already hides the bottom one.
- A very long id ellipsizes at 220px rather than taking a whole row.
- The one-line favourites variant keeps its own sizing rules untouched.

## Verification

- `packages/market-ui/test/market-section-render.test.ts` pins the row as a wrapping flex line with the 220px cap and no 118px floor.
- In the `market-dev` profile against the built bundle: the strip renders `display: flex; flex-wrap: wrap`, the longest chip measures 207px and reads `claude-code-plugins-plus-skills 438`, and the two previously indistinguishable ids now differ on screen.
