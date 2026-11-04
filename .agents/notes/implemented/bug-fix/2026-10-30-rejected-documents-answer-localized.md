# Agent Note: a rejected server document answers in the reader's language

Status: implemented

## Problem

Two defects the copy review found, both about a dialog explaining itself in words the reader cannot use.

**A rejected document answered in English.** `server-form.ts` threw plain `Error`s with English messages ("Configuration must be a JSON object", `mcpServers must contain only the service key "…"`), and the editor rendered them after the localized "JSON 无效": a Chinese user read a Chinese label followed by an English sentence, every time a pasted document was wrong.

**The hook detail spoke a second dialect.** Its sections spaced at 22px with 13px sentence-case headings, while the MCP, LSP and suite details beside it use the shared `.block` (18px top margin) and `.blockHead` (11px uppercase, letter-spaced). Two dialogs in the same window read as two products.

## Decision

- **A rejected document carries a code, and the editor owns the sentence.** `ServerFormError` carries one of five codes (`not-object`, `service-key`, `policy-key`, `single-service`, `service-object`) plus the service key when the message names one. Its English `message` stays for logs and traces; the editor maps the code to a dictionary key and interpolates the key, so what renders is localized. An error that is not a `ServerFormError` still renders its own message, because that is host text this plugin cannot translate.
- **The hook detail reuses the shared block rhythm.** Its sections take `panel.block` and `panel.blockHead`; the local `.section` and `.sectionTitle` rules are gone, and the column no longer adds a 22px gap on top of the blocks' own margins.

## Alternatives considered

- **Translate the messages where they are thrown.** Rejected: `server-form.ts` is a pure parser with no translator, and giving it one would put copy in a module whose tests are about JSON shapes.
- **Keep English messages and prepend a Chinese label.** Rejected: that is exactly what the reader already saw.
- **Give the hook detail its own 18px/11px rules instead of reusing the panel's.** Rejected: identical values in two files drift; reuse is the only version that stays equal.

## Consequences

- A reader who pastes a malformed document reads one localized sentence per problem, not a Chinese label plus an English reason.
- A new rejection reason now needs a code and a dictionary entry, which the type system enforces.
- The hook detail's headings read at the same weight as every other detail dialog's.

## Verification

- `packages/market-ui/test/client-detail-editors.test.ts` and the server-config suites stay green; `pnpm run check:css` reports no unused class after the hook rules were removed.
- The four typechecks, `check:refactor` and the full suite pass.
