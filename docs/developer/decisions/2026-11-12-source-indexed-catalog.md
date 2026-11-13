# Source indexes and installed runtime reads

## Context

Discovery answers which suites a source contains. Install state answers which of those suites the user installed or enabled. Rebuilding discovery on a dimension-wide timer makes a runtime read pay for unrelated sources and repeats filesystem traversal even when managed content has not changed.

## Decision

Keep install state authoritative in the existing state document. Store rebuildable discovery documents per source under `<dataRoot>/catalog-index/`, using the existing JSON and harness atomic-write utilities. The [source index store](../../../packages/market-catalog/src/application/source-index.ts) owns index validation, per-source work sharing and invalidation. The scanning strategies keep interpreting layouts.

| Source ownership | Reuse policy |
| --- | --- |
| Managed Git | Validate the document version, source configuration, checkout and Git HEAD when loading an index into the process. Reuse resident discovery until an explicit source change or eviction. |
| Managed archive or Git tarball fallback | Reuse a valid document for the configured checkout. Source acquisition and refresh invalidate it before changing files. A configured archive digest participates in its identity. |
| Local or adopted | Persist suite directory and marketplace-entry locations plus a routing signature. Installed queries reparse current files and inline declarations with bounded in-memory freshness. |
| Project | Read on demand with the project freshness window. Persist no discovery declarations. |

Mutable user sources save suite id/root pairs, the selected marketplace path and entry index, and a routing signature. The reader rereads a selected entry and reuses `readSuite`, `marketplaceEntryHint` and the original component-resolution rules, preserving current inline configuration without persisting executable declarations. It checks a content signature of the finite supported root manifest/catalog candidates, including the shared `marketplace.json`, and verifies that each entry still resolves locally to a route containing its bound root. Changed routing inputs, missing entries or roots and identities that cannot be reproduced fall back to the full resolver. Market queries use full source discovery.

A missing checkout cannot supply cached declarations. Invalid JSON, an unsupported document shape or an identity mismatch causes rediscovery. Other index I/O errors reject the read. Normalized declarations must pass the index schema and stay within their source checkout.

The runtime uses installed-source queries for declarations, inventories and installed MCP/LSP status. These queries retain globally disabled installs for explicit session selection. Enabled-suite reads apply global policy afterwards. The market query discovers all configured sources as needed. Remote references remain display-only until their repository is added as a source.

Content mutations hold affected-source readers, durably invalidate those indexes, change the checkout and rebuild the affected discovery before releasing readers. Per-source generations and serialized writes prevent an older scan from replacing a later invalidation. Policy mutations invalidate projections while preserving discovery. Snapshot identity remains stable within its freshness window, and a projection cannot outlive the oldest mutable source it contains.

No catalog read schedules a keep-warm scan. The optional background source updater retains its separate download schedule. Local and adopted sources keep the user freshness window; project discovery keeps its own window and scan switch. Missing suite identities remain in install state and appear in source scan notes.

## Consequences

Runtime reads avoid discovering sources without installed suites. Without a usable managed index or mutable routing hint, discovery still scans every suite in the selected source. Opening Market can discover sources that the runtime has not read. Managed checkout edits made outside the plugin require explicit refresh; working trees edited by users belong in local or adopted sources.

The checkout layout and acquisition behavior remain in place. Explicit source removal can still delete its `.sources/<id>/` directory when `deleteCheckout` is requested, including adopted checkouts. External local paths are preserved. This decision adds no installation version directories, selective downloads or automatic source pruning. Index documents are disposable derived data. Discovery format or semantic changes require a version bump.

The [Agent Note](../../../.agents/notes/implemented/architecture/2026-11-12-source-owned-discovery-indexes.md) records the alternatives, supersession and verification evidence. The [file persistence decision](2026-09-13-plugin-persistence-stays-file-backed.md) owns the choice of host file utilities.
