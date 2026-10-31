# Agent Note: one toolbar height on every surface

Status: implemented

## Problem

Measured in `market-dev`, the settings toolbars were 36px tall on the six surfaces that carry a filter segment and **33px** on the two that do not (系统提示词, 钩子). The height came from the tallest child: the host's segmented control is 36px, the search field 33px. Changing tabs therefore moved the list up or down by 3px, and the empty states of the two short surfaces sat 3px higher than their neighbours' cards.

## Decision

- **The toolbar row declares its own height.** `min-height: 36px` on `.toolbar`, the height of the host filter control, so a bar without filters keeps the row the same size. The surface keeps rendering only the controls it has; the row no longer depends on which controls those are.

## Alternatives considered

- **Give the search field a 36px height.** Rejected: the field is a host `Input` with its own 22px content box and 33px block, and stretching it would make the text sit high in a taller box.
- **Always render a filter segment, even empty.** Rejected in the filter rework: a strip with one tab says nothing.
- **Pad the short toolbars by hand.** Rejected: a per-surface number to keep in sync instead of one row rule.

## Consequences

- Every tab's toolbar is 36px and the content below it starts at the same offset.
- A new surface gets the row height without doing anything.

## Verification

- Measured in `market-dev` across all nine tabs: 36px on each (was 36/36/36/36/36/33/36/33/36).
- `pnpm run check:css`, the toolbar and surface tests, and the full suite pass.
