# Agent Note: Universal translation layer across the six surfaces

Status: proposed

## Problem

The market renders an upstream catalog authored in English, so a `zh` deployment shows a Chinese interface wrapped around English data. Suite names and descriptions, skill, command and agent-persona names and descriptions, MCP service names and tool descriptions, and LSP server names all reach the panel verbatim. [The description-localization note](../../implemented/feature/2026-10-03-description-localization.md) closed that gap for one field on one surface; the same defect stands on the other five surfaces and on every name.

The catalog is not ours to edit. A source is a checkout of someone else's repository, refreshed on every update, so no translation can be written back into a manifest. It has to live beside the catalog and be applied on the way out.

Three constraints shape the answer. It must work with no configuration — a fresh install with no proxy, no API key and no model route still has to converge on Chinese. It must never leave the panel worse than the English it replaces, so every failure path ends at the upstream text. And it must stay out of what the model reads: the system prompts and tool descriptions that reach a model's context are a different artifact from what a human reads on screen.

## Proposal

Localization becomes a layer the market renders through, not a step inside one card's code path. One translation unit describes a single translatable field; an ordered provider chain answers for it; a content-addressed cache remembers the answer; and every surface renders the translated text while keeping the upstream text as the identity it always was.

### One unit, six surfaces

A unit carries the surface (`market`, `skills`, `commands`, `agents`, `mcp`, `lsp`), the entity's stable id inside that surface, the role (`name` or `description`), and the upstream text. Six surfaces feed one collector, so a text repeated across surfaces — a suite name that is also its MCP service name — is queued once. On the local catalog that de-duplication collapses 8,041 collected fields and 1.19M characters into 4,775 unique texts, 28% fewer characters to send. Batches carry at most twenty texts, with at most three batches running at once, so one slow provider call cannot fan out into hundreds of requests.

| Surface        | Name         | Description                               |
| -------------- | ------------ | ----------------------------------------- |
| Market         | Suite name   | Suite description                         |
| Skills         | Skill name   | Skill description                         |
| Commands       | Command name | Command description                       |
| Agent personas | Persona name | Persona description                       |
| MCP            | Service name | One line per tool                         |
| LSP            | Server key   | None — the entry has no description field |

### The ordered chain

Providers run in a fixed order: Google Translate, then Microsoft Translator, then the user's own default model, then the upstream text. The first provider that answers wins; a provider that throws, times out, or returns a short batch is skipped. The two public endpoints need no key and no configuration, which is what makes the layer work out of the box, and the model stays in the chain as the highest-quality level for a deployment that has one.

Google is tried first and given 3 seconds, Microsoft 15, and the model 30. A provider that fails is remembered for the rest of the process — an unreachable endpoint costs one timeout per session rather than one per batch, because a blocked network holds the connection open instead of refusing it. Measured on this machine: Google answers in 0.26s through a proxy and hangs past 4s without one, while Microsoft answers directly in 0.38s with no authentication at all.

### The cache and its key

A translation is cached under a SHA-256 digest of the target locale, the unit's surface, id, role and text, and the identity of the provider chain. Content addressing means an entity that rewrites its text is translated again while one that merely bumps a version keeps its translation. Entries do not expire; the settings card carries a reset that clears the whole cache, and the next panel read translates again.

The provider identity sits inside the key on purpose. A deployment that changes engines must miss what the old engine produced rather than serve it as if the new one had; the alternative — a per-entry "upgradable" marker — is a second state machine that buys nothing the key does not already give. The `provider` field is still recorded on each entry, for an operator reading the file rather than for a decision.

### Masking

Both public engines damage technical text: they rewrite bare angle brackets, escape HTML, and drop literal newlines. Before a batch leaves, inline code, URLs, angle-bracket fragments, `${VAR}` references and a fixed glossary of terms (`MCP`, `LSP`, `DSH`, `CLI`, `API`, `JSON`, `HTTP`, `URL`, `SDK`) are replaced with placeholders the engines pass through unchanged. After the answer returns, the placeholders are restored and every one must appear exactly once; a batch that fails that check is discarded rather than cached.

### Rendering: a name is an identity

The translated text is display-only. Search, sorting, copying, slash invocation and every `aria-label` keep using the upstream name, and the original stays reachable through the card's `title` attribute. A name is a callable identity — a translated name that reached a filter or a slash command would break the thing it was meant to improve. A description has no such second life, so it renders translated outright.

### Settings and scope

Only a `zh` deployment translates; an English panel already shows the authored text, and queueing calls for it would spend quota to reproduce the input. One settings switch turns the layer off, which empties the provider chain and leaves every surface rendering the upstream text. The layer never touches what a model reads: the system prompts and tool descriptions injected into a session stay in the language their author wrote them in.

## Alternatives considered

**Translate in the client.** Rejected on layering grounds. `src/client/**` may not import `node:**` and holds no persistent cache, so a browser-side translator would re-call a provider on every page load and could not remember a result across restarts. The browser half renders translations the node half computed; it does not compute them.

**Ship the two free machine-translation endpoints only.** Rejected: terminology fidelity is the weak point of a general MT engine — `skill`, `suite` and `surface` come back inconsistently rendered, and proper nouns drift between calls. The user's own model stays in the chain as the level that can be told how to render the domain vocabulary, and the chain reaches it only when the deployment configured it.

**Leave the provider out of the cache key.** Rejected: the key would then be pure content, and a deployment that switched engines would keep serving the old engine's text forever. Invalidating by hand or by a version bump is a state marker in disguise; folding the provider identity into the key makes the miss automatic.

**Shard the cache by source.** Not this round. The design proposed one file per source because a single file is rewritten whole on every flush; at this catalog's size the whole document is a few megabytes, and the reset control lets a user zero the growth whenever they want. Sharding would add a multi-file migration and a concurrent-write problem for a cost that is not yet measured.

## Acceptance criteria

- A fresh install with no proxy, no key and no model route renders Chinese on all six surfaces within one refresh of the first panel open.
- With the network down, every panel renders exactly the upstream text — no error, no spinner, no blocked first paint.
- A second process start serves the same text with zero provider calls, and one text repeated across surfaces is translated once.
- Search, sorting, copying, slash invocation and `aria-label` still match the upstream name.
- The system prompts and tool descriptions injected into a session are unchanged.
- `pnpm run check:refactor` and the full `pnpm run test` pass.

## Risks

- **The public endpoints are keyless and therefore unpromised.** A rate limit or a withdrawn endpoint degrades silently to the next level, with no notification to the user and no active-provider readout to diagnose it from.
- **MT quality is below the model's.** The masking layer protects code, paths and a fixed glossary, and the model level remains the quality ceiling for a deployment that configures one.
- **The first call on a blocked network costs one timeout per session.** The circuit breaker bounds it, and Microsoft answers in under half a second once Google is out of the way.
- **The cache grows with the catalog.** Content-addressed keys only accumulate; the reset control is what zeroes that growth, and a single file is rewritten whole on each flush.
