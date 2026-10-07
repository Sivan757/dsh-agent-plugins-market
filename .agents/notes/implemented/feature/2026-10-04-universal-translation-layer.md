# Agent Note: Universal translation layer across the six surfaces

Status: implemented

## Problem

The market renders an upstream catalog authored in English, so a `zh` deployment shows a Chinese interface wrapped around English data. Suite descriptions, skill, command and agent-persona descriptions, and MCP per-tool descriptions all reach the panel verbatim. [The description-localization note](2026-10-03-description-localization.md) closed that gap for one field on one surface; the same defect stood on every description the other surfaces render.

The catalog is not ours to edit. A source is a checkout of someone else's repository, refreshed on every update, so no translation can be written back into a manifest. It has to live beside the catalog and be applied on the way out.

The layer provides translation without a user key, but networks and providers can fail. Authored text must remain readable. Prompts and tool descriptions that enter model context are separate artifacts and do not use display translation.

## Decision

Localization is a shared rendering layer, not logic owned by one card. A translation unit names a field. The provider chain translates its prose, and the cache stores the answer. Each surface retains the authored identity beside display translations.

### One unit, six surfaces

A unit carries the surface, stable entity id, role (`description` or `document`) and source text. Persistent entries include the entity, text, target and chain identity, so the same field can be reused across restarts. An in-memory text index shares known answers across entities and roles; it is not a durable global text index, and the first read of a new entity may call a provider. Batch count, character count and concurrency are bounded; [the three-mode reading decision](2026-10-06-translation-reading-and-lifecycle.md) owns document segmentation.

| Surface        | Translated text                           |
| -------------- | ----------------------------------------- |
| Market         | Suite description                         |
| Skills         | Skill description                         |
| Commands       | Command description                       |
| Agent personas | Persona description                       |
| MCP            | One line per tool                         |
| LSP            | None — the entry has no description field |

### The ordered chain

Providers run in a fixed order: Google Translate, Microsoft Translator, then the configured default model. The first valid answer wins. A throw, timeout or invalid batch advances to the next provider. The public endpoints need no user key. The model provides another fallback and accepts vocabulary instructions, but does not guarantee better quality. If none answers, the UI retains authored text.

Google has a hard deadline of 3 seconds, Microsoft 15 seconds and the model 30 seconds. An independent Promise race advances fallback without requiring the provider to honor cancellation. A late result from the timed-out provider cannot replace the selected answer. A failed provider is tripped until translation is re-enabled, the cache is cleared, or the process restarts. Caller cancellation stops the chain without recording a provider failure. Public endpoints provide no availability or latency guarantee.

### The cache and its key

A translation is cached under a SHA-256 digest of the target locale, the unit's surface, id, role and text, and the identity of the provider chain. Content addressing means an entity that rewrites its text is translated again while one that merely bumps a version keeps its translation. Entries do not expire; the settings card carries a reset that clears the whole cache, and the next panel read translates again.

The key includes provider-chain identity so a changed chain cannot silently serve output from its predecessor. A per-entry upgrade flag adds state to reproduce that automatic cache miss. The record still stores the provider that answered, for operator inspection.

### What needs translating

`needsTranslation` compares Han and Latin characters for the selected target rather than declining any text containing a Han character. The `zh` target accepts Latin-bearing text where Han does not dominate; the `en` target accepts any text containing Han, including Chinese within mostly English prose. This is a Chinese/English heuristic, not general language detection; mixed-language text remains a limitation. Emptiness checks may trim, but stored and returned source and translation text are not trimmed.

### Masking

Providers can alter technical text. Before a request, masking replaces inline code, URLs, angle-bracket fragments, `${VAR}` references and glossary terms with placeholders. The glossary includes `MCP`, `LSP`, `DSH`, `CLI`, `API`, `JSON`, `HTTP`, `URL` and `SDK`. Restoration requires each protected placeholder exactly once and all document structure markers in their original order.

[The provider adapter](../../../../src/runtime/host/translation-providers.ts) makes one nonrecursive repair pass for eligible marker damage. The source must contain AST markers, and the answer must retain non-whitespace prose after markers are removed. Blank or marker-only answers and plain descriptions without AST markers do not enter repair. The adapter splits the original paragraph into text leaves, masks them again, and translates them through the same provider. It reconstructs the original markers locally instead of guessing missing text or markers from the damaged answer.

Each outer provider call can repair at most 60 nonempty text leaves through three sub-batches of at most 20 leaves each. This is an application protection budget, not a vendor limit. Every subcall shares the original signal and outer provider deadline without extending it. An individual leaf can disappear naturally, but protected spans must survive and the reconstructed paragraph must retain prose.

A mixed result returned within the original deadline preserves validated entries. Invalid descriptions, empty structural answers, repair failures and over-budget entries return empty slots for per-text backoff, original-text display and no success cache entry. They do not immediately advance to another provider. All-entry failure triggers whole-batch fallback. Deadline expiry also triggers whole-batch fallback, while caller cancellation stops the batch. Neither guarantees preservation of valid entries that this call did not return. Repair does not guarantee provider success.

### Rendering: prose changes, names do not

A name is never translated. It is the identity the user types, searches, sorts, copies and matches against upstream documentation, and the collector yields no unit for one, so both views render the same string. A description has no such second life, so it renders translated outright, with the authored text one press of the panel's view switch away.

### Settings and scope

The interface dictionary selects the target: preferences starting with `en` resolve to `en`; all others and absence resolve to `zh`. `interfaceLanguageTranslates` sets only the default switch value and cannot reject explicitly enabled English translation. The effective switch controls display and new work; disabling preserves completed entries. [Three-mode reading and translation lifecycle](2026-10-06-translation-reading-and-lifecycle.md) partially supersedes the language gate and lifecycle here; this note retains provider order, persistent keys and model isolation. Injected prompts and tool descriptions always keep their authored language.

## Alternatives considered

**Translate in the client.** Rejected on layering grounds. `src/client/**` may not import `node:**` and holds no persistent cache, so a browser-side translator would re-call a provider on every page load and could not remember a result across restarts. The browser half renders translations the node half computed; it does not compute them.

**Ship the two free machine-translation endpoints only.** Rejected: terminology fidelity is the weak point of a general MT engine — `skill`, `suite` and `surface` come back inconsistently rendered, and proper nouns drift between calls. The user's own model stays in the chain as the level that can be told how to render the domain vocabulary, and the chain reaches it only when the deployment configured it.

**Leave the provider out of the cache key.** Rejected: the key would then be pure content, and a deployment that switched engines would keep serving the old engine's text forever. Invalidating by hand or by a version bump is a state marker in disguise; folding the provider identity into the key makes the miss automatic.

**Shard the cache by source.** Deferred: the single file is atomically rewritten on each flush, and reset provides explicit reclamation. Sharding adds a multi-file migration and concurrent writes; reproducible write-cost measurements, not an old catalog size, should justify it.

## Consequences

When no answer is available, the UI retains authored text without blocking first paint. A persistent cache hit avoids provider work; a missing or corrupt cache cannot promise zero calls. Names are not translated, so searching, sorting, copying, slash invocation and name `aria-label` values keep the authored identifier.

What it costs:

- **The public endpoints are keyless and therefore unpromised.** A rate limit or a withdrawn endpoint degrades silently to the next level, with no notification to the user and no active-provider readout to diagnose it from.
- **Translation quality depends on the provider.** Masking protects technical content and a fixed glossary; the model can receive vocabulary instructions, but is not guaranteed to outperform machine translation.
- **A blocked endpoint consumes its timeout budget.** The breaker prevents later batches from repeating that provider; no level promises a fixed response time.
- **The cache grows with the catalog.** Content-addressed keys only accumulate; the reset control is what zeroes that growth, and a single file is rewritten whole on each flush.

## Testing

[Chain tests](../../../../tests/translation-chain.test.ts) cover order, deadlines, failure and cancellation; [localizer tests](../../../../tests/translation-localizer.test.ts) cover text reuse, target isolation, bounds and recovery; [cache tests](../../../../tests/translation-cache.test.ts) cover persistent keys. [The lifecycle decision](2026-10-06-translation-reading-and-lifecycle.md) identifies structural and disable/reset race coverage. These are traceable coverage references, not carried-forward mutation-testing or performance claims.

## Related

- [The document-translation note](2026-10-05-document-translation-chunked-and-lazy.md) adds the `document` role and the batch ceiling to this layer's units.
- [The translation-default note](2026-10-05-translation-default-follows-language.md) owns the absent setting's language default; [the reading and lifecycle note](2026-10-06-translation-reading-and-lifecycle.md) owns target independence from the switch.
- [The read-path note](../architecture/2026-10-05-read-path-cost-bounds-and-locale-freshness.md) owns how this layer's reads resolve the locale and how long that value lives.
- [The market-route note](../architecture/2026-10-05-market-document-translation-route-and-identity.md) gives a market detail page its own identity for reaching the document path.
