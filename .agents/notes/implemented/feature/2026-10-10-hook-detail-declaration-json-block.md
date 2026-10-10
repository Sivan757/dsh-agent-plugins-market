# Agent Note: Hook detail declaration JSON block

Status: implemented

## Problem

The hook detail dialog showed the command in one place, the status card, and no section repeated it. The reference shape the user asked for is the host plugin manager's HOOKS block: a section heading, then one collapsible row whose left side is the event name, whose middle is a clipped monospace command preview, and whose right side is a chevron. Expanding that row shows a JSON block. A reader who wants to see the declaration as one record had no such row in this dialog.

## Decision

The hook detail dialog carries a Declaration JSON section between the overview grid and the diagnostic section.

The section holds one disclosure row built from the local `DetailRow` atom inside `DetailRows`. The row name is `detail.event`, the row summary is `detail.command` clipped to one line by the atom, and the chevron comes from the atom. The row starts folded, because the declaration is one line until the reader asks for the record behind it.

The expanded body is the host `JsonTree` primitive, with labels from `jsonTreeLabels(t)`. That helper already carries every label the other three JSON surfaces use.

`declarationJson(detail)` assembles the tree data on the client from the scanned fields the wire carries: `event`, then `matcher`, `command`, `timeout` and `diagnostic` when each is present. Address fields and host-derived facts stay out. The timeout states the declared seconds under the scanned `timeout` key. The wire carries the scanned declaration and never the file's raw bytes, so the block reads as the declaration, not as a copy of its source.

The command now reads twice while the row stays folded. The status card states it and the row previews it. This is a deliberate partial reversal of the "command appears once" consequence in [Hook detail anatomy and follows-suite rows](2026-10-09-hook-detail-anatomy-and-suite-following-rows.md), taken because the user asked for the reference row shape.

## Alternatives considered

- **Write a new row component for the reference shape.** Rejected: `DetailRow` already draws the three-column band, clips the summary to one line, and supplies the chevron. A second row component would drift from the one the other detail dialogs share.
- **Keep the command in the status card alone and preview something else in the row.** Rejected: the reference row's middle column is the command, and the user asked for that shape. A preview of the event would repeat the row's own name.
- **Send the raw declaration file text over the wire and render that.** Rejected: the scanned contract carries the admitted declaration fields, not the file bytes, and widening the wire for one block adds a payload every other reader must trust. The assembled tree states the same declared facts.
- **Add local CSS for the JSON block.** Rejected: the host `JsonTree` paints its own surface and colors from the platform tokens, so no local rule is needed.
- **Render the row expanded by default.** Rejected: the reference block is collapsed, and an open JSON tree pushes the diagnostic and run sections out of the first screen.

## Consequences

- The dialog shows one declaration as one record. The row names the event and previews the command, and the JSON states every declared fact.
- The command reads twice at rest. A reader who counts occurrences sees the status card and the row preview, and the expanded tree makes it three.
- A rejected declaration shows its diagnostic inside the same block, because the assembled JSON carries `diagnostic` when the scanned record has one.
- `tests/client-hooks-status-panel.test.ts` pins the resting count at two, the row's folded state, the expanded tree's own facts, and the absence of address fields.

## Testing

`tests/client-hooks-status-panel.test.ts` asserts the section heading, the folded row with its event name and command preview, the expanded `role="tree"` with its label and declared facts, and the absence of `sourceId`, `suiteId`, `provenance`, `support`, `hookIndex` and `sessionId` in the tree.
