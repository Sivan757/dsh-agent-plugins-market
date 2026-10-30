# Agent Note: a detail row is one disclosure

Status: implemented

## Problem

A row that carries a header action rendered two focusable toggles for the same disclosure: the name band (`actionToggle`) and a trailing chevron button named after the row, both with `aria-expanded` and the same `onToggle`. A screen reader announced the row twice with the same state and the same action, and neither button said which body it opened.

## Decision

- **The chevron is the same disclosure seen from the pointer's side.** It becomes a presentational span: still clickable with a mouse, out of the tab order and out of the accessibility tree. The name band is the one control, which is where the row's own text already is.
- **The disclosure names its body.** `DetailRow` mints an id for the body and sets `aria-controls` while open, so a reader can jump to what the toggle revealed.

## Alternatives considered

- **Name the chevron "Expand _row_".** Rejected: two controls for one action remain two stops and two announcements, however they are named.
- **Drop the chevron entirely.** Rejected: the row's trailing chevron is the affordance the prototype draws and the one a pointer aims at.
- **Give the body an id only in the action-header branch.** Rejected: the plain branch has the same relationship and would have drifted.

## Consequences

- One tab stop per disclosure row, one `aria-expanded`, one announcement.
- A pointer user can still toggle from the trailing edge.
- Rows with and without header actions expose the same relationship to the body.

## Verification

- `packages/market-ui/test/detail-row-disclosure.test.ts` renders a row with a header action, asserts a single `aria-expanded` button, that the click still toggles, that no second button carries the row's name, and that the open toggle's `aria-controls` names the body that holds the content.
- The four typechecks and `check:refactor` pass.
