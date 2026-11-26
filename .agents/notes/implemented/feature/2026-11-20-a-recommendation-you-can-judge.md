# Agent Note: a recommendation you can judge

Status: implemented

## Problem

The owner photographed the marketplace's "recommend suites to install" dialog showing a red `This operation was aborted` beside its buttons and raised four things: whether a recent change had broken the recommendation; the redundant guidance text around it; the way the dialog only ever offered its whole answer ("apply"), never a row a reader could read and drop; and where an AI button belongs in an action row.

Two failures were hiding behind the one sentence. The first is the dialog's own: the sentence was the browser's `AbortError`, produced by the auxiliary call's 60-second budget and echoed verbatim because the client had no sentence for it. The second is the provider's: in this profile the host-backed call is refused outright with `magpie-responses API error (400): Anyrouter: prompt_cache_key is required`. Neither is caused by a recent plugin change; `AI_ANSWER_LIMITS.timeoutMs` and the host's auxiliary call path predate this round, and the plugin may not change the host.

A third fact made the first failure likelier than it needed to be. An install recommendation asked the server for the catalogue's own rows, capped at 1,000, and wrote every one of them into the prompt before a model with a 900-token answer budget and a 60-second clock could pick from it.

## Decision

- **The recommendation offers the rows the intent touches, never the catalogue.** The route ranks the suites whose name, description or id contain a word from the intent (two-character slices count for CJK text) and then fills up to `AI_PRESET_LIMITS.modelCandidates` (120). A narrow brief sees a short list, a broad one still sees a wide choice, and a thousand-suite catalogue no longer becomes a thousand-line prompt.
- **Each offered row carries one line of what it is.** The candidate gained an optional description, capped to one line in the prompt, so the model chooses from facts rather than from names alone.
- **The answer is a list the reader judges.** Every recommended row renders as the shared resource card: name, version, owner tag, description, counts and source, kept by the card's switch and opened by its click. Every row the answer names starts kept. Applying sends only the rows still kept, and the apply button stays disabled when none is.
- **An AI action leads the action row.** The dialog's button order is 生成建议 / 取消 and later 应用 / 取消: the AI action is the row's first button, ahead of the human ones. That is now a standing rule for every dialog that offers one.
- **A call that outlived its budget is its own failure.** The auxiliary call marks the timeout, the model port throws `ai-timeout`, the route answers 504, and the dialog says 模型这次没能在时限内答完，可以直接重试 in the reader's language through the shared `aiFailureText` helper (which the diagnosis block now uses too).
- **The guidance text is one line per dialog.** The two long hints became `说明用途，模型从扫到的市场套件里挑选；安装仍需你确认。` and its preset twin; the intent field gained its own label (用途/Purpose) instead of borrowing the dialog title as its aria-label.

## Alternatives considered

- **Leave the 1,000-row prompt and raise the timeout.** Rejected: the prompt is the slow part, and raising the budget spends the reader's money on a model reading rows it will never pick.
- **Filter the catalogue to exact keyword matches only.** Rejected as the primary mechanism: an intent phrased differently from the catalogue's wording would offer nothing. Ranking first and filling to the cap keeps recall while bounding the prompt.
- **Ask the model for ids only, then resolve descriptions in the browser after the answer.** Rejected: the reader judges the pick before applying, and the description belongs in the prompt that made the pick; resolving it later would show two different sets of facts.
- **Keep the single "apply" button and list the picks as text.** Rejected by the owner directly: a recommendation you cannot edit is an instruction.
- **Put the AI action at the trailing edge beside 取消.** Rejected: the owner made AI-first a standard, and the reason holds — the AI button is the reason the dialog exists, and a reader scanning a row should meet it first.
- **Fix the provider refusal inside the plugin.** Rejected: `prompt_cache_key` belongs to the host's provider route. The plugin may not change the host, so the dialog surfaces the provider's own words and the reader's environment decides whether the call can run.

## Consequences

- A recommendation that answered too slowly now names the timeout as a retry, in the reader's language, instead of echoing the browser.
- The provider refusal in this profile stays visible and stays the provider's sentence: the feature cannot answer there until that route supplies the parameter it demands. The dialog no longer hides that behind a generic failure.
- Ranking is lexical: a suite whose description does not use the intent's words can rank low and drop out of the 120. The list still holds the catalogue's own order after the matching rows, so a broad intent keeps the full choice.
- `AiSelectionModal.onApply` gained the ids the reader kept, so the preset manager's canonical closure and the market's narrowed list both build from the selection rather than from the model's raw answer.
- The rows keep the shared card anatomy every resource list in the plugin renders: the name row, the optional description row, and one control in the action cluster, inside a scrolling list. [The suggestion-cards fix](../bug-fix/2026-11-24-the-preset-entry-shows-and-its-suggestions-are-cards.md) owns the markup.
- The timeout family and the ranked candidate list stay route behavior with no automated test: the unit suite this note once cited was deleted when the Playwright suite replaced it, and the Web UI suite is the only automated surface.

## Verification

- `pnpm run test` green: the Web UI suite boots a real host, and `e2e/presets.spec.ts` answers the suggestion dialog's one request with a fixed payload, asserting one complete card, its switch flipping the card state, and the enabled create action.
- Live in `market-demo`: the dialog renders 用途 as the intent label, two footer buttons with 生成建议 first, and the trimmed description; submitting it answered with the provider's refusal, shown under the title (the red block) rather than in the footer row. The dialog's own answer path could not be exercised end to end in this profile because the provider refuses the auxiliary call; that is recorded above as an environment fact, not as a passing case.
