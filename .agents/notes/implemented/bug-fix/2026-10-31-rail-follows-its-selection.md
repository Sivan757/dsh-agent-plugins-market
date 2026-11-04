# Agent Note: the rail brings its selected tab into view

Status: implemented

## Problem

The settings rail scrolls sideways when the sections do not fit, and it opened at its start every time. A reader who closed the panel on 语言引擎 reopened it to a row whose active chip sat behind the right fade, half hidden, with the row still scrolled to the first tab. Selection changes that do not move focus (a restored workspace tab, a programmatic pick, an Alt+arrow move) also left the selected chip clipped.

Clicks and arrow keys hide the problem because they move focus and the browser scrolls the row itself, which is why it survived the earlier rail work.

## Decision

- **The rail follows its selection.** An effect reads the selected tab's offset and width and scrolls the row just enough to bring it inside, with 8px of air so the chip's rounded frame does not touch the fade. It scrolls only when the chip is actually outside, so a fully visible selection never moves the row.

## Alternatives considered

- **`scrollIntoView` on the selected tab.** Rejected: it also scrolls ancestors, so a nested row could move the settings dialog.
- **Scroll to the start on mount and leave the rest to focus.** Rejected: the case that reported this is exactly the one with no focus change.
- **Centre the selected chip.** Rejected: it moves the row on every selection, so a reader stepping through neighbouring tabs sees the strip slide under the pointer.

## Consequences

- Reopening the panel shows the section it was left on, fully readable.
- The strip only moves when the selection is off screen, which keeps arrow-key stepping stable.

## Verification

- `packages/market-ui/test/tab-rail-drag.test.ts` sets the geometry jsdom cannot lay out, changes the selection to an off-screen tab, and asserts the row scrolls it 8px inside the edge.
- Measured in `market-dev`: selecting 语言引擎 (previously clipped) scrolls the row to `scrollLeft: 34` with the chip fully visible, and selecting the first tab returns it to `0`.
- The four typechecks, `check:refactor` and the full suite pass.
