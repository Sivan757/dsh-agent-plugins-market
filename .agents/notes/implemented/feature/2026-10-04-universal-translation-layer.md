# Agent Note: Universal translation layer across the six surfaces

Status: implemented

## Problem

The market renders an upstream catalog authored in English, so a `zh` deployment shows a Chinese interface wrapped around English data. Suite descriptions, skill, command and agent-persona descriptions, and MCP per-tool descriptions all reach the panel verbatim. [The description-localization note](2026-10-03-description-localization.md) closed that gap for one field on one surface; the same defect stood on every description the other surfaces render.

The catalog is not ours to edit. A source is a checkout of someone else's repository, refreshed on every update, so no translation can be written back into a manifest. It has to live beside the catalog and be applied on the way out.

Three constraints shape the answer. It must work with no configuration — a fresh install with no proxy, no API key and no model route still has to converge on Chinese. It must never leave the panel worse than the English it replaces, so every failure path ends at the upstream text. And it must stay out of what the model reads: the system prompts and tool descriptions that reach a model's context are a different artifact from what a human reads on screen.

## Decision

Localization is a layer the market renders through, not a step inside one card's code path. One translation unit describes a single translatable field; an ordered provider chain answers for it; a content-addressed cache remembers the answer; and every surface renders the translated text while keeping the upstream text as the identity it always was.

### One unit, six surfaces

A unit carries the surface (`market`, `skills`, `commands`, `agents`, `mcp`, `lsp`), the entity's stable id inside that surface, the role (`description`, or `document` for a body translated in chunks — see [the document-translation note](2026-10-05-document-translation-chunked-and-lazy.md)), and the upstream text. Six surfaces feed one collector, and a text one entity has already paid for answers for every other entity carrying it: the cache key still names the entity, so the file keeps recording what was translated for whom, while the provider work is indexed by the text, so a repeated string costs one call per session however many fields carry it — and every field a session reads is written under its own key, so a later start serves it from disk. Measured across this machine's catalog (911 suites), the suite, skill, command and persona descriptions the layer would send total 5,055 fields and 1.35M characters, of which 4,892 texts and 1.33M characters are distinct, and reading all 4,161 documents those suites carry adds 36,503 chunk texts of which 34,729 are distinct — 3.2% and 4.9% of the provider-bound texts are a repeat of a text already carried. Batches carry at most twenty texts and at most 6,400 source characters, with at most three batches running at once, so one slow provider call cannot fan out into hundreds of requests — and no call asks for more output than the model hop is allowed to produce, because the budget is sized from the source the call carries rather than from the number of texts it holds. A text longer than one chunk is split the way a document body is rather than sent whole, so a long upstream field cannot overrun that budget either.

| Surface        | Translated text                           |
| -------------- | ----------------------------------------- |
| Market         | Suite description                         |
| Skills         | Skill description                         |
| Commands       | Command description                       |
| Agent personas | Persona description                       |
| MCP            | One line per tool                         |
| LSP            | None — the entry has no description field |

### The ordered chain

Providers run in a fixed order: Google Translate, then Microsoft Translator, then the user's own default model, then the upstream text. The first provider that answers wins; a provider that throws, times out, or returns a short batch is skipped. The two public endpoints need no key and no configuration, which is what makes the layer work out of the box, and the model stays in the chain as the highest-quality level for a deployment that has one.

Google is tried first and given 3 seconds, Microsoft 15, and the model 30. A provider that fails is retired for the process, so an unreachable endpoint costs one timeout rather than one per batch, because a blocked network holds the connection open instead of refusing it. Retired is not permanent: switching translation back on, or clearing the cache, starts the chain clean, because both are the user asking for translation again. Without that, one cut-off generation left the model hop out of the chain until the process restarted — the switch still reading "on", every read reporting nothing pending, and nothing on screen to explain it. Measured on this machine: Google answers in 0.26s through a proxy and hangs past 4s without one, while Microsoft answers directly in 0.38s with no authentication at all.

### The cache and its key

A translation is cached under a SHA-256 digest of the target locale, the unit's surface, id, role and text, and the identity of the provider chain. Content addressing means an entity that rewrites its text is translated again while one that merely bumps a version keeps its translation. Entries do not expire; the settings card carries a reset that clears the whole cache, and the next panel read translates again.

The provider identity sits inside the key on purpose. A deployment that changes engines must miss what the old engine produced rather than serve it as if the new one had; the alternative — a per-entry "upgradable" marker — is a second state machine that buys nothing the key does not already give. The `provider` field is still recorded on each entry, for an operator reading the file rather than for a decision.

### What needs translating

A text is sent when it is not already written in the target language, and the test for that is dominance rather than presence. Anything carrying a single Han character used to be declined as "already Chinese or already bilingual", which is wrong for the texts that matter: measured over the marketplace's own sources, thousands of 800-character document chunks are English prose that names a Chinese term, quotes a Chinese message, or shares a table with a Chinese column header, and every one of them was declined — leaving 283 real documents partly translated while the panel reported that they had settled. The rule now sends a text whose Latin letters are at least as many as its Han characters, and declines only the ones where Han dominates. Text that reaches a provider already Chinese comes back unchanged (measured against the Microsoft endpoint), so the remaining refusals cost nothing and are honest: what they decline is written in the language the reader asked for.

### Masking

Both public engines damage technical text: they rewrite bare angle brackets, escape HTML, and drop literal newlines. Before a batch leaves, inline code, URLs, angle-bracket fragments, `${VAR}` references and a fixed glossary of terms (`MCP`, `LSP`, `DSH`, `CLI`, `API`, `JSON`, `HTTP`, `URL`, `SDK`) are replaced with placeholders the engines pass through unchanged. After the answer returns, the placeholders are restored and every one must appear exactly once; a batch that fails that check is discarded rather than cached.

### Rendering: only a description changes

A name is never translated. It is the identity the user types, searches, sorts, copies and matches against upstream documentation, and the collector yields no unit for one, so both views render the same string. A description has no such second life, so it renders translated outright, with the authored text one press of the panel's view switch away.

### Settings and scope

Only an English interface is skipped: a panel already showing the authored text gains nothing from a provider call that reproduces it. Every other preference translates, because every other preference renders the market's Chinese dictionary — `bindHostLocale` answers `ja` and `zh-Hant` with the same copy a `zh` reader sees — and the target follows that dictionary rather than the preference tag. A `ja` reader therefore gets Chinese translations beside Chinese chrome, not Japanese text beside Chinese labels, and a `zh-Hant` reader gets Simplified rather than Traditional. The translation target is one function (`resolveTranslationTarget`) and it is the same predicate the switch's default and every surface's gate read, so the three cannot drift apart; a second dictionary would add a case there rather than a second reading of the preference somewhere else. One settings switch turns the layer off, which empties the provider chain and leaves every surface rendering the upstream text. The layer never touches what a model reads: the system prompts and tool descriptions injected into a session stay in the language their author wrote them in.

## Alternatives considered

**Translate in the client.** Rejected on layering grounds. `src/client/**` may not import `node:**` and holds no persistent cache, so a browser-side translator would re-call a provider on every page load and could not remember a result across restarts. The browser half renders translations the node half computed; it does not compute them.

**Ship the two free machine-translation endpoints only.** Rejected: terminology fidelity is the weak point of a general MT engine — `skill`, `suite` and `surface` come back inconsistently rendered, and proper nouns drift between calls. The user's own model stays in the chain as the level that can be told how to render the domain vocabulary, and the chain reaches it only when the deployment configured it.

**Leave the provider out of the cache key.** Rejected: the key would then be pure content, and a deployment that switched engines would keep serving the old engine's text forever. Invalidating by hand or by a version bump is a state marker in disguise; folding the provider identity into the key makes the miss automatic.

**Shard the cache by source.** Not this round. The design proposed one file per source because a single file is rewritten whole on every flush; at this catalog's size the whole document is a few megabytes, and the reset control lets a user zero the growth whenever they want. Sharding would add a multi-file migration and a concurrent-write problem for a cost that is not yet measured.

## Consequences

The panel is never worse than it was before the layer: with no network, no model route, a rate-limited endpoint or a corrupt cache file, every surface renders exactly the upstream text it rendered before, and a second process start serves the same text with zero provider calls. Every surface keeps the authored text beside the translation, so its search, sorting, copying, slash invocation and `aria-label` values read the name exactly as authored.

What it costs:

- **The public endpoints are keyless and therefore unpromised.** A rate limit or a withdrawn endpoint degrades silently to the next level, with no notification to the user and no active-provider readout to diagnose it from.
- **MT quality is below the model's.** The masking layer protects code, paths and a fixed glossary, and the model level remains the quality ceiling for a deployment that configures one.
- **The first call on a blocked network costs one timeout per session.** The circuit breaker bounds it, and Microsoft answers in under half a second once Google is out of the way.
- **The cache grows with the catalog.** Content-addressed keys only accumulate; the reset control is what zeroes that growth, and a single file is rewritten whole on each flush.

## Testing

Every mechanism here was re-run against a deliberately reverted fix in a copy of the tree, and each one turned a test red. Restoring the per-text output budget (`512 × the number of texts`) reddens the two translator cases that pin the source-sized budget and the call that used to be cut off. Reverting either half of the breaker recovery — the cache reset or the switch edge — reddens the localizer and settings-namespace cases that pin it. Restoring "any Han character declines the text" reddens the two `needsTranslation` cases and the document-path case where an English paragraph quoting Chinese used to report nothing pending. Returning the preference tag as the translation target reddens the gate-consistency cases for `zh-CN`, `zh-Hant`, `ja`, `en` and `en-US`, plus the localizer's target case.

## Related

- [The document-translation note](2026-10-05-document-translation-chunked-and-lazy.md) adds the `document` role and the batch ceiling to this layer's units.
- [The translation-default note](2026-10-05-translation-default-follows-language.md) owns the switch's language-derived default and the gate every read answers to.
- [The read-path note](../architecture/2026-10-05-read-path-cost-bounds-and-locale-freshness.md) owns how this layer's reads resolve the locale and how long that value lives.
- [The market-route note](../architecture/2026-10-05-market-document-translation-route-and-identity.md) gives a market detail page its own identity for reaching the document path.
