# Agent Note: one read-failure presentation, and a preset manager that matches the panels

Status: implemented

## Problem

The owner pointed at three inconsistencies in a row. Two of them are one defect each, and the third was two.

**A failed read looked different in every panel.** The connector and language-engine panels drew a red line with a ghost-button retry; instructions drew an error line with the raw message and a separate one for a payload-reported error; output styles prefixed a title; hooks used `role="status"` instead of `role="alert"`; the market raised a toast that disappeared while the list stayed empty; the user panels showed nothing at all and only explained "no data" in the list area. A first read that never landed had a third shape in two panels (a title inside the empty box), and only two panels said 读不到状态 in the list.

**The preset manager did not look like a settings panel.** It is a modal, so it carries no tab row of the settings page, but it also had no subtitle, its read failure appeared inside a dropdown menu label, and its status line was an ad-hoc `inlineStatus`.

## Decision

- **One band component.** `ReadFailed` (in `ui/panel.tsx`) renders `role="alert"`, the localized cause, and the retry beside it; `panel.module.css` owns the one rule. Every panel that reads something uses it: connectors, language engine, instructions, output styles, hooks, skills/commands/experts, and the market, whose toast became a persistent line with a retry.
- **Every route fails through one typed error.** Four routes bypassed `getJson` and threw `new Error('output styles failed: 502')`, so those panels showed an English label and a bare code while their neighbours showed a sentence. `statusError` builds a `RequestFailedError`, which now carries the host's own reason when the host gave one; the panel renders that reason verbatim, and the localized sentence with the status otherwise.
- **One placeholder rule.** A read that failed has no rows because nothing was read, so the list says `statusUnreadable` instead of its "nothing here" copy. Panels that never got a payload draw the same band and the same placeholder instead of a shape of their own.
- **The retry label is shared.** `mcpRetry` became `readRetry`, because every panel uses that word now.
- **The preset manager gets the panel header.** It carries the subtitle line every settings page opens with (「每个预设保存一组启停选择，选中的那个用于本会话。」) and draws the shared band when its read fails, instead of hiding the failure in a menu.

## Alternatives considered

- **Keep a toast for the market.** Rejected: a toast that expires leaves an empty market and no explanation, which is the defect this pass removes.
- **Give each panel its own wording around the shared style.** Rejected where the words were a title plus a raw message; the cause is what a reader needs, and the panel's header already says which surface they are looking at.
- **Rebuild the preset manager as a settings section.** Rejected for now: it is session-scoped and opens over the composer, so it stays a modal; what it lacked was the panel's header line and the shared failure line, not the tab row.

## Consequences

- A failure reads the same on every surface: one line, one colour, the cause, the retry.
- A surface whose read failed no longer claims its set is empty, in any panel.
- The preset manager explains itself and reports its failures where the other panels do.

## Verification

- `packages/market-ui/test/client-output-styles-panel.test.ts` asserts the band (`role="alert"`, the cause, the retry label) and that the list says the state is unknown rather than empty.
- `packages/market-ui/test/mcp-status-render.test.ts` keeps the same assertions for the connector panel, and the instructions panel test covers its scope line and placeholders.
- The four typechecks, `check:refactor` (including `check:css` with 20 of 20 sheets) and the full suite pass.
