# Agent Note: the dialog's focus behaviour is pinned, not left to luck

Status: implemented

## Problem

Keyboard reach was the one accessibility property never checked from the outside. Every detail dialog is a modal built on the host's `Modal`, so focus trapping is the host's job — but nothing in this repository asserted that a dialog takes focus when it opens, or that Escape gives it back to the card that opened it. A regression here is invisible to a pointer user and blocking to a keyboard user.

## What the check found

Measured in `market-dev` on the connectors panel: opening a row's detail moved focus to the dialog's close control (`focusInsideDetail: true`), Escape closed it, and focus returned to the opening card (`backOnCard: true`). The host's modal does what it should.

## Decision

- **Pin the behaviour where it belongs to a panel.** `mcp-status-render.test.ts` opens a detail, asserts the dialog contains the active element, dispatches Escape, and asserts the dialog is gone and the card is focused again. It passes in jsdom, so the guarantee holds in the suite rather than only in this report.

## Alternatives considered

- **Assert it once in a shared-ui test instead of per panel.** Rejected for now: the detail dialogs are separate components with their own open/close wiring, and the connector panel is the one every other service surface copies.

## Consequences

- A detail dialog that stops taking focus, or stops returning it, fails the suite.
- The four other dialogs remain unasserted; a later pass can copy the same three lines.

## Verification

- Live measurement as above; `packages/market-ui/test/mcp-status-render.test.ts` (15 tests) passes with the new case; the four typechecks, `check:refactor` and the full suite pass.
