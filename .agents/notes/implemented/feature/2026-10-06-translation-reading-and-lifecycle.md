# Agent Note: Translation separates language, reading mode and work lifetime

Status: implemented

## Problem

A language-derived default cannot decide whether a user can translate. English defaults to off, but an explicit on must translate Chinese into English. A second disclosure also prevents an expanded document from opening directly in paragraph-by-paragraph bilingual mode.

Translation work outlives a client read. A closed display switch must stop queued work and later provider fallbacks without deleting completed translations. Cache reset needs a stronger guarantee: old calls and disk writes cannot restore the entries it removes.

## Decision

### Language and display are independent

[The configuration contract](../../../../packages/market-contracts/src/contracts/settings.ts) resolves the interface dictionary to `zh` or `en`. Chinese defaults to on and English to off. A stored boolean wins until the user restores the default. The default predicate is not an execution gate. The localizer accepts Chinese prose for an English target, including Chinese within mostly English text.

Names and keywords remain identifiers. Translated descriptions and document prose are display-only. Prompts and tool descriptions that enter model context keep their authored language.

### Expanded documents start in bilingual mode

[The shared reader](../../../../packages/market-ui/src/ui/DocumentTranslation.tsx) owns reading state and gives controls and body to its caller through a render callback. [DetailRow](../../../../packages/market-ui/src/ui/DetailRows.tsx) places `headerActions` beside the filename as siblings of the disclosure button. Mode buttons are never nested inside that button, and selecting a mode does not collapse the document. Host `SegmentedTabs` provides keyboard navigation and exposes localized hover and accessibility labels. `ui/reading-mode.ts` holds one module-level mode for every document: original is the start, and a click changes every open reader.

Document groups opt into `documentHeaders`. Their frame uses `overflow: clip`, so the enclosing dialog remains the scroll container. Only expanded document headers use `position: sticky`, with an opaque theme background. The document boundary releases the header at its end. Collapsed rows, MCP, hooks and LSP keep their existing layout.

Unexpanded documents do not start translation. Original mode stops reader revalidation and renders authored text. Closing a reader does not cancel all server work for that document.

The response carries `text`, `pending`, optional `bilingualText` and optional `failed`. Pending or failed paragraphs retain their original prose, and `failed` is not treated as successful translation. One host `MarkdownText` still renders the complete document. [The paragraph strategy](2026-10-09-document-translation-paragraph-atomicity.md) owns publication and caching.

Direct suite and user-entry details also return optional `translationPending` for unfinished description work. Clients reuse `pollUntilTranslated` and stop at zero, disable or unmount, rather than retrying a guessed number of times.

### Failed reads stop loading and offer retry

While reading or translating, a spinner replaces the selected mode icon rather than adding body loading text. [Document polling](../../../../packages/market-ui/src/ui/translation-settle.ts) stops after reporting a read error, while `failed` reports paragraphs retained as original. A warning replaces the selected icon and exposes the error on hover. Activating that selected warning mode sends `retry: true`, which resets this document’s tracked failure budgets and the shared provider breaker without clearing caches. Completed paragraphs remain available, but retry cannot make an oversized sentence fit. Closing the reader or selecting original mode suppresses late errors.

[Translation POST reads](../../../../packages/market-ui/src/api.ts) use the 15-second read deadline, not the 600-second mutation deadline. The request races that deadline through response-body consumption, so received headers alone do not end the timer. This bounds each HTTP read, not total translation work.

### Transform document structure on the server

[The document transform](../../../../packages/market-translation/src/application/translation/document.ts) uses mdast with GFM and math extensions. An abstract syntax tree, or AST, represents document structure. It collects text leaves within paragraphs, headings or table cells and uses ordered placeholders to retain inline positions. Code, link destinations, math and raw HTML stay outside provider translation. Empty inline fragments are allowed, but the paragraph must retain prose and complete ordered markers. [The paragraph strategy](2026-10-09-document-translation-paragraph-atomicity.md) supersedes fixed-character slices and formatting-leaf repair.

Document paragraphs are never combined with neighbors. Oversized paragraphs split only between complete sentences, and an oversized single sentence leaves its paragraph original with a failure. The paragraph is published and stored as an aggregate only after all parts finish. Descriptions retain the legacy splitter and historical keys, including cross-paragraph packing and authored separators. [The paragraph strategy](2026-10-09-document-translation-paragraph-atomicity.md) documents versioning and the one-time retranslation cost.

Bilingual paragraphs place translated text after the original with a line break. Headings appear as original and translated headings. Tables appear as a complete original table followed by a translated table, not cell-by-cell pairs. Lists, references and footnotes remain within the same document tree. Serialization can normalize Markdown whitespace and markers. The original mode retains source text, and no mode rewrites the source file.

### Disable keeps completed cache entries

[The localizer](../../../../packages/market-translation/src/application/translation/localizer.ts) receives configuration changes through `onEnabledChanged()`. Disable increments the generation, drops queued work and aborts active batches. [The provider chain](../../../../packages/market-translation/src/application/translation/chain.ts) tests cancellation before each fallback and after each response. Caller cancellation does not trip a provider. Completed cache entries remain available for a later enabled read.

A provider can ignore an abort signal and finish remote computation. The chain races provider work against its deadline and caller cancellation, so neither waits for provider cooperation. Deadline expiry permits fallback, but caller cancellation stops the chain. The generation test rejects stale responses. Re-enable resets failure state but does not scan or pretranslate documents. New reads request missing work.

[The model adapter](../../../../packages/market-translation/src/runtime/host/llm-translator.ts) passes cancellation into capability lookup and tests it again before starting a stream. A capability lookup that completes after cancellation cannot start new model generation.

### Reset orders persistence and rejects old work

Reset clears entries, the text index, retries and pending work. It also increments the generation. Every completion and cleanup compares its captured generation with the current one. An old batch cannot write a result, remove a new owner or decrement a new batch count.

The localizer serializes persistence as old flush, deletion, then new flush. Generation tests alone cannot stop an old disk write from restoring cleared entries. The persistence order supplies that second guarantee. An enabled read after reset can create fresh entries.

Persistent keys include target, surface, entity id, role, text and chain identity. Documents also use strategy identity to separate complete paragraph results from old slices. User panels and Market detail share paragraph records for the same document. The text index remains in memory rather than forming a global persistent content cache.

### Open menus revalidate with a limit

[The menu description source](../../../../packages/market-ui/src/menu-row-faces.ts) returns current descriptions immediately. A real candidate request supplies `sessionId`, and `sessions.scope` borrows its existing scope. Public `inputTriggers.sessionOf` provides the controller. An open menu performs at most 40 follow-up reads, at least 1.5 seconds apart. Only changed description maps trigger `refreshOpenMenu()`, which prevents refresh recursion. Closing the menu or disabling translation stops timed reads. There is no permanent background poll.

The 40 ticks span about 60 seconds, plus read time. Translations that finish after this window need a later candidate request. A missing public controller falls back to candidate-triggered reads. New targets clear old descriptions, and stale responses cannot overwrite newer reads.

## Alternatives considered

**Keep the second translation disclosure.** Superseded: the selected reading experience starts translation when the document opens and defaults to paragraph-by-paragraph bilingual reading. Document expansion remains the demand boundary.

**Add a Markdown parser and renderer to the browser.** Rejected: published `@deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2` exposes whole-text rendering, not an AST insertion hook. The server can transform Markdown while the client retains one host renderer. No host modification is required.

**Inject translated nodes into the DOM.** Rejected: [read-frog](https://github.com/mengxi-ream/read-frog) manages page wrappers through `translation-modes.ts` and `translation-insertion.ts`. That browser-extension approach does not preserve React ownership here. The server returns Markdown instead of mutating rendered nodes.

**Pack neighboring paragraphs into one cached unit.** Rejected: a short insertion changes later groups and causes unrelated translation work. Transport batching can group independent units without changing their keys.

**Treat disable as cache deletion, or clear only the entry map.** Rejected: disable must preserve paid results. Clearing only memory does not stop old requests or disk writes from restoring removed entries.

## Consequences

The reader gains direct bilingual comparison without a second client renderer. Server parsing and serialization add work for each document read. The AST supports GFM and math, but it does not promise every private host grammar extension or byte-identical translated Markdown.

Tables still use whole-table comparison. Sentence grouping reduces cross-sentence context for long paragraphs, while oversized single sentences remain original. The English batch budget is smaller because output can expand. Source budgets and cancellation do not guarantee that a remote provider stops or avoids truncation. [The paragraph strategy](2026-10-09-document-translation-paragraph-atomicity.md) owns those limits.

## Testing

[Document chunk tests](../../../../tests/document-chunks.test.ts) and [catalog translation tests](../../../../tests/translation-document.test.ts) cover protected content, structure, stable segments and English translation. [Reader tests](../../../../tests/client-document-translation.test.ts), [user-detail tests](../../../../tests/client-user-entry-detail-translation.test.ts) and [Market tests](../../../../tests/market-detail-document-translation.test.ts) cover expansion and reading modes.

[Polling tests](../../../../tests/translation-settle.test.ts) and [reader tests](../../../../tests/client-document-translation.test.ts) cover read failures, retained partial results and retry. [Transport timeout tests](../../../../tests/client-api-timeout.test.ts) cover stalled response bodies. [Chain tests](../../../../tests/translation-chain.test.ts) cover providers that ignore cancellation and late model capability lookup. These cases do not establish the cause of a live document that stays pending.

[Localizer tests](../../../../tests/translation-localizer.test.ts) cover generation isolation, persistence order, completed-cache retention and target budgets. [Chain tests](../../../../tests/translation-chain.test.ts) cover cancellation before fallbacks. [Menu tests](../../../../tests/client-menu-row-faces.test.ts) cover finite open-menu refresh, close cleanup and stale responses. These are verification owners, not a claim that this documentation edit ran behavior tests or reproduced live provider results.

## Related

This note partially supersedes [the disclosure-reading decision](2026-10-05-document-translation-chunked-and-lazy.md) and [the language-as-gate decision](2026-10-05-translation-default-follows-language.md). They remain active for bounded requests, role compatibility and the absent-setting distinction. The earlier attribution of the disclosure choice to the user is not evidence for this decision.

[The paragraph strategy](2026-10-09-document-translation-paragraph-atomicity.md) partially supersedes this note’s slice publication and caching rules. This note retains header interaction, independent target and display controls, and lifecycle ownership. [The universal layer](2026-10-04-universal-translation-layer.md) retains provider order and model isolation. [The Market route](../architecture/2026-10-05-market-document-translation-route-and-identity.md) retains lookup scopes and shared identity. None is fully superseded or archived.
