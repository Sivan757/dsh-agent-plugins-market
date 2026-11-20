# Agent Note: one dialog shell, one action row, one radius scale

Status: implemented

## Problem

The owner reviewed the workspace again and asked for four things: a deprecated progress route removed as if it had never existed; the 5px a scrollbar took from the fields made invisible; every form unified behind one component; and every corner drawn from one scale. Each one was a fact the previous round had left half-finished.

| finding | what the code showed |
| --- | --- |
| dialog chrome | thirteen dialog surfaces built their own chrome on the host `Modal`: seven in `features/extension-presets/ExtensionPresetEntry.tsx`, and one each in `AiSelectionModal`, `SourceEditorModal`, `InstallConfirmModal`, `MarketSection`, `panel.tsx` (editor and confirmation), and the two service editors through `ServerConfigModal`. |
| action rows | `footerHint`, `footerCount`, `footerError`, `modalFooterLeft` put a hint, a byte count, a failure, or a destructive button to the left of the buttons. The create hint `创建后立即生效，可在列表里停用` was the clearest case: prose in a button row. |
| scrollbar | the dialog body scrolled with its own 5px scrollbar, so a scrolling dialog's fields ended 5px short of its footer, and the layout shifted when the bar appeared. |
| corners | thirty-three declarations used hand-written radii of 4, 6, 8, 10 and 999 pixels, three of them on one screen. The host has a radius scale and a standard that says which tier each role takes. |
| deprecated path | the previous round kept the `/progress` route "for the store's own tests and as a documented route", which is a second reader nobody had. |

## Decision

### One shell for every dialog

`ui/DetailModal` owns the chrome: the host's title row, a body that scrolls, and one footer row. `ui/FormDialog` is the same shell with a form body. A dialog passes `actions`, never a `footer`; the shell renders the row right-aligned and nothing else goes in it. A refused request arrives as `alert` and lands under the title, where the form starts, instead of beside the button that failed. Every hint that used to sit in a footer moved to the body: the instruction byte count and its limit under the document, the output style's name rule under the name field, and what saving does into the dialog's description.

### The scrollbar floats

The dialog body's native scrollbar is hidden and reserves no width. A 6px translucent thumb is painted above the content and follows the scroll position, so a dialog's fields keep the same right edge as its header and footer whether or not it scrolls, and nothing shifts when a scrollbar appears. The thumb is a sibling of the scroll region, not a child of the scrolled content, so it cannot scroll away.

### A focused field wears its own edge

The host's global `:focus-visible` outlines a text control with 2px at an offset, and this sheet used to add its own 2px ring on top of it: a focused input read as a second, heavier box sitting proud of the field. A focused text control now keeps its geometry: the border takes `--dsw-alias-state-business-primary` and a 3px halo at 18% of the same colour states the rest, with the host's `state-business-tertiary` as the fallback for browsers without `color-mix`. No `outline` or `outline-offset` is written for a field; keyboard rings on buttons, cards and capsules stay.

### One radius scale

Every corner comes from the host's `--dsw-radius-*` tiers, selected by the role the host standard names: controls and inputs R12, compact controls (24px icon buttons, segments, the tool-more control) R8, grouped content (cards in a detail, bands, editors, previews, fieldsets, mono blocks) R16, independent list cards R20, the floating operation overlay R20, and small inline detail (a focus ring, a tag) R4. Capsules keep 999px and state `corner-shape: round`, which the host standard requires for any circle or capsule.

### The deprecated route is gone

`MARKET_ROUTES.progress`, the `SourceProgress` contract, the `MarketQueries.sourceProgress` port method, `Catalog.sourceProgress` with its begin/step/end wrappers, the store's `progress()` and step bookkeeping, the client binding, and the test that pinned them are deleted. The store keeps one record of the acquisition in flight, because a checkout probe must not race it; that record holds the source id and whether it was cloned, and nothing else.

## Alternatives considered

- **Keep the host `Modal` and fix each dialog's footer by hand.** Rejected: that is the state the owner reported. Thirteen rows drift independently, and every new dialog starts the drift again.
- **Reserve a scrollbar gutter on both the body and the footer.** Rejected: it aligns the two only by making every dialog's fields 5px narrower, and it does not stop the thumb from appearing and disappearing.
- **Give the thumb its own scroll container inside the scrolled content.** Rejected: a child of the scrolled content scrolls away with it; the thumb must be the scroll region's sibling.
- **Keep hand-written radii per component but pick "the same" value everywhere.** Rejected: the host standard encodes role and height, so a 24px icon button and a 96px card legitimately take different arcs. What the owner rejected was arbitrary values, not the tiers.
- **Map corners to tokens through a new CSS variable layer of the plugin's own.** Rejected: the host's tokens are the layer, and a second one would need maintenance and drift.

## Consequences

- A dialog that offers no action renders an empty footer row; the shell keeps it for the settings frame's own buttons.
- The body is now `overflow: hidden` and the scroll lives one level inside, so a content rule that relied on the body scrolling (the MCP/LSP `detailBody` max-height) was deleted with it.
- The 5px inset is gone from every dialog, not just the two that had been measured.
- Corners grew on cards (10 → 20) and on inputs (8 → 12), so the market's card grid reads rounder and its fields more deliberate at once. That is the scale doing its job, and it is the visible change the owner asked for.
- Two source-facing guards now fail when the shape regresses: `packages/market-ui/test/dialog-shell.test.ts` rejects a dialog that imports the host `Modal`, a dialog that passes a `footer`, any `footerHint`-family name, a radius outside the scale, and a capsule without its curve; `dialog-footer-size.test.ts` now scans `actions` as well as `footer`.
- The theme token guard needed the four host radius tokens and `--dsw-alias-label-caption` added; each was checked against `design-system` sources before being listed.

## Verification

- `pnpm run test` is green after this change: 302 files, 2711 tests.
- `packages/market-ui/test/dialog-shell.test.ts` (5 tests) reads the sources and stylesheets; it was checked against the pre-change tree, where it flags every host-`Modal` import and every hand-written radius.
- `packages/market-ui/test/dialog-footer-size.test.ts` renders the instruction and language-server details and asserts their footer buttons are one size, and scans every `actions` expression for a stated size.
- Live in `market-demo` at 1448x1126, settings frame 800x800:
  - the user skill detail's footer holds 删除 at its leading edge and 完成 at its trailing edge, and its scroll thumb reports opacity 1 with a 335px height;
  - the connector create dialog's full-width fields end at 1028, the same edge as 创建;
  - the hook create dialog is 800 wide with three fields and two footer buttons, and no drafting affordance.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check` and `pnpm run build` are green.
