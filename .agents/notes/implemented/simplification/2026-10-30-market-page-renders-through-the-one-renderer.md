# Agent Note: the market page renders through the one resource list

Status: implemented

## Problem

The market browse surface was the last page that assembled its own toolbar, collection and card. Three consequences came with it. The repository kept a second card implementation, the install button was hover-revealed like a secondary icon even though it is the one action a reader is meant to press, and uninstall sat on the card while every other surface keeps destructive actions in the detail.

## Decision

- **The entry contract gains the two slots an inventory needs.** `version` puts the suite's version chip on the identity row, `primary` is the one text button that ends the trailing edge (install, or add source for a remote suite), and `actions` carries flat icon actions such as refresh. The primary action is always visible; only the secondary icons fade in, which is the rule the shared stylesheet already stated for the switch.
- **The market maps suites, it no longer renders them.** It narrows the overview to the selected source, maps each suite onto an entry with its surface counts, version, provenance tag, source id and error warning, and keeps its own work: install confirmation, source actions, the detail dialog, and the source strip above the list.
- **Uninstalling moves into the suite detail.** The card's click opens the suite; the risk-confirmed uninstall lives in that dialog, which already offered install and uninstall. The card keeps refresh, the primary action, or the enable switch.
- **The page-level view model goes.** `deriveMarketViewModel` lost its last caller: the renderer filters, searches and counts tabs from the entries it renders. The filter and category vocabulary it shared stays as two local types.
- **The ratchet reaches its goal.** `REMAINING` is empty, so `check:single-renderer` now fails on any new list module that assembles its own collection.

## Alternatives considered

- **Keep a market-only card that reuses the shared rows.** Rejected: that is exactly the second grammar the previous three migrations removed, and the primary slot is a contract fact, not a market one.
- **Keep the install button hover-revealed.** Rejected: a reader scanning a page of suites cannot press a control they cannot see, and the shared stylesheet already exempted the primary action from the fade.
- **Express the surface counts as a free-text meta line.** Rejected: `counts` aligns them in the source row, which is what the market page is scanned for.
- **Leave uninstall on the card behind a confirm.** Rejected: the renderer's contract and the three migrated surfaces all keep destructive actions one step inside the detail.

## Consequences

- Uninstalling a suite now takes one more click: open the suite, then uninstall.
- Installing from a card is visible at rest, so the primary action no longer depends on a hover.
- The source strip stays above the shared toolbar, because it scopes the list rather than filters it.
- No page assembles its own list any more; a new one that does fails the gate by name.

## Verification

- `packages/market-ui/test/market-section-render.test.ts` proves the install confirmation still opens from the card's install button and does not install on cancel, the header keeps its compact subtitle, and the source strip keeps its controls.
- `packages/market-ui/test/bilingual-toggle.test.ts` proves the market cards and the suite detail still flip together under the text view.
- `packages/market-ui/test/market-overview-reads.test.ts` proves the shared overview read and cache are unchanged.
- The preview harness renders market-shaped entries at 760px and 560px: version chip, surface counts, error warning, a visible install or add-source button, and refresh plus switch on installed rows.
- `check:single-renderer` reports one list module with an empty remaining set; `check:css` and the client, test-client and server typechecks are clean.
