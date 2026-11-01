# Agent Note: the English surface was audited, and left as it is

Status: implemented

## Problem

Localization had never been verified from the other side. Every earlier pass translated copy as it was written, but nobody had opened the product in English and looked: a missing translation silently falls back to the Chinese source, and an English label is longer than its Chinese counterpart, which is exactly the kind of text that breaks a one-line header or a narrow control.

## What the audit found

The host was switched to English and all nine tabs walked in `market-dev`.

- **No Chinese in the product's own copy.** The only CJK on screen was two descriptions from a Chinese-authored suite — user content, correctly shown as authored.
- **No control truncates.** Every truncated element was a container (the source strip scrolls), a screen-reader-only span, or a suite id on a card, which already carries the host's hover card with the full text.
- **The geometry does not move.** Every panel header measured 28px and every toolbar y=162 (market 218, its source strip) — identical to the Chinese pass, so the longer English labels do not reflow a single row.

## Decision

- **Pin it instead of restating it.** `client-locales.test.ts` gains one assertion that no key in `en` or `extensionPresetsEn` contains a CJK character. The manual pass proves the state; the test keeps the next translation from silently falling back.
- **Change nothing else.** The audit produced no defect to fix, and inventing one to show work would be worse than reporting a clean result.

## Alternatives considered

- **Add the sibling language to the test as well** (catching Chinese copy that leaks into the English _UI_ rather than the dictionary). Rejected: the two dictionaries are the only source of our copy — a surface that renders a literal instead of a key is covered by the bilingual rule in AGENTS.md and by review, not by a character class.
- **Screenshot each tab in English.** Kept for the audit itself, not for the repository: the measured geometry is the durable evidence.

## Consequences

- A new English string with Chinese characters now fails the suite immediately.
- The next localization question can start from "the other language renders and fits".

## Verification

- Live: all nine tabs in English — no CJK in product copy, 0 truncating controls, headers 28px and toolbars 162/218 as in Chinese. The host language was restored to 中文 afterwards, because that setting is host-level rather than profile-level.
- `packages/market-ui/test/client-locales.test.ts` (5 tests) passes with the new assertion.
- The four typechecks, `check:refactor` and the full suite pass.
