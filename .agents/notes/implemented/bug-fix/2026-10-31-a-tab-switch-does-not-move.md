# Agent Note: a tab switch never moves the panel's content

Status: implemented

## Problem

The owner reported that switching tabs made the content area jump on every surface except the market, the skills and the experts tabs. Measured frame by frame in `market-dev`, two panels were the cause, and they failed the same way: while their first read was in flight they rendered a header plus one placeholder line, and when the read landed the toolbar and the list appeared under it.

| tab             | first frame                  | settled                         | shift                      |
| --------------- | ---------------------------- | ------------------------------- | -------------------------- |
| 系统提示词      | no toolbar, no list box      | toolbar at y=193, list 519 tall | the whole panel moved down |
| 输出风格        | no toolbar, no list box      | toolbar at y=158, list 554 tall | 50px down                  |
| the other seven | toolbar and list box present | unchanged                       | none                       |

The scope line the system-prompt panel prints ("no session named, so this is the host process directory") also sat above the toolbar, so that one tab's controls were 35px lower than every other tab's for good.

## Decision

- **One tree per panel, whatever the data.** The output-styles and system-prompt panels no longer return a header-only skeleton; they render the header, the failure band and the shared surface from the first paint, with an empty entry list and `loading` in the list box. The toolbar and the list box exist in the same place in every state.
- **A surface-level note lives inside the list box.** `ResourceSurface` takes a `notice` slot drawn under the toolbar, before the collection. The system-prompt panel puts its scope line there, so the toolbar keeps row 158 on all eight non-market tabs instead of 193 on one.
- **The controls are the frame.** A panel that has a search field and a view switch on every other tab keeps them while loading, because they are as much a part of "this is the tab you picked" as the header is.

## Alternatives considered

- **Reserve a fixed height for the loading state.** Rejected: it fixes the numbers but not the cause, and a panel whose toolbar arrives late still flickers the controls in.
- **Cache every surface's first read so it never loads.** Rejected: it hides the defect behind warm caches and still jumps the first time a tab is opened.
- **Put the scope line into the header subtitle.** Rejected: it pushes the toolbar down by the same 35px and the subtitle has a 20-character budget.

## Consequences

- Every tab's toolbar sits at the same y, and every list box at the same y.
- A tab switch changes only the list's contents; nothing above it moves.
- A new panel inherits the shape by rendering `ResourceSurface` from its first paint.

## Verification

- Measured in `market-dev` across all nine tabs, sampling the toolbar and list box at 0/12/24/36ms and after 450ms: every tab now reports no movement, and the eight non-market tabs share the toolbar row at y=158 with a 554px list box.
- `packages/market-ui/test/client-output-styles-panel.test.ts` and `client-instructions-panel.test.ts` pin the toolbar and list box on a never-resolving first read.
- The four typechecks, `check:refactor` and the full suite pass.
