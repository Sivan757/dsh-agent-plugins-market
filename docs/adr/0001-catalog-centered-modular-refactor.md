# Keep one npm plugin and center the internal refactor on Catalog

The plugin will remain one published npm package with stable host/client entry points, while internal responsibilities move behind a deep `Catalog` application module that produces coherent discovered-and-install-enriched snapshots. We choose this targeted modular refactor over vertical feature slices because discovery, install state, enabled-suite derivation, runtime reconciliation, and client projections share one data source; keeping that seam centralized limits change amplification without introducing multiple-package release coordination.

## Considered options

- **Catalog-centered modular refactor — accepted.** ~~Preserve `SuiteManager` as a temporary compatibility facade, centralize catalog snapshots, and migrate callers incrementally.~~ The facade has been deleted (see Status); all callers now use `application/Catalog` directly.
- **Vertical feature slices with a new runtime coordinator — rejected for now.** This would move ownership to user-facing features while still requiring a shared catalog/read model, increasing migration risk and distributing cache invalidation.

## Status

The `SuiteManager` facade was deleted after its deletion condition was met — routes, the skill provider, and host composition no longer depend on it. The `discovery.ts` compat facade was deleted at the same time. The layer directories `model/`, `catalog/`, `application/`, `runtime/`, `contracts/`, and `client/features/` + `client/ui/` are in place. Host entry points (`index.ts`, `routes.ts`) remain at the `src/` root deliberately; moving them into `host/` would require entry-point path adjustments that add risk without behavioral value.

## Consequences

Runtime user-suite queries select sources from enabled install state before discovery; market queries retain the full configured source inventory. Both use the same scanner and bounded discovery cache. Content invalidation clears all scan entries and increments a generation so older in-flight work cannot repopulate caches. Identical concurrent scans share one promise. This preserves Catalog ownership without making session initialization pay for uninstalled sources.

New layout dialects belong in discovery/scanner code and fixtures; runtime mounts and client modules do not parse source formats. MCP, command, and hook mounts remain separate because their host APIs and failure semantics differ. Compatibility code requires tests and an explicit deletion condition; it is not a permanent second implementation.
