# Agent Note: an output-style row says where it stands and offers the next step

Status: implemented

## Problem

The Output styles face is a list of choices, and it read as an inventory: a suite style's card said 套件 and a sentence, with no state word and no control. An installed style therefore looked inert — "the plugin is installed but nothing is active, and there is no content" — while the only capture and select controls lived inside the row's dialog. The row's description was also a hardcoded English sentence built on the server.

## Decision

- **The row states its position in the one selection this face manages**: 使用中, 未选用, or未捕获.
- **The action that moves it on sits beside that word.** A row whose text was never captured carries 抓取文本 on the card; a captured row carries the switch, which selects it. A style is a single choice, so the switch means "choose this", not "on or off".
- **A suite row carries a typed hint, not copy.** `OutputStyleRow.hint` is `'suiteSessionStartCapture'` or absent, and the client maps it to `outputStylesSuiteCaptureHint`. The server cannot express reader-facing text.
- **The surface owns the handlers.** The first version put `onToggle` and `isOn` inside each entry object; the renderer reads them from the surface's props, so no switch was drawn at all. The handler now lives on the surface, and a test written to the intended behaviour caught it.

## Alternatives considered

- **Keep capture and select inside the dialog.** Rejected: it is exactly the shape this round removed from the connectors list — a state word that names a problem with the fix hidden one click away.
- **Show the switch on an uncaptured row and disable it.** Rejected: a disabled control states "you cannot", not "capture first". The capture button states the actual next step.

## Consequences

- The face answers "is this style in use" while scanning, and "what do I do next" on the same card.
- A future selection surface passes its handlers to the surface, not to entries.

## Verification

- Live in `market-dev`, in order: the row read 未捕获 with 抓取文本 → after the capture it read 未选用 with a switch (`aria-checked=false`) → pressing the switch read 使用中 with `aria-checked=true`.
- `packages/market-ui/test/client-output-styles-panel.test.ts` pins both: the uncaptured row offers capture and calls `captureOutputStyle`, and a captured row's switch calls `selectOutputStyle`.
- The full suite passes (2519).
