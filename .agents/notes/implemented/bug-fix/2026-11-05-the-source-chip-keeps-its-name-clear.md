# Agent Note: the source chip keeps its name clear of its controls

Status: implemented

## Problem

The market's source chip carried its trailing `✎`/`×` controls as a plate laid over the label. `.srcTabControls` was absolutely positioned at the pill's right edge, painted opaque with a spread shadow, and its buttons carried `pointer-events: auto` while the plate itself was transparent to clicks. Two defects followed, and both showed up on the same short source name.

- The plate is as wide as the two buttons, so on a short name it covered the whole pill: the source's name was painted over by an opaque rectangle, and the reader could not tell one source from another.
- The buttons were hit targets even while the plate was invisible, because `opacity: 0` does not stop a hit test. A click on the chip after hovering landed on an invisible edit or delete control instead of selecting the source, and the invisible delete button sat one click away from the remove-source confirmation.

The name was also the raw source id, which for a skills collection stored under a short id says nothing about which repository it is.

## Decision

- **The controls are the chip's own last item, not a plate over the name.** `.srcTabControls` is a flex item of the pill (`flex: 0 0 auto`), so the name is never painted over and a click on it always selects the source. They sit at the chip's trailing edge, the place the card's own action cluster takes.
- **Closed, the controls take no room at all.** The plate is `max-width: 0` with `overflow: hidden`, so a resting chip is exactly as wide as its label — [the chips-hug-their-ids note](../feature/2026-10-30-source-chips-hug-their-ids.md) keeps its promise — and the closed buttons are neither painted nor hit.
- **Opening them is a width, not an overlay.** Hover, or `:focus-visible` and never plain `:focus-within`, raises the plate's `max-width`: a chip with room grows by the controls' width and keeps every pixel of its name, and a chip already at its 220px cap gives the label exactly the width the old plate used to cover. The name a reader reads is the same length it was.
- **An invisible control never takes a click.** `.srcTabControls > button` is `pointer-events: none` until the plate is open, and the open state gives the buttons their pointer events back. The plate itself stays click-transparent, so the chip's own padding selects the source.
- **The whole chip selects the source.** `SourceTab`'s root carries the select handler and the name button stops the propagation, so the source is selected once. The name stays a real button for the keyboard and for assistive technology.
- **The chip names the source the way a reader recognizes it.** The label is `source.displayName ?? source.id` plus the suite count; the id stays the chip's key and the scope it selects.

## Alternatives considered

- **Reserve the controls' width at rest.** Rejected: every source's resting chip would grow by the controls' width, which breaks the width promise [the chips-hug-their-ids note](../feature/2026-10-30-source-chips-hug-their-ids.md) makes, and a strip of wider pills fits fewer sources in the same two rows.
- **Keep the plate over the name and only gate its pointer events.** Rejected: it fixes the invisible click, not the covered name — on a short name the plate still hides the whole label and the buttons still sit on it.
- **Let the label shrink under the plate.** Rejected: the name is how the reader picks a source; truncating it to make room for the controls trades the legibility defect for a worse one.
- **Hang the controls outside the pill, into the strip's gap.** Rejected: they would cover the next chip and take its clicks.
- **Measure the name in JavaScript and switch the layout on the measurement.** Rejected: a ResizeObserver per chip to decide something CSS expresses on its own, and jsdom cannot test it.
- **Give the controls a row of their own under the name.** Rejected: the pill is 24px tall and the strip folds to a fixed height, so a second row changes the fold.

## Consequences

- A short source's name is readable while its controls are open, and clicking the name selects the source.
- A chip whose name is shorter than its controls grows by the controls' width while they are open and returns to its resting width when they close. A chip at its 220px cap does not move: the label gives up exactly the width the old plate covered.
- The keyboard reaches the controls the way it did: tabbing to one opens the plate through `:focus-visible`, and the buttons keep their accessible names.
- The chip now carries the source's qualified name, so two sources whose ids differ only in a short suffix read apart.

## Verification

- `packages/market-ui/test/source-chip-legibility.test.ts` pins the stylesheet contract (the controls are a flex item, closed they take no room and are inert, opening is a width, the reveal is `:focus-visible` and never `:focus-within`) and the DOM contract (the name is not inside the controls, a click on the name selects the source once, a click on the chip's own area selects it, a control's click does not).
- `packages/market-ui/test/market-section-render.test.ts` pins the qualified name on the chip.
- The widths themselves are not measurable in jsdom: the claims above are read off the rules, not off a rendered frame.
