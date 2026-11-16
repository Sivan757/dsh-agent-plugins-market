# Agent Note: a default selection follows the catalog

Status: implemented

## Problem

Installing a suite or a skill in the market did not reach a running session. The session kept its own selection, and that selection was a snapshot of ids taken when the session started, so a resource the catalog gained afterwards was simply not in it. The symptom was precise: with the session on the default preset nothing changed, and switching the extension preset once made the new content appear, because a switch writes a fresh selection.

This is the core feature. Everything else the plugin does is a reading of the catalog; a catalog change that does not reach the session is a plugin that appears not to install anything.

## Decision

- **A selection that names no preset follows the live catalog.** After a catalog change, the refresh computes the rows the catalog now offers, adds them to the committed selection, and commits that selection. The commit is what grants the rows, injects them and shows them in the panel, so the grant, the injection and the display move in one step instead of three that can disagree.
- **A switched-off row is withdrawn the same way.** A capture is the global switch set read as ids, so the catalog switching a row off removes it from the session that captured it, not only from the sessions captured afterwards. Without that half, a session resumed weeks later kept running a suite its reader had switched off while every surface showed it as off.
- **The grant reads a capture against the switches at read time.** The withdrawal cannot wait for the next refresh: a resumed session applies its committed capture before any read, and the hooks of that capture run at session start. `extensionResourceEnabled` therefore takes what the selection is — a capture or a preset — and a capture grants nothing the catalog has switched off. The stored ids are pruned by the next refresh; until then they grant nothing.
- **An id the inventory does not list is not a withdrawn row.** The prune removes only rows the catalog publishes as switched off, unavailable or globally managed. A partial read must never shrink a selection, which is why the refresh compares the whole id list instead of its length.
- **A preset selection does not follow the catalog.** A preset is a choice; a suite installed later does not join it behind the reader's back. A preset that names a globally disabled row keeps granting it: the switch governs what a capture means, not what a reader explicitly pinned.
- **A capture taken from the pre-preset resource filters is frozen.** Those filters were the workspace's own switches, and re-deriving the set would turn them back on. The selection carries that as `frozen`, and the window and the gates keep reading it as it was captured.
- **The commit runs outside the maintenance slot.** A commit inside the refresh's maintenance block waits for the very maintenance it runs in, so the refresh hands the selection over and commits it once the slot is free.

## Alternatives considered

- **Re-derive the whole selection on every refresh.** Rejected: it would also re-enable the resources the pre-preset filters had switched off, and it would lose the committed rows while an inventory read is in flight. The withdrawal is deliberately not that: it removes only the rows the catalog publishes as switched off, keeps every id the inventory does not list, and leaves a frozen capture alone.
- **Commit the pruned selection at restore, before the session starts.** Rejected: the restore runs inside the session's own startup maintenance, and a commit there waits for the maintenance it runs in. Reading the capture against the switches is what makes the switch true immediately; the next catalog refresh outside the slot is what rewrites the ids.
- **Let the panel hide what the gate denies.** Rejected: the manager renders a preset draft, not the committed selection, so hiding there would have shown the reader a third state instead of the two the plugin already has to keep in step.
- **Record the rows the reader turned off (an exclusion list).** Rejected after checking the product: the manager has no way to turn a row off in the default selection, because a switch always edits a preset draft. There is no such intent to preserve, so there is nothing to exclude.
- **Apply the effective selection without committing it.** Rejected: the panel would show the new row as off while the session injected it, and the next refresh would disagree with the last. One commit keeps the stored state, the gate and the injection in step.
- **Refresh only the injected content, leaving the selection alone.** Rejected: the selection is the input to the injection, so it has to move too.

## Consequences

- Installing a suite or a skill reaches a running session on the next catalog refresh, with no preset switch.
- A session on a preset is unaffected by the same install, which is the point of a preset.
- The selection document may carry one more optional field (`frozen`), and a default selection now grows and shrinks with the catalog.
- A row switched off globally stops running in a session that captured it, and a preset that names the same row keeps running it. Both halves are read from the same function, so the display and the gate cannot disagree.

## Verification

- Tests (real agents, real session state, real apply path):
  - a default selection grants and applies a resource the catalog gains, with no preset switch;
  - a preset selection does not grant it, and the inventory still lists it;
  - the pre-preset filters keep their own capture (frozen), and the globally disabled rows stay out of every implicit selection;
  - a capture that predates a switch turned off stops granting the row, and the refresh that follows drops the id;
  - a preset that names the same row keeps granting it;
  - `extensionResourceEnabled` reads a capture as the switches and a preset as its own list;
  - an installed suite's hook row reports the suite's switch instead of a constant.
- The full suite passes (2,661 tests), and `check:quick` and `format:check` are clean.
- No GUI run was made for this change; the behavior is covered by the integration tests.
