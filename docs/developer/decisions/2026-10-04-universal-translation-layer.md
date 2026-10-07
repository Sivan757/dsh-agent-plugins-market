# Translation uses an ordered provider chain and stays out of model context

## Status

Accepted. This decision owns provider order, persistent cache identity and model isolation. [The reading and lifecycle decision](../../../.agents/notes/implemented/feature/2026-10-06-translation-reading-and-lifecycle.md) owns the language switch, document modes and cancellation. The [design document](../design/universal-translation-layer.html) summarizes the current design, not a runtime guarantee.

## Context

Upstream descriptions and documents can use a different language from the interface. A source is another repository, so translation cannot modify its files. Names remain identifiers for search, copying and invocation. Prose can have a separate translated view.

Translation cannot block the original content. Public endpoints can fail, and the deployment can lack a model route. The plugin must retain the authored text in either case.

## Decision

### Ordered fallback

The plugin tries Google Translate, Microsoft Translator and the configured default model, in that order. The original text is the final fallback, not a translation provider. The public endpoints require no user key. The model can consume the operator's quota, so the free endpoints come first.

[The chain implementation](../../../packages/market-translation/src/application/translation/chain.ts) defines deadlines of 3 seconds, 15 seconds and 30 seconds. Failure, timeout or an invalid batch trips that provider. Later batches skip it until translation is re-enabled, the cache is reset, or the process restarts. Caller cancellation stops the chain without tripping a provider or starting another fallback. These deadlines are limits, not measured response times or availability promises.

Batch text count, character count and concurrency are bounded. The English target uses a smaller source budget because Chinese-to-English output can expand. Output budgets are estimates, and the model adapter rejects truncated generations. No undocumented vendor payload limit is claimed.

### Persistent identity

[The cache key](../../../packages/market-translation/src/application/state/translation-cache.ts) is a SHA-256 digest of target, surface, entity id, role, source text and provider-chain identity. A record separately identifies the provider that produced its text. Changing a chain produces a different key instead of serving output from the old chain.

Entries do not expire. The same entity and text can reuse a persistent entry after restart. Editing text creates a new key, while the old entry remains until reset. A version change alone does not invalidate the text.

The localizer also shares known answers through an in-memory text index. That index includes target and chain identity but omits entity and role. It is not a persistent global content index. The first read of a new entity can still require translation after restart.

Reset clears the entries and invalidates queued and running work. Generation checks reject old responses, and serialized persistence orders old writes before deletion and new writes after it. Turning translation off cancels unfinished work but retains completed entries. [The lifecycle decision](../../../.agents/notes/implemented/feature/2026-10-06-translation-reading-and-lifecycle.md) records the rationale and cancellation limits.

### Display only

Descriptions and expanded document prose can be translated. Names, keywords and source files remain unchanged. The interface dictionary selects the target, either `zh` or `en`. The stored switch independently controls whether translation runs and appears.

Document translation uses a server-side Markdown abstract syntax tree, or AST, which represents document structure. Providers receive prose, not code, link destinations, math or raw HTML. The client renders one complete document through the host `MarkdownText` component. Structural details and known normalization limits belong to [the reading decision](../../../.agents/notes/implemented/feature/2026-10-06-translation-reading-and-lifecycle.md).

The plugin does not translate prompts or tool descriptions that enter model context. They retain the language their author used. Translating them changes model behavior and token use without a corresponding user-visible document change.

## Alternatives considered

- Client-side translation was rejected because it duplicates provider access and cannot use the server's persistent cache.
- Only free endpoints were rejected because the configured model provides another fallback and accepts domain-vocabulary instructions.
- Omitting provider-chain identity from the key was rejected because a changed chain would continue serving output from its predecessor.
- Per-entry upgrade flags were rejected because they add invalidation state to reproduce the cache miss that the key already expresses.
- Cache sharding remains deferred until reproducible write-cost measurements justify migration and concurrent-write complexity.

## Consequences

Public endpoints have no availability guarantee. Translation quality depends on the provider, and the model does not guarantee better output. The original remains readable during work and after failure.

The cache grows until reset and is written as one document. Reset prevents old requests from refilling it, but a later enabled read can start fresh work. Cancellation cannot guarantee that a remote provider stops computation it already received.

## Verification ownership

[Chain tests](../../../tests/translation-chain.test.ts), [localizer tests](../../../tests/translation-localizer.test.ts) and [cache tests](../../../tests/translation-cache.test.ts) cover fallback, cancellation, reuse and persistence. [Document tests](../../../tests/translation-document.test.ts) cover the shared catalog path. These references identify coverage and do not assert a test run by this documentation edit.

## Revisit when

- A public endpoint requires a key, changes its limits, or becomes unavailable.
- Measured cache writes justify sharding.
- A new interface dictionary changes supported translation targets.
- A new surface needs translated prose or changes what enters model context.
