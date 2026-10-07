# Agent Note: read-path cost bounds and the locale freshness contract

Status: implemented

## Problem

Three read paths shared one shape: an input the host answers expensively was resolved where it was needed instead of once per operation, so each read paid for it again.

The host answers the locale preference by projecting every active profile entry's live configuration, so one read is a whole-profile scan. `Catalog.translateFields` took the locale as an optional parameter defaulting to `this.ports.localePreference()`, which meant every call site that omitted the argument silently re-read that projection — once per entity inside a loop. A panel read re-derived every row from disk on each of the client's 1.5 s translation polls. And the list wire carried each entry's whole document even though the client opens one entry at a time.

## Decision

### The locale resolves once per operation, and a missing one does not compile

`Catalog.localePreference` reads the port once (`packages/market-bundle/src/application/catalog.ts:93`), and `translateFields(surface, id, fields, locale)` takes the locale as a required parameter with no default (`:290-295`). The JSDoc states the rule at the parameter (`:285-287`): there is no default, because a default would re-read the host preference per entity and make a read's cost scale with its row count. Every walk resolves once and threads the value — the market overview (`:229`), the MCP status inventory (`:336`), the single-suite detail (`:356`) — and the panel read hands one value to every row (`packages/market-runtime/src/application/panel-resources.ts:192`).

### The cached locale has no TTL; it shares the host copy's freshness

`packages/market-bundle/src/index.ts:190` holds the preference in a plain `let`, and `:362` answers the port from it. Exactly three points refresh it, and they are the points that refresh `hostLocale.t`, the copy the plugin renders its own host-facing strings through: activation (`:207`), the settings service landing (`:208-210`), and the `locale` entry's own `settings/document-updated` (`:213-219`). There is no timer and no age bound.

That is the contract: the cached value can be stale only where a language change fired no settings-document event, and there `hostLocale.t` is stale to the same degree. The plugin cannot show two languages for one preference; it can show one preference the host no longer holds. The price is that a preference written by a path which fires no document event is unobserved until the next of the three points, and nothing in this plugin notices sooner.

### The row cache is bounded at 2000 ms, and Refresh bypasses it

`ROW_CACHE_MAX_AGE_MS` is 2_000 (`packages/market-runtime/src/application/panel-resources.ts:122`). Rows are reused only while three inputs hold at once: the catalog snapshot object, the store's own mutation counter, and an age within the bound (`:302-307`). The bound is one client poll interval — `TRANSLATION_POLL_MS` is 1_500 (`packages/market-ui/src/ui/translation-settle.ts:17`) — plus the slack a slow read needs, so the cache absorbs the reads one interaction produces without ever being the reason a hand edit stays invisible past the next poll. The client's Refresh passes `force`, which skips the reuse test and re-derives every row (`:300`, `:302`).

### The list carries no document text

`PanelResources.read` builds each wire row and deletes `rawText` and `content` (`packages/market-runtime/src/application/panel-resources.ts:201-204`); the document stays in memory on `PanelEntryRecord` (`:29`) and only the single-entry `get` (`:213`) returns it. The wire type states the contract: the list read omits `rawText` because it was the bulk of the response and the client fetches the one entry it opens (`packages/market-contracts/src/contracts/market.ts:379-384`), and omits `content` because the client renders `rawText` and sending both shipped the same document twice (`:391-396`).

## Alternatives considered

**Resolving the host preference where it is used.** Rejected: the host's answer is a whole-profile projection, so resolving it per entity is what made a panel's latency scale with its row count instead of its work; one operation renders one value, and every entity in it would pay again for an answer that cannot differ.

**Keeping the default parameter on `translateFields` and passing the locale wherever it was remembered.** Rejected: the default is precisely what made an omission silent. A required parameter turns the same mistake into a compile error, and the tests that count the reads (`tests/panel-locale-read.test.ts:39`) pin the resolved-once shape rather than a convention.

**Giving the cached locale a TTL or a refresh timer.** Rejected: a timer adds a wake-up and a second freshness rule to a value that already follows the host copy at three points, and it would make the panels fresher than the copy the plugin renders for the host — the two could then disagree with each other, which is the failure the shared refresh points prevent.

**Aging panel rows on the snapshot TTL instead of a row-local bound.** Rejected: the user snapshot lives 30 s (`SCAN_CACHE_TTL_MS`, `packages/market-catalog/src/application/snapshot-cache.ts:18`) and is replaced at 0.8 of that (`USER_REFRESH_LEAD_RATIO`, `:28`), so rows aged on it would leave a hand edit invisible for tens of seconds; the row cache reads file contents, so its bound belongs to the client's poll interval, not the snapshot's.

**Carrying `rawText` and `content` on the list and letting the client keep them.** Rejected: the list is what the panel re-reads on every poll, so shipping the documents made the polled response several times larger than the rows it describes; opening one entry costs one request, and that entry read is also the only read that returns the document as one consistent revision.

**Host capability.** The preference itself is the host's: `settings.describe()` is the projection the harness's own desktop shell reads, and the [host locale source note](../bug-fix/2026-09-24-host-locale-source-read-and-lifetime.md) owns that read and its fiber lifetime. What stays local is the bound on top of it — the host offers no cheaper per-read answer, and no row-level cache for rows this plugin derives from files the host does not model.

## Consequences

- A panel read costs one projection rather than one per row, and one operation passes the same value to every surface that walks entities.
- A language switch is observed at the three points the host copy uses; a preference written by a path that fires no settings-document event stays unseen until the next one, for the panels and for the plugin's own host-facing copy alike.
- A served row can be up to 2 s old: a hand edit is visible by the next poll at the latest, and Refresh is immediate.
- The polled list response no longer carries documents; opening an entry costs one extra request that returns the document as one revision.
- `PanelEntryRecord` keeps the document in memory, so the raw text still exists inside the module for the single-entry read.

## Testing

- `tests/panel-locale-read.test.ts:37-39` counts the port reads for a four-row panel and fails if any row resolves the preference.
- `tests/surface-locale-read.test.ts:1-9` names every surface that must resolve once per operation: the panel list, the MCP status inventory including each observed tool, the LSP inventory, the `/` menu faces, and the single-suite detail.
- `tests/panel-resources.test.ts:301-302` and `:376-377` pin the stripped list rows against `:306` and `:386-387`, where the single-entry read carries `rawText` and `content`.
- `tests/panel-resources.test.ts:415` drives the catalog clock past `ROW_CACHE_MAX_AGE_MS` to pin the age bound.

## Related

- [The host locale source reads the settings projection and lives with its fiber](../bug-fix/2026-09-24-host-locale-source-read-and-lifetime.md) owns the projection read, the service resolution, and the wiring lifetime. This note owns the cost bound and the freshness contract on top of that wiring; neither supersedes the other.
- [The translation switch defaults to the interface language](../feature/2026-10-05-translation-default-follows-language.md) owns what that same preference decides — the language-derived default, the schema's load-bearing absence, and the card's effective value. This note owns how the preference is read and how long it lives; neither supersedes the other.
- [Universal translation layer across the six surfaces](../feature/2026-10-04-universal-translation-layer.md) is the layer whose read path these bounds serve.
- [Localize suite descriptions for the active locale](../feature/2026-10-03-description-localization.md) is the narrower predecessor: its module paths, its `descriptionTranslator` seam and its `descriptionPending` count are superseded by the layer above, while the read-path bounds it relied on are owned here.
