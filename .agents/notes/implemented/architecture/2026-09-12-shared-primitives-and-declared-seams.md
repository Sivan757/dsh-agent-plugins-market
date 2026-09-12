# Agent Note: Shared primitives and declared layer seams

Status: implemented

## Problem

Three structural problems had accumulated behind a green gate.

`src/application/catalog.ts` was a 1,260-line class owning six unrelated responsibilities: persisted state and the mutation queue, the scan and snapshot caches, source acquisition, install state, the MCP and LSP use cases, and the presentation queries. Its dependencies arrived through seven post-construction setters plus one public mutable field, wired from thirteen call sites inside a 347-line `apply()`, so the complete set could only be learned by diffing the constructor options against the setter names. It value-imported `src/runtime/` sixteen times, which `docs/design/engineering-refactor-plan.md` declares as the wrong direction — with no gate either way.

Three of the five runtime mount registries — MCP, LSP and hooks — implemented the same algorithm once per surface: serialize reconcile passes, mount what appeared, unmount what went away, retry the transient failures on a bounded backoff, collect diagnostics, dispose in order. The retry schedule, the queue body and the disposal tail were byte-identical between MCP and LSP and had already drifted. The other two registries, commands and user commands, carry no queue or backoff; they were examined and left alone. The per-server view — look up the override, skip a disabled one, apply the patch, collect credential references — was written five times with three different casts.

Two gates claimed to cover Node boundaries and could not. dependency-cruiser keeps `node:*` edges out of its module graph, so `client-cannot-import-node` was inert, and `src/model/state.ts` — the one domain module importing `node:fs/promises` — was carved out of the model rule instead of being moved.

## Decision

One owner per invariant, one home per mechanism, and a working gate for every boundary the code claims to hold.

**`Catalog` becomes a facade over collaborators.** `CatalogContext` owns what must not be duplicated: the persisted state, the serialized mutation queue, the revision and scan generations, the invalidation pipeline and the install-state projection. `SnapshotCache`, `SourceStore`, `InstallStore`, `McpService` and `LspService` each take the context and own one use-case family. There is still exactly one queue and one generation counter ([scan cache](2026-09-02-catalog-scan-cache.md) depends on that). The facade is 355 lines; the constructor keeps accepting exactly `{ userRoot, dataRoot, onChanged, git?, projectSnapshotTtlMs?, userSnapshotTtlMs? }` with one new optional `ports`, so a bare construction still works.

**The dependency set is declared, not discovered.** `CatalogPorts` names every host seam, and `resolveCatalogPorts` fills the defaults under it. Late resolution is preserved deliberately: the settings and tools services resolve after `apply()` runs, so those closures are read at call time, not captured. The throwing default moved out of the class body into the defaults object, where the composition root can see it.

**One mount lifecycle.** `src/runtime/mount-lifecycle.ts` owns the serial pass queue, the retry scheduler and the mount-handle shape. Each registry keeps its own mount semantics and supplies its own retry predicate — MCP retries everything except a foreign or duplicate mount, LSP never retries a missing capability package.

**One per-server projection.** `effectiveMcpServers` owns the override cast, `applyOverride` and the credential references. It carries `enabled` instead of filtering, because the two consumers need opposite things: the status inventory renders an override-disabled declaration, and the mount registry skips it. This is the one place the refactor's own audit was wrong: the first implementation applied the "skip disabled" rule literally and dropped those rows from the status payload. The suite stayed green because nothing covered the case, so the trap was created and closed inside this work — the added test pins new behaviour, not a baseline.

**The composition root composes.** `apply()` drops from 349 to 183 lines: reconcile coalescing and the credential-notification debounce move to `reconcile-scheduler.ts`, the settings namespace with its watchers, project-layout sync and feedback gating move to `settings-namespace.ts`, and the MCP credential record key is shared with the OAuth provider that writes it in `mcp-auth-record.ts`. The single `settings.register` call and its deliberate failure containment are unchanged ([scheduling](2026-09-08-runtime-reconciliation-scheduling.md) still holds).

**The boundaries became enforceable.** The state codec moves to `src/runtime/state-store.ts`, so `src/model/` is records only and the rule needs no exception. The two inert dependency-cruiser node rules are replaced by `no-restricted-imports` in `eslint.config.mjs`, which does see those imports, covering `src/model`, `src/contracts` and `src/client`. dependency-cruiser gains `contracts-import-nothing`, `model-cannot-import-server-layers` and `application-cannot-import-client-routes-or-index`.

Alongside the structure: seven catalog exports with no consumer (including three abandoned manifest readers), three `Catalog` members with no caller (`subscribe` and its listener set, `enabledSuitesForCwd`, `suitesForDimension`), a shadowed `hasSuiteManifest`, the duplicated filesystem probes and five hand-rolled path-containment checks, 69 CSS classes and 56 locale keys referenced nowhere, three client API helpers, `PanelShell`/`PanelAction`, and thirteen copies of the same fetch boilerplate in `api.ts`. A fourth candidate, the `userRoot` getter, stayed because a test reads it.

## Alternatives considered

- **Keep `Catalog` monolithic and document the six responsibilities.** Rejected: the setters and the mutable field made an unwired dependency a runtime failure rather than a compile error, and every new use case added a seventh concern to the same file.
- **Move the persisted stores into `src/application/` so the design plan's arrow (`application -> model, catalog, contracts`) literally holds.** Deferred, not rejected: those stores perform filesystem work that `AGENTS.md` assigns to `runtime/` or `application/`, so the move is legitimate, but it relocates a dozen modules that runtime also imports. The coupling is declared through `CatalogPorts` now; the file move remains an open gap rather than a half-done one.
- **One generic mount-registry class for every surface.** Rejected: the registries differ in what they mount, what a failure means and how disposal orders. Only the mechanism is shared, so only the mechanism was extracted.
- **Delete the inert dependency-cruiser node rules without replacement.** Rejected: the boundary is real and the ESLint rule enforces it. A rule that cannot fire is worse than no rule, because it reads as coverage.
- **Keep the five-behaviour per-server rule at each call site.** Rejected: it had already diverged, and the divergence was a silent behaviour difference rather than a style one.

## Consequences

- `src/` is flat in size (22,140 → 22,115 lines). This is a structure change, not a line-count change: the split adds module scaffolding while removing duplication. What moves is the maximum: the largest source file drops from 1,260 to 551 lines, `apply()` from 349 to 183, `src/client/` shrinks by 624 lines, `src/catalog/` by 127.
- The refactor found a real defect outside its scope: `redactUrl`/`redactValue` probed a global `RegExp` with `.test()`, so `lastIndex` advanced between calls and every second `${...}` credential reference in one value was replaced with `[redacted]` — the opposite of what the module documents. Fixed with a non-global pattern and pinned by two regression cases that fail against the previous code.
- Test totals move 504 → 507: one test asserting a removed implementation-detail export was replaced by the behaviour it covered through `archiveInstall`, and four cases were added (three for the redaction defect, one pinning an override-disabled server to the status inventory).
- Still duplicated on purpose: `details.ts` and the MCP service derive their own view of a server because they must show disabled declarations and the un-redacted source shape; `commands-mounts.ts` and `user-commands.ts` share a wanted-diff-register table whose two call sites disagree on descriptions, diagnostics and reconcile signature. Both were judged below the bar rather than merged for symmetry.
- The LSP panel's new view model is covered by the panel render tests rather than a unit test; a unit test would be the stronger guard.
- `src/application/` may still import `src/runtime/`; that direction stays declared-and-deferred rather than banned.

## Verification

- `pnpm run check:refactor` — both TypeScript projects, ESLint, Prettier, the contract suites and dependency-cruiser — green.
- `pnpm run test` — 70 files, 507 tests.
- `pnpm run build` — emits `lib/` and the client bundle.
- Each new ESLint boundary was proven to fire by importing `node:path` into a file in each covered layer; each new dependency-cruiser rule was proven to fire with a temporary probe file.
- The redaction fix was verified by restoring the previous module and watching the two new cases fail.
- The mount-lifecycle extraction was checked old-against-new with a throwaway harness under fake timers: identical diagnostics, disposal order, attempt timestamps and give-up line for both surfaces.
