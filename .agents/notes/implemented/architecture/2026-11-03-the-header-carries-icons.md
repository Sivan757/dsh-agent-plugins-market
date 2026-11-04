# Agent Note: the header carries icons, and a menu opens from one

Status: implemented

## Problem

The shared panel header was built to hold two 24px icon buttons, with their labels on `title` and `aria-label`, so its width would not change with the language. One face broke that: the system-prompt page rendered its add control as a text button, because the action opens a menu of candidate file paths and a menu felt like it needed a word. The result was a header 4px taller than every other tab's and a toolbar that sat lower

as the language changed.

## Decision

- **Every header and toolbar action is a 24px icon button.** Its text lives on `title` and `aria-label`. An action that opens a menu is still a header action: the icon carries the menu, and the menu names the choices.
- **Text buttons belong to dialog footers and bodies**, where the surrounding sentence already says what the action does (save, cancel, delete).
- **The rule is written where the other client-style rules live** — `AGENTS.local.md` §客户端样式规范, next to the card anatomy. That file is gitignored by design, so this note is the tracked record of the same rule.
- **The one violation was fixed, not the rule bent**: `InstructionsPanel` renders the same icon button as every other panel and keeps its menu.

## Alternatives considered

- **Keep the text button and let the header grow.** Rejected: the header is shared, and its height changing between Chinese and English is exactly the inconsistency the rule removes.
- **Make every panel's menu-bearing action a text button for honesty.** Rejected: the menu labels the choices, so the trigger does not need to; a text trigger in the header costs width and height in one language and not the other.
- **Put the rule in a tracked style guide.** Considered and partly done: the tracked home is this note until a design document exists that owns it.

## Consequences

- The nine faces draw the same header height in both languages (measured: 28px).
- A new action that opens a menu gets an icon, and its choices are named in the menu.
- The local style section and this note must agree; a change to one updates the other.

## Verification

- Measured across the nine faces: every add control is icon-only, and the system-prompt header measures 28px with the icon where it measured 28px with the text button but a different height from the other tabs before the fix.
- `packages/market-ui/test/client-instructions-panel.test.ts` still passes with the icon trigger (it opens the same menu).
