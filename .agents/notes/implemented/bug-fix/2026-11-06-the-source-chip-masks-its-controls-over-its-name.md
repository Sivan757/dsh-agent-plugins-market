# Agent Note: the source chip masks its controls over its name

Status: implemented

## Problem

The chip's trailing controls were rebuilt so that the name never sits under them, and the price was that the chip grew when they opened: the controls took room inside the pill, so hovering a chip widened it by the controls' width and moved every chip after it along the strip. The owner reviewed the running app and asked for the published form back — the controls as one plate over the chip's trailing edge, with the internal mask (the opaque plate and the spread shadow that feathers its edge), revealed on hover, and the chip exactly as wide as its label.

The published form has one defect that must not come back with it. In the published stylesheet the plate was transparent to clicks but its buttons were not: `opacity: 0` does not stop a hit test, so the invisible edit and delete buttons were live targets lying over the name. A click meant for the name landed on a control instead, and the invisible delete button sat one click away from the remove-source confirmation.

## Decision

- **The plate is the published plate.** `.srcTabControls` is absolutely positioned over the chip's trailing edge (`position: absolute; top: 0; right: 0; height: 100%`), painted with the internal mask — `background: inherit` plus `box-shadow: 0 0 6px 6px var(--dsw-alias-bg-layer-1)` — and revealed on hover or keyboard focus (never plain `:focus-within`, so a mouse click's plain focus cannot pin the plate on the chip the reader just picked). It measures 51px wide in the running app.
- **The geometry is the published geometry.** The chip is as wide as its label, up to the same 220px cap, and it reserves nothing for the controls: the plate is out of the flow, so the chip does not change size when the plate opens.
- **The invisible controls are inert.** The plate stays `pointer-events: none`, and the buttons are `pointer-events: none` as well until the plate is open; the open state gives them their pointer events back. A closed control can never swallow a click meant for the name.
- **The whole chip selects the source.** The chip's root carries the select handler and the name button stops the propagation, so the source is selected exactly once and the name stays a real control for the keyboard and for assistive technology.
- **The chip still names the source the way a reader recognizes it.** That decision lives in [the qualified source name](../feature/2026-11-05-qualified-source-name.md); this change keeps it and does not restate it.

## Supersession

This supersedes [the source chip keeps its name clear of its controls](../bug-fix/2026-11-05-the-source-chip-keeps-its-name-clear.md): its decision — the controls claim room inside the chip and the chip grows when they open — is replaced by the published plate and the published geometry. That note's other facts still hold: the chip's root selects the source, the name button stops the propagation, and the qualified name leads the chip.

It also partially supersedes [source pills take the width of their ids](../feature/2026-10-30-source-chips-hug-their-ids.md): a pill is again as wide as its label, up to the same 220px cap, so that note's promise is restored in full and the strip holds the sources per row it did before.

## Alternatives considered

- **Reserve a room for the plate, in the label's padding or in the chip's trailing padding.** Rejected: the owner saw it in the running app and asked for the published density instead — a chip that reserves room is wider than its name and the strip holds fewer sources per row. The names now carry their owner directory, so the short ids the room was meant to rescue are rarer.
- **Keep the growth.** Rejected: the owner asked for the published form, and a chip that widens when the reader points at it moves every chip after it along the strip.
- **Replace the opaque mask with a veil so the name reads through.** Rejected: the two glyphs still lie on the name and the click still lands on a control.
- **Measure the name and reserve the room only where the plate would swallow it.** Rejected: a ResizeObserver per chip, a width that changes after the first paint, and two different chip shapes in one strip.
- **Make the plate narrower.** Rejected: the plate's width is the mask's look, and it cannot get under the two glyphs anyway.
- **Hang the controls outside the pill.** Rejected: they would cover the next chip and take its clicks.

## Consequences

- While the plate is open it covers the name's trailing edge, and that is the form's cost: on the shortest chip only the leading characters of the name stay visible — 13px of a 54px name — and the name comes back the moment the pointer leaves.
- The part of the name the plate does not cover still selects the source: a click there lands on the name, never on a control, and opens no confirmation.
- The chip is as wide as its name again, so the strip holds the sources per row it did before: 19 chips take 6 rows.
- The controls are still inert while they are invisible, so an invisible control never takes a click.

## Verification

- Live in the `market-demo` profile (the linked checkout, the built client bundle):
  - the shortest chip `ponytail 1`: the chip is 76px, the name 54px of ink, the plate 51px; the plate covers 41px of the name and 13px of it stays visible;
  - the longest chip `claude-code-plugins-plus-skills 438`: the chip is 229px, the name 207px of ink, the plate covers 41px and 166px stays visible; no chip in the strip is ellipsized;
  - the chip measures 76px at rest and 76px while hovered — it does not change size;
  - at rest the plate and both buttons are `pointer-events: none`; hovered, the plate is opaque and the buttons are `pointer-events: auto`;
  - a click on the visible part of the name selects the source (the chip moves next to `全部来源` and becomes the selected one) and opens no confirmation, so the click never reaches the delete control.
- `packages/market-ui/test/source-chip-legibility.test.ts` pins the stylesheet contract (the plate is the published overlay, the buttons are inert until it is open, the reveal is `:focus-visible` and never `:focus-within`, and the chip reserves no room: no rule gives a chip that holds controls a trailing padding of its own, the base rule still reads `padding: 0 10px`, and the label gets no padding-right) and the DOM contract (the name is not inside the controls, a click on the name selects the source once, a click on the chip's own area selects it, a control's click does not).
