# The translation layer degrades through four levels, keys by provider, and stays out of model context

## Status

Accepted, and implemented by the change that carries it. The layer replaces the single-provider localization [the 2026-10-03 note](../../../.agents/notes/implemented/feature/2026-10-03-description-localization.md) records: that note's decision stands for the split of an already-bilingual description, and its provider half is generalized here from one surface's description to every description the six surfaces render. The [design document](../design/universal-translation-layer.html) is the pre-implementation record; this page is the decision.

## Context

The market renders an upstream catalog authored in English, and a `zh` deployment therefore shows a Chinese interface wrapped around English data. The 2026-10-03 change localized one field — a suite's description — through the user's default model. Every other rendered string stayed English: suite names, the names and descriptions of skills, commands and agent personas, MCP service names and their per-tool descriptions, and LSP server names.

Three facts about that deployment shape decide the design.

**There is no configuration step to hang a feature on, and no provider readout to diagnose it with.** The plugin is installed once and must work; a user who never opened the settings page, never configured a proxy and never had a working model route still expects a Chinese panel.

**Every failure is a rendering failure.** A missing translation is not an error a user can act on — it is English prose in a Chinese card, which is exactly the state before the change. A panel that reports a translation error is worse than one that quietly shows the original.

**Upstream text is an identity, not just a label.** A suite name is what a search matches, what a slash command resolves, and what a copied reference contains. A skill's description is prose.

## Decision

### 1. Four ordered levels, each one a silent downgrade

Translation runs through an ordered chain: Google Translate, Microsoft Translator, the user's own default model, then the upstream text. The first provider that answers wins. A provider that throws, times out, or returns a batch of the wrong length is skipped, and the chain moves on. When every provider is unavailable or has failed, the caller renders the original text — there is no error path and no user-visible notification.

The order is quality-and-cost order, and the measured numbers are what set it:

- **Google Translate** (`translate-pa.googleapis.com/v1/translateHtml`) answers in 0.26s through a proxy, but on a network without one it does not fail fast — it holds the connection past 4 seconds. It is therefore tried first with a 3-second deadline and taken out of the chain for the rest of the process on its first failure. Without that breaker every cold start would pay a timeout before the panel could fill in.
- **Microsoft Translator** (`edge.microsoft.com/translate/translatetext`) needs no authentication, no key and no proxy, and answered in 0.38s directly on the same machine. This level is what makes the feature work out of the box, which is why it sits in the chain unconditionally rather than behind a setting.
- **The user's default model** is the quality ceiling: it can be told how to render domain vocabulary, which a general MT engine cannot. It is reached only when the deployment configured a route, and it is given the longest deadline because a generation legitimately takes seconds.

Batches are capped, and the provider work is indexed by the source text rather than by the entity. The cache key still names the entity — which is what makes the file the record of what was translated for whom — but a text one entity has already paid for answers for every other entity carrying it, so two texts that differ only in which surface they came from are still one provider call; the translation of a string does not depend on where it is rendered. Measured across this machine's catalog (911 suites), the suite, skill, command and persona descriptions the layer would send total 5,055 fields and 1.35M characters, of which 4,892 texts and 1.33M characters are distinct, and reading all 4,161 documents those suites carry adds 36,503 chunk texts of which 34,729 are distinct — 3.2% and 4.9% of the provider-bound texts are a repeat of a text already carried. A field answered once is served from its own entry on every later start; the text index is derived state rebuilt as a session reads, so a text appearing under a new entity for the first time in a session costs that session one call, and never more than one.

### 2. The provider identity is part of the cache key

A cached translation is stored under a SHA-256 digest of the target locale, the unit's surface, id and role, the source text, and a stable identity of the provider chain. Entries do not expire; the settings card carries a reset that clears the whole cache.

Putting the provider in the key is what makes an engine switch self-correcting: a deployment that changes its chain misses every entry the old chain produced and re-translates, rather than serving text one engine wrote under another engine's name. The alternative — content-only keys plus a per-entry "upgradable" flag — is a second state machine whose only job is to reproduce the miss the key already produces, and it needs its own invalidation rules, its own migration and its own tests. The provider is still recorded on each entry, but as an operator-visible fact rather than as a decision input.

Content-addressed keys only accumulate: an upstream description edited once leaves its old key behind forever. The reset control is what zeroes that growth, so the decision to keep entries indefinitely is paired with giving the user a way to drop them.

### 3. Only the UI layer is translated

Translated text is display-only. A name is never translated: it is the identity the user types, searches, sorts, copies and matches against upstream documentation, and a translated name that reached a filter or a slash command would break the surface it was meant to improve. Only a description renders translated, and the authored text stays on the wire beside it for the panel's own view switch.

What a model reads is a different artifact from what a human reads, and the layer does not touch it. The system prompts and tool descriptions this plugin injects into a session stay in the language their author wrote them in — a translation there would change model behavior, spend tokens on every session, and be invisible to the user who would have to debug it.

## Consequences

- **The panel is never worse than before the change.** With no network, no model route, a rate-limited endpoint or a corrupt cache file, every surface renders exactly the upstream text it rendered before. The failure mode of the whole feature is the pre-change state.
- **One timeout per session is the price of the first level.** On a network where Google is blocked, the first translation pays 3 seconds and the breaker removes it; Microsoft answers in under half a second afterwards.
- **Translation quality is the provider's, not ours.** A mediocre translation is cached as-is until the cache is cleared. The masking layer protects inline code, URLs, angle-bracket fragments, `${VAR}` references and a fixed glossary of terms from being rewritten, which is the part of quality this plugin can actually own.
- **The cache file grows with the catalog until a user clears it.** It is written whole on each flush; sharding it by source is deferred until the write cost is measured rather than assumed.
- **A stale translation outlives an upstream edit until the cache is cleared.** Content addressing catches an edited text immediately (a new key), but an entry whose upstream text was deleted simply stays until a reset.
- **The layer's scope is a standing boundary.** Any future surface that injects text into a model's context must not route through this layer, and any new rendered field needs a deliberate decision about whether it is an identity or prose.

## Alternatives considered

- **Translate in the client — rejected.** `src/client/**` may not import `node:**` and holds no persistent cache. A browser-side translator would re-call a provider on every page load and could not remember a result across restarts.
- **Ship the two free machine-translation endpoints only — rejected.** Terminology fidelity is a general MT engine's weak point: `skill`, `suite` and `surface` come back rendered inconsistently, and proper nouns drift between calls. The user's model stays in the chain as the level that can be told how to render the domain vocabulary.
- **Leave the provider out of the cache key — rejected.** See decision 2: the key would be pure content, and a deployment that switched engines would keep serving the old engine's text indefinitely.
- **Shard the cache by source — deferred, not rejected.** The design proposed one file per source because a single file is rewritten whole on each flush. At this catalog's size the whole document is a few megabytes and the reset control bounds growth without it; sharding adds a multi-file migration and a concurrent-write problem whose cost has not been measured.
- **Gate the machine-translation levels behind an explicit opt-in — rejected.** The whole point of the two public endpoints is that a fresh install works with no configuration. A consent step would restore the English panel the feature exists to remove, and the switch that does exist turns the layer off rather than on.

## Revisit when

- Either public endpoint starts requiring a key, rate-limits the plugin's traffic, or disappears; the "works out of the box" premise rests entirely on those two levels and a replacement must be found before the next release.
- The cache file's write cost becomes measurable — a catalog several times this size, or a flush that blocks a read — which is the condition the sharding deferral names.
- A new surface is added that renders names or descriptions, or an existing one starts injecting text into a model's context; both change the scope argument in decision 3 and need the identity-versus-prose call made explicitly.
- The user's model level becomes reachable in the deployments that matter (a configured route, available quota), which would make the MT levels a latency optimization rather than the primary path.
