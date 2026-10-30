# Agent Note: the card is a region with one opener, and it says its state in words

Status: implemented

## Problem

The accessibility review left two findings on the shared card, and both came from the same decision: the card was painted as a button.

**A button around controls.** The card carried `role="button"` while holding a switch, an editor and up to two icon actions. ARIA 1.2 treats a button's descendants as presentational, so assistive technology may flatten those controls into the card's name, and independently every card was a tab stop on top of its controls (three stops per row on the connector surface).

**A state that only colour carries.** The card's state is a 3px rail on its leading edge, and nothing else: no text, no description. A reader who cannot distinguish the rail's colours, or who cannot see it at all, gets no state from the row.

## Decision

- **The card is a region; the name is its control.** `ResourceCard` no longer takes `role`, `tabIndex` or a keydown handler. The pointer still opens a card by clicking anywhere on it, and `CardIdentity` renders the entry's name as a real `<button data-card-open>` that stops its own click so one press opens once. The controls beside it are siblings of the opener rather than descendants of a button.
- **`interactiveCardProps` is deleted.** It existed to make the card a button; leaving it would invite the same shape back.
- **The state is also words.** `ResourceCard`'s identity row renders a visually hidden `stateLabel` when the entry supplies one, and the connector, language-engine and market surfaces supply it from the same helper their detail dialogs already use (`已停用`, `运行中`, `未安装`).

## Alternatives considered

- **Keep `role="button"` and add `aria-description` for the state.** Rejected: the flattening of nested controls is the larger defect, and a description does not fix it.
- **Make the whole identity row the opener.** Rejected: the row also carries the version chip and the provenance tag, which are not part of "open this entry".
- **Render the state as a visible chip.** Rejected for now: the rail is the designed cue, and a chip on 971 uninstalled cards would be noise; a hidden word serves the reader who needs it without changing the visual language.

## Consequences

- One tab stop opens a card, named by the entry; the controls are separate stops with their own names.
- A screen reader hears the row's state in words before the controls.
- Every surface that lists entries owns the words its states need; a surface that supplies none stays silent rather than guessing.

## Verification

- `packages/market-ui/test/resource-surface.test.ts` asserts the card has no role and no tab stop, that the name button opens it, that a click anywhere on the card still opens it, that the opener's click does not open twice, and that a supplied state label renders in the hidden span.
- `packages/market-ui/test/market-section-render.test.ts` asserts the three market states carry their words (已启用 / 已停用 / 未安装).
- `packages/market-ui/test/resource-surface-parity.test.ts` pins the region contract on both surfaces.
- In `market-dev` against the built bundle: 120 cards with no role and no tab stop, an opener button reading "mattpocock-skills", the hidden state word 已停用 on the switched-off card, and Enter on the focused opener opening that suite's detail.
