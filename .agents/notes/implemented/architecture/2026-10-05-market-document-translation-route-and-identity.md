# Agent Note: The market detail page translates documents through its own route and identity

Status: implemented

## Problem

The market detail modal previews a suite's documents — a skill's `SKILL.md`, a command, an agent persona — and the user panels already translate the same files behind a collapsed section. Putting that section on the second surface raised a question the layer had not faced: which identity names the document, given that the two surfaces arrive with different ones.

The user panel addresses a document by the id its own scan gave it: `pluginResourceId(sourceId, suiteId, kind, name)` (`src/application/panel-resources.ts:100`), a JSON array whose leading `[` is what marks a plugin entry. The market page arrives with `{sourceId, suiteId}` for the suite and `{kind, name}` for the document, and no id at all.

## Decision

The market detail page translates through a route of its own: `POST /api/agent-plugins/suite/document/translation`, body `{sourceId, suiteId, kind, name}` (`src/contracts/market.ts:30`, handled at `src/routes.ts:205`). It is the counterpart of the user-panel route (`userPanelTranslationRoute`, `src/contracts/market.ts:155`), not a generalization of it.

### The second route is a capability boundary, not a different identity

The user-panel route resolves through `PanelResourceStore` (`src/routes.ts:464`), and that store's scan carries installed, local suites only: `if (!this.catalog.isInstalled(suite.sourceId, suite.id) || suite.remote !== undefined) continue` (`src/application/panel-resources.ts:408`). The market detail modal opens for a suite that is not installed at all — its footer offers **Install** while `detail.installed` is false (`src/client/features/market/SuiteDetail.tsx:296-299`), and every card in the list opens it without an install check (`src/client/features/market/MarketSection.tsx:294-301`). A single route that dispatched a panel-shaped body to the panel store would answer "no entry named …" for exactly the suites the modal exists to preview before install.

The market route resolves from the catalog snapshot instead, the way `suiteDetail` and `skillContent` do (`src/application/catalog.ts:471`, `:429`, `:442`): find the suite in `readUserCatalog()`, then read the document out of that suite's own scanned resource list (`readSuiteDocument`, `src/application/details.ts:109`). Carrying uninstalled suites in the panel store was the other way to one route, and it would have put market-only rows into the panels' own listing.

A union body has a second cost beyond the dispatch: it needs a discriminator, a "which identity is this" rule standing beside the panel's own id format and free to drift from it. Two URLs cost nothing where the routes are matched — the host keys its table by exact pathname (published `@deepseek-ai/dsh-host-webserver@0.2.0-rc.2`, `lib/index.js:148`, `:324`; the same exact-path rule the panel routes already lean on, `src/routes.ts:422-424`) — so a second `exact` route is one more map entry.

### What is shared rather than forked

Everything downstream of the identity is one implementation, reached by both routes. `Catalog.translateDocument` (`src/application/catalog.ts:382`) splits the body with `chunkDocument` (`:338`), localizes each chunk under role `'document'`, and gates on `interfaceLanguageTranslates` (`src/contracts/settings.ts:107`). The client renders `DocumentTranslationView` (`src/client/ui/DocumentTranslation.tsx:40`) on both surfaces — the user-panel entry detail (`src/client/ui/UserEntryDetail.tsx:137`) and the market document row (`src/client/features/market/SuiteDetail.tsx:267`) — and both drive the same `pollUntilTranslated` (`src/client/ui/translation-settle.ts:42`) and the same `resolveTranslationTarget` (`src/contracts/settings.ts:132`).

The cache key is the load-bearing part. The market route keys by `pluginResourceId(sourceId, suiteId, kind, name)` on the document's own surface (`src/application/catalog.ts:476`), which is exactly the id the panel's scan gives the same file (`src/application/panel-resources.ts:425`, `:428`) and the id the panel route passes to the same function (`:241`). One document is one cache entry however it was opened, so whichever surface translated it first, the other reads it back without paying a provider again; `tests/surface-translations.test.ts:223-244` translates through the panel, then asks the market route for the same file and asserts the provider was called once.

### The payload is for display; the route accepts no text

Commands and agents already travel inline in the `suiteDetail` payload — `markdownPreviews` puts each document's `content` on the wire (`src/application/details.ts:73-74`, `:136`) — so the modal shows the authored document without a read. Translation still re-reads the file server-side, and the route's body is `{sourceId, suiteId, kind, name}` and nothing else (`src/routes.ts:206-211`): a route that translated caller-submitted text would be an open machine-translation proxy for any local page. The asymmetry is deliberate — the payload is what the page shows, never what is translated — and `tests/routes.test.ts:345-384` sends an extra `text` field and asserts it reaches nothing.

## Alternatives considered

**One route accepting either identity shape.** Rejected: the panel-shaped half resolves through `PanelResourceStore`, whose scan carries installed suites only (`src/application/panel-resources.ts:408`), while the market modal opens on suites that are not installed and offers **Install** there (`src/client/features/market/SuiteDetail.tsx:296-299`); the union would either miss those suites or force uninstalled rows into the panels' listing, and it needs a discriminator that can drift from the panel's id format. The second URL it saves costs one map entry in a table keyed by exact pathname.

**Translate the document text the detail payload already carries.** Rejected: commands and agents arrive with their `content` on the wire, so a route that accepted that text would be an open machine-translation proxy for any local page — the operator's provider quota spent on content of a page's choosing, and no file to name in the cache. The route takes an identity and re-reads the file (`src/application/details.ts:109`), the same contract the panel route keeps.

**Give the market route its own cache namespace.** Rejected: keying by the suite identity rather than the document's own panel id would make one file two cache entries and two payments the moment a reader opened it on both surfaces — the user panel is where a suite's documents are read, and the market preview is where they are inspected before install, so the same document is expected on both.

## Consequences

The modal pays nothing for a document nobody expands, and a document translated on one surface is free on the other. The market route re-reads the file rather than trusting the payload, so a translation follows the disk even where the preview above it still shows the text the scan published.

Two routes have to be kept in step: a fourth document surface would be added to the panel's kind list (`src/routes.ts:428`) and to the market route's own validation (`:208`), and the client keeps one fetch function per route (`src/client/api.ts:227`, `:361`). The sharing is what makes that cheap — the chunker, the localizer, the component, the poll and the cache key are single instances, and the routes differ only in how they resolve a document.

## Testing

`tests/surface-translations.test.ts:223-244` is the cross-surface case: the panel translates a suite command, the market route asks for the same file, and the provider's call count stays at one. `:209-221` pins the re-read: the file is rewritten on disk, and the answer follows the disk rather than the text the detail payload had carried. `:246-253` pins the name contract: a path-shaped name is a miss, not a lookup.

`tests/routes.test.ts:345-384` exercises the route itself: it forwards `{sourceId, suiteId, kind, name}` to the catalog, an extra `text` field reaches nothing, and a missing suite identity, an unknown surface, and a nameless document are each refused before the catalog is asked.

`tests/market-detail-document-translation.test.ts` mounts the modal: nothing is read for a document nobody opens, each of the three surfaces reads its own document once its section is opened, and the section renders nothing and reads nothing while translation is off or the interface is English. `tests/client-document-translation.test.ts` covers the same component from the user-panel side.

## Related

- [The document-translation note](../feature/2026-10-05-document-translation-chunked-and-lazy.md) owns the chunker, the role slot, the poll and the user-panel route; this note adds the market route's identity and its shared key, and neither supersedes the other.
- [The translation-default note](../feature/2026-10-05-translation-default-follows-language.md) owns the gate both routes answer to; this note adds no gate.
- [The read-path note](2026-10-05-read-path-cost-bounds-and-locale-freshness.md) owns the locale read cost the market route pays once per document (`src/application/catalog.ts:476`).
- [The universal translation layer note](../feature/2026-10-04-universal-translation-layer.md) owns the provider chain and the cache this route feeds.

No active note owned this decision before: the sibling feature note scopes its route section to the user panel, so nothing is superseded and nothing is archived.
