# Agent Note: the card rows are components, and the switch never hides

Status: implemented

## Problem

The merged resource renderer assembled each card from slot classes alone. `CardIdentity` drew its own row, but the description, the counts, and the source line were emitted as bare `p` and `span` elements without a grid area. A grid rejects nothing: it auto-places an unplaced child into the first free cell, which is the action column of a card that has no actions. In the preset dialog at 760px the description therefore sat in the action column beside the name, the title was clipped to its first letter, and the switch painted over the description; the counts and the source line landed in the body cells. The same card drew correctly only where the container was narrow enough for the single-column branch, which is why the defect read as surface-specific.

Two more defects sat in the same area. The surface column had no bounded height, so the preset dialog clipped its last row instead of scrolling it. And in the narrow branch the whole action cluster, the enable switch included, left the flow and faded in on hover, so at rest a reader could not tell whether an entry was on.

## Decision

- **Rows are components.** `CardBody`, `CardFoot`, and `CardActions` join `CardIdentity` in `ui/ResourceCard.tsx`, each emitting its area class and a `data-card-row` marker. A surface names a row instead of trusting a string class, and a test can assert the anatomy.
- **One anatomy at every width.** Identity row, two-line body, source row, action cluster. The narrow branch keeps the wide branch's `'id act' / 'body body' / 'foot foot'` template and changes only the column count, the gaps, and the row sizing.
- **The switch never hides.** The cluster stays in flow, so the state of every entry is readable without hovering. Secondary icons keep `revealOnHover`; the name ellipsizes beside the cluster and keeps its full text in the identity row's hint. The opaque plate and its spread shadow, which existed to cover text the floating cluster landed on, are gone.
- **Every surface fills the same rows.** The market suite card, the MCP status card, and the user-panel tile replace their hand-rolled row `div`s with the shared rows, so the anatomy has one spelling rather than two.
- **Rows follow their content at every width.** The wide branch's fixed 122px rows left a blank strip under a one-line description and clipped a taller card; `grid-auto-rows: max-content` lets a row be as tall as its tallest card.
- **The surface owns its height.** `.surface` is a flex column that clips, a `.results` box holds the filter panel, and the collection scrolls inside it. A dialog that clips its frame now scrolls the list instead of cutting the last row.
- **The foot can lead without provenance.** `CardCount` takes `first`, so a card whose source line is empty does not open with a separator.

## Alternatives considered

- **Keeping the class strings and documenting the row classes.** Rejected: this change exists because the contract stayed invisible at the call site, and a comment would not have stopped it.
- **Forcing the switch above the floating cluster.** Rejected: a child cannot raise the opacity of the parent that fades it, and a plate large enough to stay visible at rest would cover the name.
- **Keeping only the switch visible inside a hover cluster.** Rejected for the same reason: the cluster's own opacity is what hides it.
- **Keeping fixed 122px rows and clipping the description harder.** Rejected: that hides content to protect an alignment `max-content` already gives through the grid's stretch.
- **Migrating only the shared renderer.** Rejected: the three hand-built cards would have kept a second spelling of the same anatomy, which is the drift this change removes.

## Consequences

- Long names ellipsize earlier than before, because the identity row reserves the cluster's width at every breakpoint. The hover hint carries the whole name.
- Cards in one grid row share the tallest card's height instead of a fixed 122px.
- A new slot needs a new row in the shared module; a surface cannot add one locally without failing the anatomy test.
- [The one card anatomy](../feature/2026-09-14-workspace-card-anatomy-and-host-affordances.md) and [the live card affordances](../feature/2026-09-16-workspace-live-card-affordances.md) keep their box, slots, and container decisions; only the narrow branch's floating, hover-revealed cluster is superseded here.

## Verification

- A preview harness outside the repository tree rendered the real `ResourceSurface` and card stylesheets against the host design tokens at 760px and 560px with six preset-like entries and the system-prompt card. Before the change the description sat beside the name and the switch covered it; after, every card shows identity, a two-line body, a source row, and an always-visible switch. A 300px-tall frame proved the collection scrolls instead of clipping.
- jsdom: an anatomy test asserts the row order, that the description fills the body row, that the switch ends the action cluster, and that the source fills the foot row; a bare entry renders no empty rows; the parity test compares the row list across two surfaces.
- `vitest run packages/market-ui/test` 43 files / 288 tests green; client typecheck clean; `check:css` and `check:single-renderer` green.
