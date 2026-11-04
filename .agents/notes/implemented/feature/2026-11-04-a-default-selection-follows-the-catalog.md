# Agent Note: a default selection follows the catalog

Status: implemented

## Problem

Installing a suite or a skill in the market did not reach a running session. The session kept its own selection, and that selection was a snapshot of ids taken when the session started, so a resource the catalog gained afterwards was simply not in it. The symptom was precise: with the session on the default preset nothing changed, and switching the extension preset once made the new content appear, because a switch writes a fresh selection.

This is the core feature. Everything else the plugin does is a reading of the catalog; a catalog change that does not reach the session is a plugin that appears not to install anything.

## Decision

- **A selection that names no preset follows the live catalog.** After a catalog change, the refresh computes the rows the catalog now offers, adds them to the committed selection, and commits that selection. The commit is what grants the rows, injects them and shows them in the panel, so the grant, the injection and the display move in one step instead of three that can disagree.
- **A preset selection does not follow the catalog.** A preset is a choice; a suite installed later does not join it behind the reader's back.
- **A capture taken from the pre-preset resource filters is frozen.** Those filters were the workspace's own switches, and re-deriving the set would turn them back on. The selection carries that as `frozen`, and the window and the gates keep reading it as it was captured.
- **The commit runs outside the maintenance slot.** A commit inside the refresh's maintenance block waits for the very maintenance it runs in, so the refresh hands the selection over and commits it once the slot is free.

## Alternatives considered

- **Re-derive the whole selection on every refresh.** Rejected: it would also re-enable the resources the pre-preset filters had switched off, and it would lose the committed rows while an inventory read is in flight.
- **Record the rows the reader turned off (an exclusion list).** Rejected after checking the product: the manager has no way to turn a row off in the default selection, because a switch always edits a preset draft. There is no such intent to preserve, so there is nothing to exclude.
- **Apply the effective selection without committing it.** Rejected: the panel would show the new row as off while the session injected it, and the next refresh would disagree with the last. One commit keeps the stored state, the gate and the injection in step.
- **Refresh only the injected content, leaving the selection alone.** Rejected: the selection is the input to the injection, so it has to move too.

## Consequences

- Installing a suite or a skill reaches a running session on the next catalog refresh, with no preset switch.
- A session on a preset is unaffected by the same install, which is the point of a preset.
- The selection document may carry one more optional field (`frozen`), and a default selection now grows as the catalog grows.

## Verification

- Tests (real agents, real session state, real apply path):
  - a default selection grants and applies a resource the catalog gains, with no preset switch;
  - a preset selection does not grant it, and the inventory still lists it;
  - the pre-preset filters keep their own capture (frozen), and the globally disabled rows stay out of every implicit selection.
- Full suite passes (2,547); the gate is clean.
- Browser automation was unavailable in this session, so the behaviour is covered by the integration tests rather than by a GUI run.
