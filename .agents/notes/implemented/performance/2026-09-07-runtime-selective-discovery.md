# Agent Note: Selective runtime source discovery

Status: implemented

## Problem

Plugin activation used the full market catalog to build runtime mounts and skill candidates. Large configured sources that contained no enabled suites still paid the complete filesystem scan during session startup.

## Decision

Runtime reads derive the enabled source ids from persisted install state and scan only those sources. MCP overrides accept the selected suite set. Concurrent scans are coalesced and stale in-flight results cannot repopulate caches after invalidation. Market overview remains full-scan so its source and suite inventory is unchanged.

This partially supersedes the invalidation mechanism in [the discovery cache note](../architecture/2026-09-02-catalog-scan-cache.md); its TTL, bounded cache and frontmatter caching decisions remain active.

## Alternatives considered

- **Delete or prune source checkouts automatically** was rejected because source contents are user-managed and may be needed for later installation.
- **Refresh Git sources in the background** was rejected because startup must not introduce network or proxy latency.
- **Client-side lazy loading** was rejected because runtime providers still need deterministic server-side suite data.

## Consequences

Startup runtime work scales with the contents of sources containing enabled suites. It still scans all suites within a selected source. Sources with no enabled installs remain available in the market page and are scanned only when that full catalog is requested. Source refresh and content mutations invalidate the runtime and market discovery generations. Project-native discovery is unchanged.

## Verification

`tests/catalog-runtime.test.ts` covers zero-enabled cold reads, source selection, concurrent coalescing, and invalidation. Typecheck, lint, and focused Vitest suites pass.
