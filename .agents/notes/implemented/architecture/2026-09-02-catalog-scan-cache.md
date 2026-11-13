# Agent Note: Catalog discovery scan cache and parallel suite traversal

Status: implemented

## Problem

The user-dimension catalog scanned every checkout from disk on every snapshot build. With real-world marketplaces installed (a 1,874-suite community marketplace, a 465-suite pack; ~2,650 suites total), one cold build cost ~1.1 s, dominated by CPU-bound suite reads (manifest detection, frontmatter parsing, surface counting) rather than I/O. Because `notifyChanged()` invalidated the whole snapshot and the client refetches the overview after every action, routine UI operations — installing, toggling a suite, opening the MCP/LSP panels right after a mutation — each paid a full ~1.1 s rescan. The panels' payloads themselves were cheap (warm MCP status ~55 ms); the rescan churn was the entire latency problem.

A parallelized traversal (replacing the sequential per-directory `collectRoot` recursion with ordered concurrent child traversal) measurably did _not_ help (~730 → ~700 ms; `UV_THREADPOOL_SIZE` scaling confirmed the cost was not fs-thread-pool-bound either), so the fix had to be caching, not concurrency.

## Decision

The dimension-wide discovery cache is superseded by [source-owned discovery indexes](2026-11-12-source-owned-discovery-indexes.md). This note continues to own skill frontmatter parse reuse during a source scan.

- **Skill frontmatter parse cache** (`surfaces.ts`): `SKILL.md` parse verdicts keyed by path, stamped by `mtimeMs`+`size`, capped at 20 000 entries with a wholesale reset. Rescans after TTL expiry re-stat files but skip re-reading and re-parsing thousands of frontmatters; a measured post-refresh rescan dropped ~1.1 s → ~0.44 s.

[Source-owned discovery indexes](2026-11-12-source-owned-discovery-indexes.md) own source freshness and invalidation. During an actual scan the frontmatter cache still stats each skill file before reusing its parse verdict. Project-dimension snapshots with TTL 0 (`projectSnapshotTtlMs <= 0`) observe discovery on every read, as pinned by `packages/market-bundle/test/integration/native-project.test.ts`.

## Alternatives considered

- **Recursively stamp mutable source contents to avoid discovery.** Directory mtimes miss file edits, and a correct recursive stamp costs nearly as much as the scan. The [source index decision](2026-11-12-source-owned-discovery-indexes.md) separates this mutable-tree policy from cheap HEAD validation of managed sources.
- **Client-side lazy loading** (render sources, stream suites) was deferred: it changes the wire contract and UI flow, while the server-side cache removes the actual latency users felt.
- **Parallelizing suite reads further** was measured to be pointless — the workload is CPU-bound in parsing, not I/O-bound.

## Consequences

- Frontmatter reuse reduces document reads and parsing during a scan. It does not avoid the file stats or directory traversal of discovery.
- The parse cache keys by path only across scans: a deleted-and-recreated file with identical mtime/size would serve the old verdict — practically unreachable (mtime granularity) but noted as a known stamp weakness.
- Wholesale cache reset at the cap makes one scan after 20 000 skill files change slightly slower; acceptable at marketplace scales.

## Verification

- `packages/market-bundle/test/integration/native-project.test.ts` pins TTL-0 discovery. Current discovery behavior and verification are owned by the [source index note](2026-11-12-source-owned-discovery-indexes.md).
- Measurements recorded for this cache decision on the live `~/.dsh/agent-plugins` catalog (~2,650 suites): cold overview ~1.2 s, post-toggle overview ~26 ms (was ~1.1 s), warm MCP status ~55 ms, LSP status ~1 ms, post-refresh rescan ~0.44 s with warm frontmatter parses. These are historical parse-cache measurements, not timings for the source-indexed catalog.
