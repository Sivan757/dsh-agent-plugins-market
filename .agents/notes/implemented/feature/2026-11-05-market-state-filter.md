# Agent Note: the market filters by enabled and disabled

Status: implemented

## Problem

The market listed every suite and offered no way to narrow the list to the suites that are switched on or to the ones that are switched off. A reader with a hundred sources had to read every row's state word to find the handful they wanted.

[One filter, and both surfaces draw it from one table](2026-11-03-one-filter-both-surfaces-draw-it.md) drew the provider facet and removed the state cuts, because a card's rail and its state word already say what a suite's state is. That reason holds for every face except the market: here the reader is not asking about one row, they are asking which rows to work through.

## Decision

- **The market's state cuts live in the shared facet table.** `ui/surface-facets.ts` declares, per workspace tab, the state words beside the provider words, and exports one entry point both surfaces call: `surfaceCuts(key, t, providerOf)`, the provider cuts first and the state cuts after, in a stable order.
- **A state cut matches the entry's state.** `active` is the enabled cut (已启用 / enabled), `disabled` is the disabled cut (已停用 / disabled). A suite that is listed but not installed is `absent` and belongs to neither cut: it stays visible under 全部, and the cut narrows the list to what is installed and switched either way.
- **The table grew one entry point, and the preset manager calls it.** `surfaceCuts(key, t, providerOf)` is the union of the provider cuts and the state cuts, and it is what both surfaces call: the preset manager's market face and the market page. `surfaceProviderCuts` stays as the provider-only builder the other panels use, so their cuts are unchanged. Because both surfaces call one function over one table, they cannot disagree about what a filter is.

This note supersedes one clause of [one filter, and both surfaces draw it from one table](2026-11-03-one-filter-both-surfaces-draw-it.md): "State cuts are gone" no longer holds for the market. That note's other clauses still hold: the provider facet (who provides the row), one table in one module, and the rule that the two surfaces must not disagree about what a filter is. The one fact that moved is the entry point: the table grew `surfaceCuts`, and the preset manager now calls it where it used to call `surfaceProviderCuts`. Every other face keeps its provider cuts and draws no state cut.

## Alternatives considered

- **Give every face a state cut.** Rejected: this is the uniform cut that note rejected, and the owner asked for the market's filter, not for one everywhere.
- **Let the market page build its own cuts.** Rejected: the two surfaces would then disagree about what a filter is, which is what the shared table exists to prevent.
- **Add new locale words for the market.** Rejected: the cards already say 已启用 / 已停用 through `enabledLabel` and `disabledLabel`, and a cut must use the same words the row uses.
- **Add a third cut for the installed state.** Rejected: an uninstalled suite is `absent`, and the reader who wants those asks for them by name. A third cut would answer a question the market's own counts already answer.

## Consequences

- The market's toolbar carries 全部 / 已启用 / 已停用, and the preset manager's market face carries the same three.
- "One provider means no facet" survives only as a rule about provider cuts: a face with one provider and two states now draws a facet.

## Verification

- `packages/market-ui/test/surface-facets.test.ts` pins the table: the market's two state cuts in one order, the state each cut matches, a row with no state of its own, and every other face left on its provider cuts alone.
