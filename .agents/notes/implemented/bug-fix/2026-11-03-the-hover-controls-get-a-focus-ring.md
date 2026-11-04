# Agent Note: the controls that appear on hover get a focus ring

Status: implemented

## Problem

Card actions are flat icon buttons that only draw a background on hover. A keyboard user who tabbed to one got no visible change: measured on the connectors list, the 编辑 icon button reported `outline: none` and no shadow while focused (`:focus-visible` matched but nothing styled it). The show-more button at the end of a long list had the same gap.

## Decision

- **A control that is discoverable by pointer is discoverable by keyboard, in the same place.** `.iconBtn:focus-visible` and `.moreButton:focus-visible` draw the platform's brand-coloured 2px outline at a 2px offset, which is what the host's own buttons draw.
- **The rule was applied by surveying the stylesheets, not one report**: every local stylesheet with a `cursor: pointer` class was checked for a `:focus-visible` rule, and the two that lacked one were fixed.

## Alternatives considered

- **Rely on the browser default ring.** Rejected: these buttons reset `border` and inherit a transparent background, so the UA ring lands on a 24px box with no padding and reads as a stray rectangle rather than a focus state.
- **Add a background on focus instead of an outline.** Rejected: the hover fill is also used to mean "this row is being pointed at", and a keyboard focus should be distinguishable from a pointer resting on the card.

## Consequences

- The hover-only controls are usable from the keyboard without guessing where focus is.
- New local stylesheets that add a pointer class should add the same rule; the survey above is the check to repeat.

## Verification

- Live in `market-dev`: focusing the connectors row's 编辑 icon button reports `:focus-visible` true with `outline: 2px solid` at a 2px offset, where it reported `outline: none` before.
- The switch already drew a 2px outline and is unchanged.
- `check:css` reports 20 stylesheets, 0 findings; the full suite passes.
