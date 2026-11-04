# Unreferenced CSS classes

A class nothing references is invisible: the stylesheet still compiles into the client bundle, the build still passes, and the name reads as if some screen used it. `pnpm run check:css` (`scripts/check-css-classes.mjs`) maps each stylesheet's classes against the code that imports it and fails on any class that no importer names.

The analysis is deliberately conservative. A stylesheet is skipped entirely when any importer reaches it through a computed key, classes named only by `composes` count as used, and a class is reported only when it appears neither as `ident.name` nor as a quoted string in an importer.

## Why this ledger exists instead of a deletion

These ten are unreferenced by the code, and none has been removed. The reason is not doubt about the analysis: it is that removing a rule changes what a screen looks like, and no browser was available in the session that found them. A wrong deletion here is a style that disappears somewhere nobody looked, which is a worse outcome than a rule that stays.

Two groups, and the difference is evidence:

- `detailEmpty`, `inlineCheck`, `modalFooterGrow`, `modalFooterHint` and `pair` appear nowhere in the repository, not even as ordinary strings. Deleting them is a one-line change whenever a visual pass is possible.
- `detail`, `grid`, `list`, `row` and `rowActions` also occur as ordinary string values elsewhere (`'row'` as a layout mode, for example), so name-level evidence cannot separate a class use from a coincidence.

## When to add a row

Only while a removal waits on a visual pass. A row here is a promise to look again, never a way to leave a new class unreferenced: the gate fails a class that is not on this list.

## Ledger

| class | reason |
| ----- | ------ |
