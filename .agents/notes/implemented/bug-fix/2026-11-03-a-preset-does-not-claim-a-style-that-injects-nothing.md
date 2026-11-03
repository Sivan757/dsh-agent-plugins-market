# Agent Note: a preset does not claim a style that injects nothing

Status: implemented

## Problem

The preset manager's output-styles face had two wrong facts. The owner tag read 用户 for a style a suite brought, because the tag decided ownership with the child-row test and a style never carries a `suiteResourceId`. And the coverage line counted a carried style as present whether or not its text had ever been captured, so a preset could claim 「风格 X」 while the style injected nothing.

## Decision

- **The inventory marks an uncaptured suite style** with `unavailableReason: 'style-uncaptured'`, which the manager maps to a sentence naming the fix: capture it on the Output styles page. An unknown code would have been printed raw, so the mapping ships with the code.
- **Ownership comes from the row's own source** for styles: `source === 'user'` is a style a person wrote, anything else came from a suite.
- **The summary says whether the style takes effect**: `presetCoverage` reports `styleInEffect`, and the line reads 风格 X（未抓取，暂不生效） when it does not.

## Alternatives considered

- **Hide an uncaptured style from the preset manager.** Rejected: a preset may legitimately carry one, and hiding it would make the preset's contents unreadable.
- **Count the style as absent instead of pending.** Rejected: the preset does carry it; the fact a reader needs is that it does not inject yet.

## Consequences

- A preset's contents never disagree with what the prompt receives.
- The manager's style rows name the one action that makes them real.

## Verification

- Live in `market-dev`: the manager's Output styles face reads `explanatory-output-style · 套件 · 不可用 · 这个套件风格还没有抓取到文本…`, where the tag was 用户 before.
- `preset-coverage.test.ts` pins `styleInEffect` for a captured and an uncaptured style.
- `client-extension-presets.test.ts` pins the owner tag against the dictionary's own values.
- The full suite passes (2523).
