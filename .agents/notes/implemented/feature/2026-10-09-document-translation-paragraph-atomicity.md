# Agent Note: Publish document translations as complete paragraphs

Status: implemented

## Problem

A fixed character slice can cut a sentence before its context arrives. Translating formatting leaves separately also separates words that belong to one sentence. Publishing completed slices beside untranslated slices makes one paragraph look finished when only part of it is translated.

The reader needs a stable unit that preserves meaning, keeps successful work reusable, and reports failure without changing the source. A paragraph provides that unit. Provider requests still need bounded size and duration.

## Decision

### Keep natural paragraphs intact where they fit

[The server transform](../../../../packages/market-translation/src/application/translation/document.ts) extracts prose from each Markdown paragraph, heading or table cell. A payload of at most 1,600 UTF-16 code units travels whole. This uses JavaScript string length after inserting AST markers, before provider masking. It is not a token, grapheme or vendor-request limit.

For longer payloads, `Intl.Segmenter` identifies complete sentence segments and the transformer groups those segments within the same limit. It does not split a sentence by character count. If any sentence exceeds the limit, the entire paragraph stays original and reports failure. Retrying unchanged text cannot remove that size limit.

Code, link destinations, math and raw HTML remain outside prose translation. The client still renders one complete document through host `MarkdownText`. This strategy does not add a browser parser, an AI summary, or separate context requests.

### Publish only a complete paragraph

[The localizer](../../../../packages/market-translation/src/application/translation/localizer.ts) stores successful transport parts internally but retains the original paragraph until every required part has a cached answer. A stopped request is not evidence of success. Parts already in the target language retain their original text. The localizer restores whitespace around sentence groups when assembling the paragraph.

A later read assembles and caches the full paragraph only after every required part is confirmed. The document then replaces that paragraph as one unit. Other completed paragraphs can appear while this paragraph remains original. The aggregate key uses the full paragraph payload, not its position, so inserting a neighboring paragraph does not invalidate it.

The response uses `pending` for paragraph, heading and table-cell units with queued or running work. Optional `failed` counts units that cannot currently complete. A unit can contribute to both counts when one part is running and another is failed. Invalid reconstructed markers or empty prose also report failure. Neither an oversized sentence nor failed work becomes a successful empty translation.

### Retry complete inputs, not formatting leaves

[The provider wrapper](../../../../packages/market-translation/src/runtime/host/translation-providers.ts) gives damaged structured prose one same-provider retry of the complete original transport input. It retries at most 20 inputs from the original batch in one nonrecursive call. The retry keeps the original signal and outer deadline. Formatting leaves never become independent translation requests.

Only source inputs with AST markers and damaged answers that still contain prose qualify. Empty or marker-only output does not trigger this repair. Valid answers retain their slots when a mixed result returns within the original deadline. Unrepaired slots remain failures rather than cached source text. If all slots fail, the chain can try its next provider. Deadline expiry affects the entire batch, and caller cancellation stops the batch without further fallback.

### Version the paragraph cache explicitly

Paragraph aggregates use `paragraph-sentences-v2`, and internal transport parts use `paragraph-transport-v2`. The localizer combines strategy and provider-chain identity before passing it to the unchanged persistent-key function. The in-memory text index uses the same strategy separation.

Old document slices do not satisfy either v2 strategy, even if their text matches. Reopening a previously translated document therefore incurs a one-time retranslation cost, which can reach the configured model and consume quota. Old entries remain on disk until a cache reset. Description requests omit strategy and keep the legacy 800-unit splitter, packing and cache keys unchanged.

### Retry failure state without deleting successes

`retry: true` reaches `TranslationService.translateDocument`, which resets tracked retry budgets for the named document and the shared provider breaker. It does not delete successful paragraphs or transport parts. Retry budgets are indexed by text, so identical shared text can also benefit. This is not strict isolation of every failure to one entity.

The [reading and lifecycle note](2026-10-06-translation-reading-and-lifecycle.md) owns the filename-row controls and replacement spinner. The failed mode offers retry while original text remains readable. A warning reports an incomplete paragraph, not proof of a particular provider defect.

## Alternatives considered

**Keep fixed 800-unit document slices.** Rejected: the boundary can split a word or sentence and change the meaning presented to a provider. The legacy description splitter remains separate for cache compatibility.

**Repair damaged markers by translating each formatting leaf.** Superseded: a leaf boundary describes formatting, not meaning. Whole-input retry preserves sentence context and does not guess missing text from a damaged answer.

**Publish each transport part immediately.** Rejected: this mixes original and translated fragments inside one natural paragraph. Internal part caching retains progress without presenting a partial paragraph as complete.

**Reuse old document cache entries under the new strategy.** Rejected: those entries can reflect hard-cut or leaf-repair semantics. Explicit strategy identity accepts one-time retranslation rather than presenting old results as paragraph-confirmed output.

**Translate an oversized sentence by force, or add a separate summary request.** Rejected: forced slicing loses sentence context, while an additional model request changes cost and input meaning. The current path keeps the paragraph original with an explicit failure.

## Consequences

Paragraph publication is atomic, meaning that each paragraph changes as one unit. The reader waits longer for a paragraph with several transport parts, but it can still read the original. Sentence grouping limits context across groups. It does not guarantee linguistic quality or prevent output truncation, and provider deadlines still bound each attempt.

The 1,600-unit source bound includes AST markers but not later masking expansion. Existing target-specific batch and output budgets remain separate safeguards, not mathematical guarantees about provider output. The v2 cache separation costs one retranslation for previously translated documents while preserving description caches.

## Testing

[Document chunk tests](../../../../tests/document-chunks.test.ts) cover intact short paragraphs, sentence grouping, markers, emoji and oversized sentences. [Localizer tests](../../../../tests/translation-localizer.test.ts) cover hidden partial results, completed aggregates, restart reuse, strategy separation and targeted retry. [Service tests](../../../../tests/translation-document.test.ts) cover failed paragraphs and retry without deleting successes.

[Reader tests](../../../../tests/client-document-translation.test.ts) cover header controls, selected-icon loading, failures and retry requests. These references name coverage owners. This documentation change does not claim a live-provider quality result or a completed browser validation.

## Related

This note partially supersedes [reading and lifecycle](2026-10-06-translation-reading-and-lifecycle.md) for document segmentation, publication and cache identity. That note retains language controls, UI composition, cancellation and persistence ordering. It also supersedes the formatting-leaf repair strategy in [the universal layer](2026-10-04-universal-translation-layer.md), which retains provider order, masking and model isolation.

[The chunking note](2026-10-05-document-translation-chunked-and-lazy.md) retains request-budget, document-role and identity-only-read rationale. Its description splitter remains unchanged. No existing note is fully superseded or archived.
