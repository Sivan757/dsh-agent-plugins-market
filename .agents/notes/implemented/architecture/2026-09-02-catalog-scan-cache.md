# Agent Note: Catalog discovery scan cache and parallel suite traversal

Status: implemented

## Problem

The user-dimension catalog scanned every checkout from disk on every snapshot build. With real-world marketplaces installed (a 1,874-suite community marketplace, a 465-suite pack; ~2,650 suites total), one cold build cost ~1.1 s, dominated by CPU-bound suite reads (manifest detection, frontmatter parsing, surface counting) rather than I/O. Because `notifyChanged()` invalidated the whole snapshot and the client refetches the overview after every action, routine UI operations — installing, toggling a suite, opening the MCP/LSP panels right after a mutation — each paid a full ~1.1 s rescan. The panels' payloads themselves were cheap (warm MCP status ~55 ms); the rescan churn was the entire latency problem.

A parallelized traversal (replacing the sequential per-directory `collectRoot` recursion with ordered concurrent child traversal) measurably did _not_ help (~730 → ~700 ms; `UV_THREADPOOL_SIZE` scaling confirmed the cost was not fs-thread-pool-bound either), so the fix had to be caching, not concurrency.

## Decision

Two layered caches in the catalog, both bounded and both preserving the mutation paths that genuinely need fresh data:

- **Discovery scan cache** (`Catalog.buildSnapshot`): scan results keyed by a fingerprint of `[dimension, dimensionRoot, state.sources]`, TTL 30 s, ≤8 entries. Snapshot derivation (installed/enabled/surfaces mapping over ~2,650 suites) always re-runs from cached discovery — that mapping is ~25 ms. State-only mutations (`install`, `uninstall`, `setEnabled`, `setSurface`, `setMcpOverride`, `setLspServers`, `retryMounts`, `setMcpBackend`, `reauthorizeMcpServer`) pass `keepScanCache = true` through `notifyChanged` and re-derive from cache. Content mutations (add / update / remove / adopt / refresh / acquire / `mergeSources` / `load`) set `scanCacheDirty`, which bypasses the cache for exactly the next scan; a completed fresh scan clears the flag (the initial implementation forgot this and the cache never hit — caught by measurement, not tests).
- **Skill frontmatter parse cache** (`surfaces.ts`): `SKILL.md` parse verdicts keyed by path, stamped by `mtimeMs`+`size`, capped at 20 000 entries with a wholesale reset. Rescans after TTL expiry re-stat files but skip re-reading and re-parsing thousands of frontmatters; a measured post-refresh rescan dropped ~1.1 s → ~0.44 s.

Staleness contract: local sources are still read in place, but working-tree edits become visible on the next cache refresh — any source mutation, the refresh button, or the 30 s TTL. Project-dimension snapshots with TTL 0 (`projectSnapshotTtlMs <= 0`, caching explicitly disabled) bypass the scan cache entirely, keeping their observe-every-read semantics (pinned by `tests/native-project.test.ts`).

## Alternatives considered

- **Content-stamped per-source invalidation** (git HEAD / directory mtimes) was rejected: git sources are cheap to stamp but local sources are not — directory mtimes miss file edits, and a correct recursive stamp costs nearly as much as the scan.
- **Client-side lazy loading** (render sources, stream suites) was deferred: it changes the wire contract and UI flow, while the server-side cache removes the actual latency users felt.
- **Parallelizing suite reads further** was measured to be pointless — the workload is CPU-bound in parsing, not I/O-bound.

## Risks

- A 30 s staleness window for local-source live edits (documented in both READMEs); anyone editing a SKILL.md and expecting instant market-page updates must refresh or mutate a source.
- The parse cache keys by path only across scans: a deleted-and-recreated file with identical mtime/size would serve the old verdict — practically unreachable (mtime granularity) but noted as a known stamp weakness.
- Wholesale cache reset at the cap makes one scan after 20 000 skill files change slightly slower; acceptable at marketplace scales.

## Verification

- `tests/native-project.test.ts` pins the TTL-0 bypass; the full suite (277 tests) stays green; `check:refactor` green.
- Measured on the live `~/.dsh/agent-plugins` catalog (~2,650 suites): cold overview ~1.2 s (once per boot/content change), post-toggle overview ~26 ms (was ~1.1 s), warm MCP status ~55 ms, LSP status ~1 ms, post-refresh rescan ~0.44 s (parse cache warm).
