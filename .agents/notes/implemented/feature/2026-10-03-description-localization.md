# Agent Note: Localize suite descriptions for the active locale

Status: implemented

## Problem

The market renders the upstream catalog verbatim. Those manifests are authored in English, so a `zh` deployment shows a Chinese UI wrapped around English suite descriptions — the exact defect the user reported, with the panel chrome already translated and only the data fields left behind.

The catalog is not ours to edit. A source is a checkout of someone else's repository, refreshed on every update, so a translation cannot be written back into the manifest. It has to live beside the catalog and be applied on the way out.

## Decision

Descriptions are localized in two layers, one per kind of author.

**Layer 1 — an already-bilingual description is split, not translated.** Some authors pack both languages into the single `description` field (`中文 · English`). `pickBilingualDescription` in `src/client/features/market/bilingual-description.ts` splits on the first `·` or `-`, keeps the segment matching the active locale, and returns the input untouched when only one language is present. This costs no model call and needs no cache, and it covers the bundled first-party suites whose authors already write bilingually.

**Layer 2 — everything else is translated by the host's own model.** The remaining English prose is sent to the user's default model and cached on disk.

### The read never waits on the model

`Catalog.overview()` is synchronous with respect to translation. `DescriptionLocalizer.localize()` answers from an in-memory map: a cached translation wins, a miss returns the original text plus `pending: true` and queues the work. The response carries `descriptionPending`, the count still in flight, and `MarketSection` re-reads the overview on a 1.5s timer while that count is non-zero.

This shape is deliberate. A 924-suite catalog cannot block its first paint on 924 model calls, and a panel that renders nothing until translation completes would be worse than the English it replaces.

`Catalog.warmDescriptions()` runs the same queue ahead of that first read, so a returning user's panel opens on translations it already paid for. It is wired at two points: once the host `llm` and `agentDefaultModel` services provision (they mount after `apply()` returns, so warming any earlier would find them absent), and after every `refreshSource()`, which is the moment new descriptions arrive. The pass is incremental by construction — a cached description enqueues nothing — so repeating it costs one memory lookup per suite. It returns a promise that settles once the work is _queued_; `settleDescriptions()` waits for the translations themselves, and production callers use neither.

### A failure is invisible by construction

Translation is an optimization, never a dependency. Every failure path — no LLM service, no default model, a provider error, a timeout, an empty answer, a corrupt cache file — degrades to the upstream text. Nothing in the localizer throws into `overview()`.

`pending` reports whether work is genuinely queued or running, not whether a key is untranslated. A key waiting out its backoff answers `pending: false`, so a permanently failing description stops the panel's re-read instead of polling forever.

### The cache key is content-addressed

`descriptionTranslationKey(sourceId, suiteId, description, locale)` joins the four parts with a NUL and returns a SHA-256 digest. Content rather than a version counter: a suite that rewrites its description misses the cache and is translated again, while one that merely bumps its version keeps its translation. The NUL join keeps ids that contain the separator from aliasing each other.

Entries persist to `<dataRoot>/description-translations.json` through the shared atomic writer (`readJsonFile` / `writeJsonDocument`), the same pattern `state-store.ts` and `lsp-server-state.ts` use. The plugin data root is the plugin's own storage — never the project directory. Successful translations batch into one write every 1.5s rather than one write per suite.

### Limits

Concurrency is capped at three calls globally — stronger than the per-source cap the task asked for, and it bounds a panel open regardless of how many sources are configured. The queue de-duplicates by key, so repeated reads of one card cost one call. A failing key backs off through 2s / 8s / 30s / 120s and then stops; the in-memory copy is kept even when a cache write fails, so a lost write costs one extra call rather than a broken panel.

### Where it lives

| Concern                     | Module                                                |
| --------------------------- | ----------------------------------------------------- |
| Cache file and key          | `src/application/state/description-translations.ts`   |
| Queue, backoff, degradation | `src/application/description-localizer.ts`            |
| Model call                  | `src/runtime/host/description-translator.ts`          |
| Seam                        | `descriptionTranslator` in `src/application/ports.ts` |

### The model call

`createDescriptionTranslator` follows the harness's auxiliary-call shape from `packages/session/session-title-llm`: resolve a route, stream through `ctx.llm.stream`, assemble with `BlockAssembler`, and reject on a terminal finish reason. The route is the user's default model, read per call from `agentDefaultModel.currentSelection()` — the market never invents a model the deployment did not configure.

`available()` re-resolves the route on every question rather than caching an answer. The LLM and default-model services provision _after_ `apply()` returns, so an availability check made at composition time would report "unavailable" for the life of the process.

`purpose` is deliberately left unset. The published `GenerateOptions.purpose` accepts exactly two values, `'compaction'` and `'session-title'`; neither describes a translation, and both carry purpose-specific generation policy — `'compaction'` sets a transport header, `'session-title'` forces reasoning off. Omitting it keeps the call on the ordinary route.

The call asks for `reasoningEffort: 'off'`, because translating a sentence is mechanical and the DeepSeek adapter's default is `high` — leaving it unset would spend reasoning tokens on every one of hundreds of descriptions. It is requested through `resolveCallConfig`, which rejects an effort the exact model does not support, so a route that refuses `'off'` degrades to the adapter default instead of failing the call. A `reasoningEffort` the user selected for the deployment is forwarded rather than overridden.

Only the `zh` locale translates. An English panel is already showing the authored text, so queueing calls for it would spend the user's quota to reproduce the input.

## Alternatives considered

**Ship `locale/zh.json` with `meta.description` and let the host render it.** This is how sibling plugins localize their _own_ marketplace card, and it is the right mechanism for a plugin describing itself. It does not reach the defect: the English in the screenshot is 924 _upstream_ suite descriptions, and no file this plugin ships can carry translations for repositories it has not scanned. Adopted only for this plugin's own card, which is a separate concern.

**Translate in the client.** Rejected on layering grounds. `src/client/**` may not import `node:**` and holds no cache; a browser-side translator would re-call the model on every page load and could not persist across restarts.

**Translate eagerly during the scan and block the overview until it finishes.** Rejected: 924 calls would hold the first paint for minutes and turn a model outage into an unusable panel.

**Cache by suite version instead of description content.** Rejected: a version bump with an unchanged description would discard a valid translation, and an edited description under an unchanged version would serve a stale one.

**A dedicated `purpose: 'market-translation'` value.** Not available — the published union has two members and `purpose` feeds adapter-specific generation policy. Adding a local value would fail type checking, and passing an undocumented string would silently reach an adapter that does not know it.

## Consequences

The panel is never worse than before the change: with no model configured, no network, or a failing provider, it renders exactly the upstream text it always did. What it buys is that a `zh` deployment converges on Chinese descriptions after one pass, pays for each description once, and keeps the translations across restarts.

The cost is a background model call per unseen description, bounded to three at a time and one call per description for the life of the cache. Translation quality is the model's, not ours: a poor translation is cached as-is until the upstream description changes. There is no per-entry eviction or size cap — the file grows with the catalog and holds one short string per suite.

Suite names, keywords, skill descriptions, and MCP tool text remain untranslated. Names are proper nouns; the rest are outside the reported defect and each would need its own cache dimension.

## Testing

`tests/bilingual-description.test.ts` pins the layer-1 split. `tests/description-localizer.test.ts` covers key stability, cache reuse across instances, de-duplication, the concurrency cap, silent degradation, backoff timing on a controllable clock, and a corrupt cache file. `tests/description-translator.test.ts` drives real `StreamChunk` values through the translator, including terminal error and aborted finish reasons and caller cancellation. `tests/description-translator-seam.test.ts` mounts a real Cordis tree to pin the resolution this wiring depends on: the plugin entry injects only `skills` and `commands`, and `ctx.get(name)` still reaches `llm` and `agentDefaultModel` from sibling fibers. The property accessor (`ctx.llm`) would throw without `inject`; `get()` does not, which is why `readModelCatalog` has read `llm` this way since it shipped. `tests/catalog-description-localization.test.ts` exercises the whole path through `Catalog`: pending on the first read, the translation on the second, an untouched `en` locale, a failing model, the detail modal sharing the card's cache entry, and cache reuse across catalog instances.
