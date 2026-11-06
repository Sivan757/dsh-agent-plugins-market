# Agent Note: the source chip masks its controls over a room of its own

Status: implemented

## Problem

The chip's trailing controls were rebuilt so that the name never sits under them, and the price was that the chip grew when they opened: the controls took room inside the pill, so hovering a chip widened it by the controls' width and moved the rest of the strip. The owner reviewed the running app and asked for the published form back — the controls appear on hover as one plate over the chip's trailing edge, with the internal mask (the opaque plate and the spread shadow that feathers its edge), and the chip does not expand.

The published form has one defect that must not come back with it. In the published stylesheet the plate was transparent to clicks but its buttons were not: `opacity: 0` does not stop a hit test, so the invisible edit and delete buttons were live targets lying over the name. A click meant for the name landed on a control instead, and the invisible delete button sat one click away from the remove-source confirmation.

Restoring the overlay alone is not enough either. The plate is 51px wide in the running app, and the shortest source name is 54px (`ponytail 1`), so a plate laid over the trailing edge covers that name almost whole — the reader sees the controls and no name at all.

## Decision

- **The controls are the published plate again.** `.srcTabControls` is absolutely positioned over the chip's trailing edge, painted opaque with the spread shadow that feathers its edge, and revealed on hover or keyboard focus (never plain `:focus-within`). The plate is out of the flow, so the chip does not grow when it opens.
- **The name ends before the plate, and the room is on the chip, not on the label.** A chip that carries controls reserves the room the plate needs in its own trailing padding: `.srcTab:has(.srcTabControls)` gets `padding-right: calc(10px + var(--src-tab-controls-room))`, and the room is **47px** — the plate covers 41px of the content box (it is 51px wide and is placed against the padding box) and the mask's feather reaches 6px further left. The plate therefore covers the chip's own padding and never a letter of the name, at any name length. A chip without controls keeps the symmetric 10px.
- **The room is not on the label, and that is the point.** The label carries the chip's 220px text budget; padding it would ellipsize the longest names 47px earlier than the published build, where they read in full. Reserving the room in the chip's padding leaves the label's budget whole, so the longest name still reads in full.
- **The invisible controls are inert.** The plate stays `pointer-events: none`, and the buttons are `pointer-events: none` as well until the plate is open; the open state gives them their pointer events back. A closed control can never swallow a click meant for the name, and the visible controls stand in their own room rather than on the name.
- **The whole chip selects the source.** The chip's root carries the select handler and the name button stops the propagation, so the source is selected exactly once and the name stays a real control for the keyboard and for assistive technology.
- **The chip still names the source the way a reader recognizes it.** That decision lives in [the qualified source name](../feature/2026-11-05-qualified-source-name.md); this change keeps it and does not restate it.

## Supersession

This supersedes [the source chip keeps its name clear of its controls](../bug-fix/2026-11-05-the-source-chip-keeps-its-name-clear.md): its decision — the controls claim room inside the chip and the chip grows when they open — is replaced by the overlay plate and the reserved room. That note's other facts still hold: the chip's root selects the source, the name button stops the propagation, and the qualified name leads the chip.

It also partially supersedes [source pills take the width of their ids](../feature/2026-10-30-source-chips-hug-their-ids.md): a pill is still as wide as its label up to the same 220px cap, but a pill that carries controls now adds the room those controls need, so the strip shows fewer sources per row than it did. The fold, the fade, the overlay expansion and the post-pick collapse are untouched.

## Alternatives considered

- **Keep the growth.** Rejected: the owner asked for the published form, and a chip that widens when the reader points at it moves every chip after it.
- **Lay the published plate over the name and let the tail go.** Rejected: the plate covers 51px of a 54px name, so the shortest chip loses its name entirely, and every name under about 100px loses its tail.
- **Reserve the room in the label's padding.** Rejected: the label carries the 220px text budget, so the room came out of the name's own width and the three longest names ellipsized 47px earlier than the published build, where they read in full.
- **Replace the opaque mask with a veil so the name reads through.** Rejected: the two glyphs still lie on the name, the name's tail still vanishes under them, and the click still lands on a control.
- **Measure the name and reserve the room only where the plate would swallow it.** Rejected: a ResizeObserver per chip, a width that changes after the first paint, and two different chip shapes in one strip.
- **Make the plate narrower.** Rejected: the plate's width is the mask's look, and it cannot get under the two glyphs anyway.
- **Hang the controls outside the pill.** Rejected: they would cover the next chip and take its clicks.

## Consequences

- The chip does not change size when the controls open: the same 123px before and after the hover, measured on the shortest chip.
- The name is fully readable and clickable at every length, and the controls stand in their own room: the shortest live name (54px) ends 7px before the plate begins.
- The controls are still inert while they are invisible, so an invisible control never takes a click.
- A chip that carries controls is wider than its label by the room it reserves, so the strip holds fewer sources per row than the chips-hug-their-ids note measured.
- The longest names read in full, as they did in the published build: the room comes out of the chip's padding, not out of the label's text budget.

## Verification

- Live in the `market-demo` profile (the linked checkout, the built client bundle), hovering the shortest chip `ponytail 1`:
  - the name measures 54px and the plate measures 51px;
  - the chip measures 123px before the hover and 123px while hovered — it does not grow;
  - the plate's left edge sits 7px right of the name's right edge, so no letter of the name is under it, and the two buttons stand at 1241-1256 and 1262-1273, outside the name's box (1191-1245);
  - the plate's buttons measure `pointer-events: none` while closed and `pointer-events: auto` while open;
  - a click on the name selects the source (the chip becomes the selected one and moves next to `全部来源`) and opens no confirmation.
- Every chip with controls clears the plate by at least 7px, and the strip takes 8 rows for its 19 chips.
- The longest name reads in full: `claude-code-plugins-plus-skills 438` has 207px of ink and `label.scrollWidth === label.clientWidth` (207), so it is not ellipsized; the chip is 276px wide, the same 47px wider than its name as the published build's chip.
- `packages/market-ui/test/source-chip-legibility.test.ts` pins the stylesheet contract (the plate is the overlay again, the buttons are inert until it is open, the reveal is `:focus-visible` and never `:focus-within`, the room is on the chip's padding and not on the label, and the room is at least 47px) and the DOM contract (the name is not inside the controls, a click on the name selects the source once, a click on the chip's own area selects it, a control's click does not).
