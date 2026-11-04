# Agent Note: every panel header is the same height

Status: implemented

## Problem

Nine settings tabs put their toolbars at eight different heights? No — one of them was different. Measured on the settings dialog: every tab's toolbar sat at y=158 except系统提示词 at y=162. Its header was 28px where the others were 24px, because that tab's header carries a text button (新建) while the rest carry icon buttons, and a description-only header had `min-height: 0` — so the tallest child decided the row, and with it where the toolbar below it landed.

## Decision

- **A compact header has a floor of 28px.** That is the tallest action a header can carry (a small text button), so a panel with icon buttons and a panel with a text button now draw the same header height and the same toolbar row. The floor only applies to the description-only variant; a header with a title keeps its 46px.

## Alternatives considered

- **Make the 新建 action an icon button.** Rejected: the create action opens a menu of candidates and needs a word; shrinking it to an icon to save 4px trades one inconsistency for a worse affordance.
- **Let the panel shell measure its own header.** Rejected: CSS already knows the action height; measuring the DOM for four pixels would cost a layout read on every tab switch.

## Consequences

- All eight non-market tabs draw their toolbar at y=162; the market keeps its own 218 because the source strip sits above it by design.
- A future header action taller than 28px will move every tab together rather than one.

## Verification

- Live in `market-dev`: the nine tabs read barTop 218 (market) and 162 (the other eight), where before 系统提示词 alone read 162 and the rest 158.
- The tab-switch regression check still reports no movement on any tab.
- The four typechecks, `check:refactor` and the full suite pass.
