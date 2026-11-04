# Agent Note: an uninstalled suite is not a switched-off one

Status: implemented

## Problem

Every card carries a 3px rail on its leading edge: success for running, tertiary grey for switched off, warn and error for a problem. The market mapped install state onto that same pair, so a suite the reader had never installed painted the "switched off" grey. On the profile that motivated this, that is 971 of 1,000 suites: the market read as a wall of disabled cards, and the 25 suites that really are installed-but-off had no way to stand out from them.

## Decision

- **The card chrome gains `absent`.** An entry the surface lists but does not own yet paints no rail at all, while keeping the rail's width so the grid still lines up. "Not here yet" and "switched off" are different facts, and the reader acts on them differently: install versus enable.
- **The market maps three facts to three states.** Installed and enabled is `active`, installed and off is `disabled`, not installed is `absent`. Nothing else about the card changes: the primary action and the hidden switch already differ.
- **`ResourceEntry.state` reuses `ResourceState`.** The entry type had its own copy of the union, which is how a new state could exist on the card and not on the entry; it now imports the card's type.

## Alternatives considered

- **Keep the grey rail and add a "未安装" tag.** Rejected: the tag would print 971 times and say what the 添加源 button already says.
- **Paint uninstalled cards with a neutral tint instead of no rail.** Rejected: a tint reads as a state; the honest chrome for "no state yet" is no mark.
- **Add a fourth filter instead of fixing the edge.** Rejected: the market already has 已安装/未安装, and the audit that produced this finding said the row is what lies, not the filter bar.

## Consequences

- A market of a thousand suites reads as a catalogue with a few marked cards, not as a thousand disabled ones.
- Any surface that lists entries it does not own can use `absent`; the market is the first.
- The grid's alignment is unchanged, because the rail keeps its width.

## Verification

- `packages/market-ui/test/market-section-render.test.ts` renders one running, one installed-but-off and one uninstalled suite and asserts the three `data-resource-state` values.
- In `market-dev` against the built bundle, the first page of the market shows 115 `absent` cards with a transparent rail, 4 `active` and 1 `disabled`, so the switched-off suite is the only grey one on screen.
