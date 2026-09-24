# Module cohesion and layering plan

## Status

Proposal — not yet accepted. This page responds to three maintainer complaints about the source tree: MCP code is not stored beside MCP code, some shared interfaces are not extracted, and module files are scattered. Every claim below was verified against the `dev` checkout on 2026-09-25. Accepting this plan means recording it as an ADR (see [Stage C0](#stage-c0--record-the-decision-and-repair-the-gates)) with a supersession check against [ADR 0001](../decisions/0001-catalog-centered-modular-refactor.md) and the [shared primitives note](../../../.agents/notes/implemented/architecture/2026-09-12-shared-primitives-and-declared-seams.md).

## What the complaints look like as measured facts

### MCP code lives in six top-level places

| Layer | MCP-owned files | Notes |
| --- | --- | --- |
| `src/catalog/` | `codex-mcp.ts`, the `mcp.json` half of `validate.ts` | Dialect validation — correctly in catalog |
| `src/application/` | `mcp-service.ts` (446 lines) | One flat file for six use-case families |
| `src/contracts/` | `mcp-status.ts` | Correctly placed wire contract |
| `src/runtime/` root | 9 files: `mcp-backend`, `mcp-config`, `mcp-mounts`, `mcp-overrides`, `mcp-redaction`, `mcp-status`, `mcp-credentials`, `mcp-direct-config`, `mcp-auth-record` | Mixed with 35 unrelated files in one flat directory |
| `src/runtime/mcp-client/` | 11 bridge files (`bridge`, `connection`, `oauth`, `transport`, `tools`, `projection`, …) | The only domain that already earned a subfolder |
| `src/client/` root | `McpStatusPanel.tsx` (903 lines — the largest file in the repository), `McpPluginCard.tsx`, `McpCredentialEditor.tsx`, two `.module.css` | While the matching view model sits in `features/mcp-status/` |

The LSP family shows the same shape at half the size: 4 `lsp-*` files at the runtime root, 1 application service, 1 contract, a 513-line panel at the client root beside a one-file `features/lsp-status/`.

### Shared code that several modules reimplement

- **JSON state persistence.** Twelve files call `writeFileAtomic` and hand-roll the same pair of loops around it: read-with-ENOENT-tolerance, validate, write with `mode: 0o600` / `dirMode: 0o700`. The set spans `state-store`, `mcp-overrides`, `mcp-direct-config`, `lsp-direct-config`, `lsp-server-state`, `server-config`, `user-store`, `profile-seam`, `storage-migration`, `hooks-mounts`, `feedback-tool`, and `application/panel-resources`.
- **Seam types leaked across the layer boundary.** `application/ports.ts` imports `McpBackend` from `runtime/mcp-backend`, `LspMountStatusSource` from `runtime/lsp-status`, and `McpToolSnapshot` from `runtime/mcp-status`; `queries.ts` imports `McpImportResult` from `runtime/mcp-direct-config`. Two of these are structural types that `ports.ts` could declare itself — it already does exactly that for the credential store and the LSP status source's own shape.
- **One module serving two domains.** `runtime/server-config.ts` validates, redacts, restores, and persists both MCP and LSP configuration; `application/mcp-service.ts` imports the LSP loaders `loadLspServers` / `saveLspServers` directly.
- **The client status panels.** `McpStatusPanel.tsx` renders the inventory, the filter toolbar wiring, the detail dialog, and the credential editor flow in one 903-line component; `LspStatusPanel.tsx` (513 lines) repeats the card, pill, and dialog patterns and imports the same `mcp-status.module.css` the MCP panel uses.

### Flat directories

`src/runtime/` holds 44 top-level TypeScript files plus one subfolder. `src/client/` holds 24 files at the root while `features/` (13 files) and `ui/` (27 files) already exist beside it. Finding "everything the MCP backend switch touches" requires grepping; nothing in the tree answers it.

### The layering arrow is inverted and the enforcing gate is gone

`src/application/` imports `src/runtime/` 40 times across 11 files into 18 distinct runtime modules. The [engineering refactor plan](engineering-refactor-plan.md) draws the arrow the other way (`application -> model, catalog, contracts, and the runtime effects it drives`), and the [shared primitives note](../../../.agents/notes/implemented/architecture/2026-09-12-shared-primitives-and-declared-seams.md) explicitly deferred the store move that would fix it.

The boundary that is supposed to compensate — `no-restricted-imports` banning `node:**` from `src/model`, `src/contracts`, and `src/client`, documented in the header comment of `.dependency-cruiser.cjs` — was removed from `eslint.config.mjs` in commit `f72bef2` (`chore(lint): turn on the rules that need type information`), which replaced the two-block config with one block and dropped the second. No violations exist today (all three layers are currently free of `node:` imports), so restoring the rule lands green.

## What stays as it is

The five-layer skeleton — `model` → `contracts` → `catalog` → `application` → `runtime`, with `client` beside it and the composition root at `src/index.ts` + `src/routes.ts` — is correct, gated, and the product of [ADR 0001](../decisions/0001-catalog-centered-modular-refactor.md). Vertical feature slices remain rejected for the reason that plan records: discovery, install-state enrichment, cache invalidation, and enabled-suite calculation are shared by every surface, so slicing by feature would recreate the catalog read model implicitly and spread its ownership. This plan therefore groups **domains inside layers**, not layers inside domains.

Also unchanged: `catalog/`'s MCP and LSP validation stays in `catalog/` (it is dialect validation — the [vocabulary](../../../CONTEXT.md) separates the layout dialect from the runtime surface); the cordis plugin name, `Config` schema, route paths, `state.json` format, and the two package exports stay byte-identical; no new npm packages, no generic mount registry (the shared-primitives note already rejected it), no merge of the `commands` / `user-commands` wanted-diff tables (judged below the bar there).

## Target structure

```text
src/
  model/                    unchanged
  contracts/                unchanged, plus McpBackend and the two mount-diagnostic
                            wire types move here (see "Extracted shared interfaces")
  catalog/                  unchanged

  application/
    catalog.ts              facade — unchanged role
    catalog-context.ts      unchanged
    ports.ts                declares every structural seam type itself
    queries.ts              unchanged
    details.ts              unchanged
    json-file.ts            NEW — the shared persistence primitive
    state/                  state-store.ts, storage-migration.ts, legacy-root-migration.ts
    sources/                source-store.ts, regions.ts
    install/                install-store.ts
    snapshots/              snapshot-cache.ts
    mcp/                    service.ts, overrides.ts, redaction.ts, direct-config.ts,
                            validation.ts (MCP half of server-config.ts), status.ts
    lsp/                    service.ts, direct-config.ts, server-state.ts,
                            validation.ts (LSP half of server-config.ts), status.ts
    panels/                 panel-resources.ts, document-store.ts (was runtime/user-store.ts)
    agents/                 project-agent-roles.ts
    deadline.ts             ◇ borderline — pure wait helper on a host library

  runtime/
    core/                   reconciler.ts, reconcile-scheduler.ts, mount-lifecycle.ts,
                            timer-seat.ts, source-auto-update.ts
    mcp/                    mounts.ts, config.ts, backend.ts, credentials.ts,
                            auth-record.ts, bridge/ (the 11 mcp-client files, renamed
                            neither in API nor in behavior)
    lsp/                    mounts.ts, profile-seam.ts
    surfaces/               skills-provider.ts, commands-mounts.ts, hooks-mounts.ts,
                            dynamic-context.ts
    panels/                 user-panels.ts, user-commands.ts, user-hooks.ts
    agents/                 agent-role-names.ts, agent-role-router.ts, subagent-catalog.ts
    host/                   host-locale.ts, settings-namespace.ts, model-catalog.ts,
                            tool-registry-observer.ts, plugin-message-source.ts,
                            feedback-tool.ts, failure-detail.ts

  index.ts                  composition root — unchanged role
  routes.ts                 HTTP adapter — unchanged role

  client/
    index.ts, api.ts, locales.ts, request-error.ts, ErrorBoundary.tsx
    workspace/              PluginWorkspace.tsx, page-mode.tsx, page-mode-selection.ts,
                            workspace.module.css
    features/market/        + MarketSection.tsx, SuiteDetail.tsx, SearchFilterToolbar.tsx,
                            market.module.css
    features/mcp/           StatusPanel.tsx (decomposed from McpStatusPanel), rows + detail
                            dialog + toolbar children, McpCredentialEditor.tsx,
                            both .module.css, view models, detail-actions.ts
    features/lsp/           LspStatusPanel.tsx, view model, stylesheet
    features/personas/      unchanged
    features/settings-card/ plugin-card-controller.ts, McpPluginCard.tsx ◇ (see open questions)
    ui/                     unchanged
```

Rows marked ◇ are borderline; the moving PR decides them and records the reason in its description. The mapping is best-effort per file, but the folder set is the decision: **application gains the domain folders `mcp/` and `lsp/` and the store folders; runtime gains `core`, `mcp`, `lsp`, `surfaces`, `panels`, `agents`, `host`; the client root keeps only entry, transport, locale, and error-boundary files.**

After the move, an MCP change reads from five homes instead of six scattered ones, and each one is the single home of its concern: `contracts/mcp-status.ts` (wire), `catalog/validate.ts` (dialect validation), `application/mcp/` (use cases, overrides, redaction, direct config, status projection), `runtime/mcp/` (bridge, mounts, backend, credentials), `client/features/mcp/` (panel, card, editor).

## Extracted shared interfaces

1. **`application/json-file.ts`** — one owner for the read-tolerant / validate / atomic-write loop: `readJsonFile` (ENOENT → caller default), `writeJsonFile` (atomic, 0o600 / 0o700), and a `migrate` hook for the two modules that version their documents. The twelve adopter sites keep their public module APIs unchanged; only the loop bodies collapse.
2. **Structural seam types move into `ports.ts`** — `McpToolSnapshot`, and the diagnostics-feed shapes. `ports.ts` already declares `CredentialGrantStore` and `LspMountStatusSource` this way; structural typing keeps the runtime implementations assignable without an import.
3. **Wire-owned types move into `contracts/`** — `McpBackend` (a `'builtin' | 'host'` literal union, already re-exported as `McpBackendInfo` from `contracts/market.ts`), `McpMountDiagnostic`, `LspMountDiagnostic`. The mount registries import them from contracts, which runtime may already depend on.
4. **`server-config.ts` splits by domain** — MCP validation and redaction-restore into `application/mcp/validation.ts`; LSP validation, override load/save/apply into `application/lsp/validation.ts`. `mcp-service` stops importing LSP loaders; the shared `serverConfig(kind)` route keeps one endpoint and dispatches to the owning service.
5. **`McpStatusPanel` decomposes** — inventory rows, detail dialog, and toolbar children become components under `features/mcp/`, each under the existing stylesheet contract. Target: no client file above ~450 lines; the panel keeps its rendered output identical (pinned by the render tests and a browser GIF per repository convention).

## Dependency rules after

```text
model        -> nothing
contracts    -> nothing
catalog      -> model
application  -> model, contracts, catalog, application
runtime      -> model, contracts, application
index/routes -> everything
client       -> contracts, client only
```

The one intentional change: **`application` no longer imports `runtime`.** The arrow flip becomes enforceable because the mis-homed modules move (stores, projections, pure validators) and the remaining needs are satisfied by structural types in `ports.ts` and wire types in `contracts/`.

Gate updates in the same PRs:

- `.dependency-cruiser.cjs`: promote `application-cannot-import-runtime` (new rule; start as `warn` in Stage C1, `error` from Stage C2 on). Existing prefix rules keep matching subfolder moves unchanged.
- `eslint.config.mjs`: restore the `no-restricted-imports` block for `src/model`, `src/contracts`, `src/client` (the header comment in `.dependency-cruiser.cjs` already documents this enforcement point; the code stopped matching the comment in `f72bef2`).
- Optional, cheap: four enumerated `dep-cruiser` rules keeping `src/client/features/<name>` from importing a sibling feature folder.

## Delivery stages

Each stage lands behind `pnpm run check:refactor` plus the affected test files; each is a separate PR. Test **file names stay stable** through C1–C3, so the enumerated client-test lists in `tsconfig.test.json` and `tsconfig.test.client.json` do not churn — only import lines inside tests change.

### Stage C0 — record the decision and repair the gates

A new date-named ADR accepting this plan (the decisions folder has moved from sequence numbers to dates), supersession check against ADR 0001 and the shared-primitives note; restore the ESLint boundary block and prove it fires with a probe file; add the `warn`-severity `application-cannot-import-runtime` rule so the 40-import debt is visible in every subsequent run. No module moves.

### Stage C1 — the shared persistence primitive

Add `application/json-file.ts`, adopt it in the twelve sites. Pure refactor; the persisted byte format is pinned by the existing store tests.

### Stage C2 — relocate the mis-homed modules and flip the arrow

Move the pure modules from `runtime/` to `application/` (`state-store`, `storage-migration`, `legacy-root-migration`, `regions`, `mcp-overrides`, `mcp-redaction`, `mcp-direct-config`, `mcp-status`, `lsp-direct-config`, `lsp-server-state`, `lsp-status`, `user-store`; split `server-config`); hoist the seam and wire types; then promote the depcruiser rule to `error`. Source churn: ~20 files' import lines plus ~15 test files. `legacy-root-migration.ts` has no importer under `src/` (only its own test reaches it) — confirm deletion against the manual-repair flow before moving it rather than relocating dead code. Update the repository-layout section of [AGENTS.md](../../../AGENTS.md) and the module map in the [engineering refactor plan](engineering-refactor-plan.md) in the same PR.

### Stage C3 — runtime and application domain folders

Execute the folder moves inside `runtime/` (`core`, `mcp` absorbing `mcp-client/`, `lsp`, `surfaces`, `panels`, `agents`, `host`) and inside `application/` (`state`, `sources`, `install`, `snapshots`, `mcp`, `lsp`, `panels`, `agents`). Up to 58 test files get mechanical import-line updates. No public export, route, or persisted format changes.

### Stage C4 — client regrouping and the panel decomposition

Move the six MCP/LSP root files and the market/workspace files into their feature folders; isolate the legacy adapter under `workspace/` as the engineering plan already calls for; decompose `McpStatusPanel`. GUI-visible-only changes to file layout need the browser GIF attachment rule; the decomposition itself is pinned by render tests.

## Cost and risk

| Stage | Touches                                                            | Risk                                                                         |
| ----- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| C0    | 2 config files + 1 ADR                                             | None                                                                         |
| C1    | ~13 source files                                                   | Low — behavior pinned by store tests                                         |
| C2    | ~35 source + ~15 test files (import lines + type hoists)           | Medium — the arrow flip is type-level only; no runtime behavior change       |
| C3    | ~55 runtime/application files + up to 58 test files (import lines) | Low — mechanical, fully covered by `check:quick` + suite                     |
| C4    | ~20 client files                                                   | Medium — the panel decomposition is the one stage with UI regression surface |

The whole sequence preserves the published package surface: `tsconfig.json` includes `src/**/*.ts`, `tsdown` enters at `src/client/index.ts`, and consumers import only `.` and `./client`.

## Rejected alternatives

- **Vertical slices (`src/mcp/`, `src/lsp/` each with own layers).** Rejected for the recorded reason: the catalog read model is shared; slicing spreads its ownership. Domain folders _within_ the existing layers deliver the cohesion without that cost.
- **Moving `catalog/`'s `mcp.json` validation into the MCP domain.** Rejected: dialect validation belongs to the scanning layer; the [glossary](../../../CONTEXT.md) keeps dialect and surface as separate axes.
- **A generic status-builder abstraction shared by MCP and LSP.** Deferred: the two builders share a shape (declarations + diagnostics → rows) but differ in every state derivation; a shared abstraction would be structure without a shared invariant. Revisit only when a third status surface appears.
- **Doing nothing.** The measured costs are already real: a 903-line panel, 40 inverted imports, 12 duplicated persistence loops, and a boundary gate whose documented enforcement does not exist.

## Open questions

1. `McpPluginCard.tsx` serves the host's plugin-settings card, not the market page — `features/settings-card/` (separating it from the status feature) or `features/mcp/` (keeping MCP together)? This plan leans settings-card; the card's controller already lives beside the settings namespace, not the status domain.
2. `deadline.ts`: application support module or `runtime/core`? It wraps a host library's primitive and has no harness-context access; this plan leans application.
3. Should `client/features/*` isolation become enumerated depcruiser rules now, or after the C4 folder set stabilizes?
