# Agent Note: the class gate sees every stylesheet, and the tool rows follow their dialog

Status: implemented

## Problem

A spacing audit closed with two structural findings behind the values it listed.

**Three stylesheets were never checked.** `check:css` skipped `market.module.css`, `panel.module.css` and `source-strip.module.css` because a file that reaches a stylesheet through a computed key is unfollowable: `ExtensionPresetEntry.tsx` built class names by concatenation in three places, and `page-mode.tsx` indexed the stylesheet with a runtime name. Every dead rule in those three files was invisible, which is exactly where the audit found them.

**The connector tool table keyed its layout off the window.** It stacked below `760px` of _window_, while the panel list stacked below `700px` of _container_. The audit read the panel shell as the container, but the tool table lives in a detail dialog that is portaled to the body, so no panel container is an ancestor and a container query could not match there either.

## Decision

- **Name class names; never compute them.** The three concatenations became template literals, and `page-mode.tsx` names the two classes it needs in a constant map instead of indexing the stylesheet. `check:css` now analyzes all twenty sheets, the compiler catches a renamed class before the console does, and the ledger that recorded "removal waits on a visual pass" is empty.
- **Delete what the gate can now see.** Nineteen dead rules went (the market's hand-built card grid and plugin-card frame, the panel's entry-container block and `.body`, the connector's empty/footer/detail rules, the source strip's grid declaration on a flex row, the detail's form pair, the form's row actions and inline check), along with the ten ledger rows that recorded them.
- **The dialog is the container.** `.dialog[role='dialog']` declares `container-type: inline-size`; the tool table's query then follows the dialog's own width. A portaled dialog has no panel ancestor, so this is the only container a rule inside it can resolve against.
- **One size for a monospace value line.** 11.5px/18px, which three of the four sites already used.

## Alternatives considered

- **Record the dead rules in the ledger instead of deleting them.** Rejected: the ledger exists for rules a removal would risk, and none of these are referenced anywhere once the three sheets became readable.
- **Keep `@media (max-width: 760px)` for the tool table.** Rejected: it keys off the window, so a wide window with a narrow settings-sized dialog keeps three columns in a space that cannot hold them.
- **Give the tool table both a media query and a container query.** Rejected: two answers to one question, and the media query is wrong exactly where the container one is right.

## Consequences

- A class that nothing references fails the gate on the day it appears, in every stylesheet.
- The connector tool rows stack whenever the dialog is too narrow, whatever the window is doing.
- Four monospace value lines read the same size.

## Verification

- `pnpm run check:css`: 20 stylesheets, 20 analyzed, 0 findings, 0 recorded (was 17 analyzed, 10 recorded).
- Measured in `market-dev` against the built bundle: the connector detail dialog is a container (`container-type: inline-size`); at its 800px width the tool rows are `140px 586px 0px` with the description shown, and after narrowing the dialog to 420px they collapse to a single `370px` column with the description hidden.
- The four typechecks, `check:refactor` and the full suite (2486 tests) pass.
