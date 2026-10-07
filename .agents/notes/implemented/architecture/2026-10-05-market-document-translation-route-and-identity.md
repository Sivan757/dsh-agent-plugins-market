# Agent Note: The market detail page translates documents through its own route and identity

Status: implemented

## Problem

User panels and Market suite detail both display skill, command and agent-persona documents. They arrive with different identities, and Market must preview before installation rather than depend on a user resource panel that lists installed suites.

## Decision

The Market translation route accepts `{sourceId, suiteId, kind, name}`; the user-panel route accepts an entry name and resolves it through its own store. Both read files from supported resource lists, never caller-submitted prose or arbitrary paths. [The market contract](../../../../packages/market-contracts/src/contracts/market.ts) owns route names; [the route implementation](../../../../packages/market-bundle/src/routes.ts) owns request validation.

### Different lookup eligibility, shared identity

Market resolves the suite through the catalog and can preview local suites before installation. A user resource panel reads entries within its discovery scope through `PanelResourceStore`. Dispatching Market requests directly to the user-panel store would miss pre-install previews; adding uninstalled suites to the user list would broaden that list's responsibility.

Both paths identify a suite document with `pluginResourceId(sourceId, suiteId, kind, name)`, then add the document role, segment text, target and provider chain to the cache key. Opening the same document through different surfaces shares segment records rather than translating once per surface. This does not mean one cache entry holds the whole document.

### The page sends only an identity

Suite detail carries row metadata for skill, command and agent documents; a single-document read fetches the body on demand. The translation route re-reads the file and strips frontmatter instead of trusting a page-supplied copy. The file must be located by a scanned resource name, preventing a page from spending the operator's translation quota on arbitrary prose.

### Shared document processing and reader

Both paths reach `Catalog.translateDocument` and the server-side AST transform. Both clients use `DocumentTranslationView` and pending re-reads. Expanding the body requests translation, with paragraph-by-paragraph bilingual reading selected by default; [the reading and lifecycle decision](../feature/2026-10-06-translation-reading-and-lifecycle.md) owns the three modes and independent target/switch rules, not this note.

## Alternatives considered

**One route accepting both identity shapes.** Rejected: it would still need different user-panel and Market lookup eligibility, plus a discriminator that can drift from the existing identity format. Two exact routes keep resolution with each caller.

**Translate prose submitted by the page.** Rejected: it exposes translation quota to page-selected text and loses a verifiable file identity. Re-reading the named file from a scanned list constrains the input.

**Give Market a separate cache namespace.** Rejected: the same file would be translated again between pre-install preview and user-panel reading. Sharing document identity reuses segments without merging the routes' lookup scopes.

## Consequences

Unexpanded documents are not pretranslated. Cached segments with the same identity, text, target and chain can be reused across both surfaces. Original and translated bodies are separate reads, so an external edit can occur between them; the translation route answers for the file it re-reads, not an atomic snapshot shared with the original preview.

Adding a document kind requires updating validation and client readers for both routes. Segmentation, localization, rendering and persistent keys stay shared rather than becoming two implementations.

## Testing

[Cross-surface tests](../../../../tests/surface-translations.test.ts) cover cache reuse, disk re-reads and invalid names. [Route tests](../../../../tests/routes.test.ts) cover identity validation and refusal to forward extra text. [Market document tests](../../../../tests/market-detail-document-translation.test.ts) and [user entry tests](../../../../tests/client-user-entry-detail-translation.test.ts) cover expanded reads. [Shared reader tests](../../../../tests/client-document-translation.test.ts) own three-mode interaction. These identify coverage, not a full test rerun by this documentation edit.

## Related

[The chunking note](../feature/2026-10-05-document-translation-chunked-and-lazy.md) retains the request-budget and document-role rationale. [The language-default note](../feature/2026-10-05-translation-default-follows-language.md) owns the absent setting. [The universal layer](../feature/2026-10-04-universal-translation-layer.md) owns provider order and persistent keys.

[The reading and lifecycle decision](../feature/2026-10-06-translation-reading-and-lifecycle.md) updates the shared reader and language controls without superseding this note's separate routes and shared identity; that rationale remains active.
