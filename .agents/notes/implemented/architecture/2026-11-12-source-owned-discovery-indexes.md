# Agent Note: Source-owned discovery indexes and installed runtime reads

Status: implemented

## Problem

Catalog discovery and install policy change at different rates. A source checkout changes when content is acquired, refreshed or edited. Installing or enabling a suite changes only policy. A dimension-wide discovery cache gives both changes the same cost and lifetime. Its keep-warm timer repeats traversal when nobody needs new content, and runtime preparation can still reach the full market through declaration and inventory queries.

The resulting cost follows the size of every configured source instead of the installed resources a session can use. Increasing a TTL postpones that work but leaves the same cold scan after expiry or restart.

## Decision

Discovery is owned by each source. The [ADR](../../../../docs/developer/decisions/2026-11-12-source-indexed-catalog.md) defines the read and invalidation rules. `SourceIndexStore` keeps versioned, schema-checked source records under `<dataRoot>/catalog-index/`. Managed discovery is shared across market, installed and enabled projections. Mutable user records contain routing hints instead of cached declarations. Install state stays in the existing state document and is applied after discovery.

Managed Git sources validate configuration, checkout and HEAD when their index loads into the process. Managed archives and tarball fallbacks use the configured checkout and explicit acquisition invalidation. An archive digest, when configured, participates in identity. These indexes survive restarts. Local, adopted and project trees use read-driven, bounded in-memory freshness because their owners can edit files without a plugin operation. The default user window is 30 seconds and the project window is 5 seconds. A zero project TTL observes project discovery on every read. No discovery read schedules a keep-warm timer.

Local and adopted sources persist suite identities and roots, the selected marketplace path and entry index, and a content signature of the supported root routing candidates. They persist no executable declarations. Fresh installed reads reopen the selected marketplace entry and use `readSuite` with `marketplaceEntryHint`, replaying the same component-resolution rules as full discovery. Inline LSP and other component declarations are read from the current entry rather than reconstructed from the suite directory alone.

The reader checks that real roots remain inside the checkout and that a selected entry still has a local route containing its bound root. A changed signature, missing entry or root and an identity that cannot be reproduced fall back to the full resolver. The signature covers only the finite supported root manifest/catalog candidates, including the shared `marketplace.json`, so same-id reroutes and entry removal are observed even while the old directory exists. Market browsing resolves the full source, and project discovery persists no declarations.

The resident discovery map evicts the least recently used entry at 64 entries. The routing-hint map is bounded separately at 64 sources. A mutable source gives its expiry to every derived snapshot, so requesting another projection cannot extend freshness. Installed snapshots retain object identity while reusable, preserving the panel row cache. Scan notes are copied before policy diagnostics are added.

`readInstalledCatalog` and `installedOverview` serve runtime declarations and inventories. MCP and LSP installed-only queries use the same source selection. Globally disabled installed suites remain candidates for explicit session selection. `enabledUserSuites` applies global enablement and keeps the direct user MCP and hooks declarations. Market browsing discovers all configured sources as needed. Without a usable index or routing hint, a source miss still discovers every suite inside that source.

Source mutations durably invalidate affected indexes before changing checkout files, hold affected readers and rebuild discovery before releasing them. Generations prevent an old scan from repopulating resident state. Per-source write ordering prevents an older atomic replacement from overwriting a later invalidation. Failed mutations release waiting readers against invalidated content. Catalog disposal joins its reads and index writes before storage teardown.

An index with invalid JSON, an unsupported schema or a mismatched identity is rebuilt. A missing checkout contributes no cached runtime declarations. Other index I/O failures reject the read. An installed suite missing from the current source is diagnosed in `scanNotes`. Its installation metadata is retained. A discovered replacement is not silently installed, and remote references remain unavailable for runtime mounting.

## Supersession

The [selective runtime discovery note](../../archived/performance/2026-09-07-runtime-selective-discovery.md) is fully superseded and archived. Its no-network startup and no-automatic-pruning guarantees continue here. The [discovery cache note](2026-09-02-catalog-scan-cache.md) is partially superseded: dimension fingerprints, wholesale eviction and common discovery TTLs give way to source indexes, while the skill frontmatter parse cache remains active.

The [measured read-cost note](../performance/2026-10-26-read-costs.md) remains active for overview request coalescing, row cadence, strict parsing, shared project readers and hidden-window polling. This decision replaces its assumption that every visible poll must traverse full discovery. The row-level file checks still preserve visibility of edits to existing documents.

## Alternatives considered

**Keep dimension-wide TTL scans and raise their TTL.** A larger window reduces the scan frequency but retains repeated full scans, expiry latency and a stale-content compromise for managed sources that only the plugin changes. Per-source reuse follows actual content ownership.

**Recursively fingerprint every source.** A correct stamp for a mutable tree must observe nested file edits; a directory mtime cannot do that. A recursive stamp repeats much of the scan cost. Managed HEAD validation is cheap on index load, while mutable trees retain bounded on-demand discovery.

**Persist declarations from mutable sources.** Reusing a saved declaration would miss external edits even when its directory remains in place. Persisting directory and manifest-entry locations narrows the work while fresh reads still parse current files and inline configuration. A finite routing-manifest content check preserves catalog freshness. Full discovery remains the recovery path when that check changes or a hint cannot reproduce the installed identity.

**Delete or prune large source checkouts.** Installed runtime reads do not need unrelated sources, but the user can still browse and install their suites. Removing source content would change that behavior and can damage user-owned working trees. Checkout acquisition and storage remain separate from the discovery optimization.

**Move the index into a host storage service.** The catalog already owns its file roots and runs without a Cordis context. A service-backed cache would still need the source schema, HEAD policy, read barriers and per-source invalidation while adding an activation dependency and another storage layout. Reuse `readJsonFile`, `writeJsonDocument` and `@deepseek-ai/dsh-atomic-write` under the existing [file persistence decision](../../../../docs/developer/decisions/2026-09-13-plugin-persistence-stays-file-backed.md). The host atomic writer supplies safe replacement and file modes. The plugin owns only discovery semantics.

## Consequences

An unchanged managed source incurs no repeated suite traversal when a freshness window expires or a catalog reopens. Sources with no installed suites stay outside runtime discovery. First discovery without a usable saved index or route and explicit refresh still pay for the selected source. Opening Market may scan sources not yet indexed.

Managed checkouts are treated as plugin-maintained content while resident. A user who edits a working tree uses a local or adopted source. Explicit refresh of a managed Git checkout keeps the existing fetch-and-reset behavior. The optional six-hour background source updater is independent of discovery reuse.

The change keeps the existing checkout directories and acquisition behavior. Explicit source removal still unregisters its installs and can delete that source's `.sources/<id>/` directory when `deleteCheckout` is requested, including an adopted checkout. External local paths are preserved. The optimization adds no installation version directories, download trimming or automatic source pruning. Index files are rebuildable derived data. Schema or discovery-semantic changes require an index version bump. Installed suite identities and metadata remain user-owned even when the source no longer contains them.

## Verification

### Synthetic catalog preparation

The [benchmark report](../../../../docs/reference/performance/2026-11-13-catalog-index-benchmark.json) compares baseline `b23faa92` with the changed catalog in Node v24.21.0. Each workload has two sources with 600 suites each and one installed suite. Values are the medians of three samples, rounded to milliseconds. The second phase advances the injected clock by 60 seconds; reopening creates a new `Catalog` in the same process. Fixture creation, module import, network, host mounts and browser work are excluded.

| Source mode | Phase                     | Wall before (ms) | Wall after (ms) | Node CPU before (ms) | Node CPU after (ms) |
| ----------- | ------------------------- | ---------------- | --------------- | -------------------- | ------------------- |
| Managed     | First catalog preparation | 1272             | 445             | 3210                 | 1087                |
| Managed     | After freshness window    | 1210             | 1               | 3021                 | 1                   |
| Managed     | New catalog instance      | 1216             | 15              | 3027                 | 18                  |
| Adopted     | First catalog preparation | 1296             | 449             | 3199                 | 1086                |
| Adopted     | After freshness window    | 1182             | 3               | 2897                 | 3                   |
| Adopted     | New catalog instance      | 1203             | 4               | 2978                 | 5                   |

These are comparisons of the same catalog preparation workload within each source mode. They measure source selection, discovery reuse and mutable binding reads, not full application startup or the cost of mounting runtime services.

### Host startup and idle rescan

The bundled DSH 0.2.2-rc.2 CLI started an isolated `market-demo` profile with two synthetic managed sources of 600 suites each and one enabled install. Project layout discovery, source auto-update, and translation were off. The npm 0.14.5 artifact ran a full discovery for installed declarations alongside the enabled-source discovery. Its keep-warm timer repeated the full discovery about 24 seconds after the initial read, with no browser connected.

| Plugin build                                  | Checkout filesystem calls at startup | Calls during the idle rescan window | Peak process CPU per sampled second |
| --------------------------------------------- | ------------------------------------ | ----------------------------------- | ----------------------------------- |
| npm 0.14.5                                    | 122,539                              | 80,493                              | 2,468 ms                            |
| Indexed, empty index                          | 40,848                               | 0                                   | 1,362 ms                            |
| Indexed, process restart with persisted index | 2                                    | —                                   | 517 ms                              |

Each row is one host launch; the first two were observed for about 30 seconds. The cold indexed launch did not access the unused source. After the indexed restart, the market endpoint still returned all 1,200 suites and the same one installed suite. The Web UI opened the market and found an uninstalled suite by search. The comparison reproduces the host CPU bursts, verifies that the idle rescan stops, and leaves the cause of a sustained Electron renderer hang unresolved.

### Current configured sources

A read-only probe of the current 23 source trees discovered 1,023 suites and wrote derived indexes to a disposable directory. Of 44 installation records, 30 matched current suites and 14 historical unmatched records were retained. The [raw report](../../../../docs/reference/performance/2026-11-13-catalog-index-benchmark.json) records no source-index failures.

| Operation                                           | Samples   | Wall time (ms) | Node CPU (ms) |
| --------------------------------------------------- | --------- | -------------- | ------------- |
| Import all current sources                          | 1         | 1504           | 2685          |
| Reopen `SourceIndexStore` and read installed suites | 3, median | 41             | 55            |
| Read installed suites after the freshness window    | 3, median | 6              | 12            |

Each installed read made 227 `stat`, 74 `readFile`, 48 `realpath` and 56 `readdir` calls. The probe creates new store instances within one process. Both installed-query rows use the same current installation set. Full import and installed-only reads are different workloads, so these rows are not a before/after speed comparison. Node CPU and filesystem counts exclude Git child-process internals and host startup.

## Testing

The source-index tests cover persistent reuse, source identity and revision validation, mutable freshness, bound-directory rescans, inline LSP equivalence after reopening, same-id catalog rerouting and removal, resolver fallback, native MCP OAuth metadata round trips, missing checkouts, corrupt documents and generation ordering. Catalog runtime tests cover installed-source selection and concurrent reads. Panel and project tests protect snapshot identity, document freshness and project isolation. Disabled-consumer and shared-demand tests protect explicit session selection and revocation.
