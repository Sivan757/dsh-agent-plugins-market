# Agent Note: an overview grid balances its own columns

Status: implemented

## Problem

Every detail dialog draws its facts in one grid whose column count comes from the panel's width. With four columns a five-fact dialog put four facts on one row and the fifth alone under the first column, a six-fact dialog read 4+2, a seven-fact one 4+3 — a ragged last row on the surface a reader opens to compare values.

## Decision

- **The grid picks its column count from the cell count.** Up to four cells it is one row; above that it divides by the smallest number of rows that keeps at most four columns: five cells become 3+2, six 3+3, seven 4+3, eight 4+4.
- **One component owns it.** `KvGrid` in `ui/DetailRows.tsx` renders the `dl` and sets the inline template, so the six places that drew `panelCss.kvGrid` by hand now pass cells and cannot drift: MCP, LSP, instructions, suites, hooks and the entry detail.
- **The stylesheet keeps the responsive floor.** `.kvGrid` still defines `auto-fit minmax(170px, 1fr)` for anything that renders the class directly; the inline template only replaces the column count, so a narrow panel still collapses.

## Alternatives considered

- **Force two columns everywhere.** Rejected: a three-fact dialog would waste half its width, and paths need room.
- **Let the last cell span the remaining columns.** Rejected: a full-width value under a row of four reads as a different kind of fact, which it is not.
- **Keep `auto-fit` and accept the ragged row.** Rejected: it is the surface where values are compared, and a lonely cell is exactly where the eye lands.

## Consequences

- Every detail dialog now ends on a full row.
- A new dialog gets the behaviour by rendering `KvGrid` instead of a bare `dl`.

## Verification

- Live in `market-dev`: the system-prompt detail's five facts lay out over two rows as 3+2 (measured: two distinct row tops for five cells in a 747px grid), where the same dialog previously drew 4+1.
- `packages/market-ui/test/mcp-status-render.test.ts`, `lsp-seam-render.test.ts` and `client-instructions-panel.test.ts` still pass against the new grid.
- The four typechecks, `check:refactor` and the full suite pass.
