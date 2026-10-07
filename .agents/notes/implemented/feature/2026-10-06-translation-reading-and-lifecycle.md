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

[The shared reader](../../../../packages/market-ui/src/ui/DocumentTranslation.tsx) mounts inside an expanded document and starts the translation read there. Compact icon tabs at the upper-right select original, translated or bilingual text. The host `SegmentedTabs` retains keyboard navigation, with bilingual selected by default. Localized labels remain available to assistive technology and on hover.

Unexpanded documents do not start translation. Original mode stops reader revalidation and renders authored text. Closing a reader does not cancel all server work for that document.

The server response keeps `text` and `pending` and adds optional `bilingualText`. Pending or failed segments retain their original prose. The reader displays one complete document through the host `MarkdownText`, not separate renderers for each paragraph.

Direct suite and user-entry details also return optional `translationPending` for unfinished description work. Clients reuse `pollUntilTranslated` and stop at zero, disable or unmount, rather than retrying a guessed number of times.

### Failed reads stop loading and offer retry

[Document polling](../../../../packages/market-ui/src/ui/translation-settle.ts) reports a read failure through `onError` and stops without treating pending work as complete. The reader hides loading, retains the original or partial translation, and offers Retry translation. Retry starts a fresh read with the same document and target. Closing the reader or selecting original mode suppresses late errors.

[Translation POST reads](../../../../packages/market-ui/src/api.ts) use the 15-second read deadline, not the 600-second mutation deadline. The request races that deadline through response-body consumption, so received headers alone do not end the timer. This bounds each HTTP read, not total translation work.

### Transform document structure on the server

[The document transform](../../../../packages/market-translation/src/application/translation/document.ts) uses mdast with GFM and math extensions. An abstract syntax tree, or AST, represents document structure. The transform collects text leaves inside each paragraph, heading or table cell. Ordered placeholders preserve the positions of inline nodes. Code, inline code, link destinations, math and raw HTML do not enter provider input. Missing, duplicated or reordered placeholders are not accepted directly. The provider adapter can attempt [bounded repair](2026-10-04-universal-translation-layer.md#masking) before returning a valid translation or leaving the original paragraph. An empty inline text leaf is allowed, but the paragraph must contain non-whitespace text after placeholders are removed.

A document paragraph is not combined with its neighbors to fill a request. Only an oversized paragraph splits into bounded segments. Cache identity includes segment text, not paragraph position. Inserting a document paragraph leaves unrelated segment keys unchanged. Descriptions retain the legacy splitter, including cross-paragraph packing and authored separators, to preserve historical description cache keys.

Bilingual paragraphs place translated text after the original with a line break. Headings appear as original and translated headings. Tables appear as a complete original table followed by a translated table, not cell-by-cell pairs. Lists, references and footnotes remain within the same document tree. Serialization can normalize Markdown whitespace and markers. The original mode retains source text, and no mode rewrites the source file.

### Disable keeps completed cache entries

[The localizer](../../../../packages/market-translation/src/application/translation/localizer.ts) receives configuration changes through `onEnabledChanged()`. Disable increments the generation, drops queued work and aborts active batches. [The provider chain](../../../../packages/market-translation/src/application/translation/chain.ts) tests cancellation before each fallback and after each response. Caller cancellation does not trip a provider. Completed cache entries remain available for a later enabled read.

A provider can ignore an abort signal and finish remote computation. The chain races provider work against its deadline and caller cancellation, so neither waits for provider cooperation. Deadline expiry permits fallback, but caller cancellation stops the chain. The generation test rejects stale responses. Re-enable resets failure state but does not scan or pretranslate documents. New reads request missing work.

[The model adapter](../../../../packages/market-translation/src/runtime/host/llm-translator.ts) passes cancellation into capability lookup and tests it again before starting a stream. A capability lookup that completes after cancellation cannot start new model generation.

### Reset orders persistence and rejects old work

Reset clears entries, the text index, retries and pending work. It also increments the generation. Every completion and cleanup compares its captured generation with the current one. An old batch cannot write a result, remove a new owner or decrement a new batch count.

The localizer serializes persistence as old flush, deletion, then new flush. Generation tests alone cannot stop an old disk write from restoring cleared entries. The persistence order supplies that second guarantee. An enabled read after reset can create fresh entries.

Persistent keys retain the target, surface, entity id, role, text and chain identity. The same document shares segment records between the user panel and Market detail. The separate text index remains in memory, so this is not a persistent global cache of every repeated string.

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

Tables retain their layout but use whole-table comparison. Long paragraphs split at the source budget and can lose translation context at that boundary. The English batch budget is smaller because translated output can expand. Neither source budgets nor cancellation guarantee a remote provider stops or avoids truncation.

## Testing

[Document chunk tests](../../../../tests/document-chunks.test.ts) and [catalog translation tests](../../../../tests/translation-document.test.ts) cover protected content, structure, stable segments and English translation. [Reader tests](../../../../tests/client-document-translation.test.ts), [user-detail tests](../../../../tests/client-user-entry-detail-translation.test.ts) and [Market tests](../../../../tests/market-detail-document-translation.test.ts) cover expansion and reading modes.

[Polling tests](../../../../tests/translation-settle.test.ts) and [reader tests](../../../../tests/client-document-translation.test.ts) cover read failures, retained partial results and retry. [Transport timeout tests](../../../../tests/client-api-timeout.test.ts) cover stalled response bodies. [Chain tests](../../../../tests/translation-chain.test.ts) cover providers that ignore cancellation and late model capability lookup. These cases do not establish the cause of a live document that stays pending.

[Localizer tests](../../../../tests/translation-localizer.test.ts) cover generation isolation, persistence order, completed-cache retention and target budgets. [Chain tests](../../../../tests/translation-chain.test.ts) cover cancellation before fallbacks. [Menu tests](../../../../tests/client-menu-row-faces.test.ts) cover finite open-menu refresh, close cleanup and stale responses. These are verification owners, not a claim that this documentation edit ran behavior tests or reproduced live provider results.

## Related

This note partially supersedes [the disclosure-reading decision](2026-10-05-document-translation-chunked-and-lazy.md) and [the language-as-gate decision](2026-10-05-translation-default-follows-language.md). They remain active for bounded requests, role compatibility and the absent-setting distinction. The earlier attribution of the disclosure choice to the user is not evidence for this decision.

[The universal layer](2026-10-04-universal-translation-layer.md) retains provider order, persistent keys and model isolation. [The Market route](../architecture/2026-10-05-market-document-translation-route-and-identity.md) retains separate lookup scopes with shared document identity. No note is fully superseded or archived by this change.
