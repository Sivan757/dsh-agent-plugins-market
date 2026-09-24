# Module cohesion: domain folders inside the layer skeleton

## Context

Three maintainer complaints about the source tree: MCP code is not stored beside MCP code, several shared interfaces are not extracted, and module files are scattered. The [module cohesion plan](../design/module-cohesion-plan.md) measures each one: the MCP domain spans six top-level locations (catalog validation, one 446-line application service, nine files at the `src/runtime/` root beside 35 unrelated ones, an eleven-file bridge subfolder, and a 903-line client panel at the root while its view model sits in a feature folder); twelve modules hand-roll the same read-tolerant / validate / atomic-write JSON loop; and `src/application/` imports `src/runtime/` forty times across eleven files, inverting the arrow the [engineering refactor plan](../design/engineering-refactor-plan.md) draws.

Two gates that should hold boundaries were also found broken. The `no-restricted-imports` block banning `node:` imports from `src/model`, `src/contracts`, and `src/client` — the enforcement point `.dependency-cruiser.cjs`'s header comment names — was dropped from `eslint.config.mjs` in `f72bef2` when the type-aware rules were turned on. No rule at all covers `application -> runtime`, so the inverted arrow has nothing pushing it back.

## Decision

1. **Group domains inside layers, not layers inside domains.** The five-layer skeleton from [ADR 0001](0001-catalog-centered-modular-refactor.md) stands. Each layer gains domain folders (`runtime/mcp`, `runtime/lsp`, `application/mcp`, `application/lsp`, `client/features/mcp`, …) so one concern's files sit adjacent within the layer that owns their kind. Vertical slices stay rejected for the reason ADR 0001 records: the catalog read model is shared by every surface.
2. **Extract the shared persistence primitive.** One `json-file` module owns the ENOENT-tolerant read, the validation hook, and the atomic 0o600 write. Adopters keep their public module APIs.
3. **Flip the application→runtime arrow and gate it.** Pure modules living in `runtime/` (stores, projections, validators, region routing) move to `application/`; structural seam types are declared in `ports.ts`; wire-owned types (`McpBackend`, the mount-diagnostic shapes) move to `contracts/`. The depcruiser rule `application-cannot-import-runtime` is added at `warn` now and flips to `error` in the relocating change.
4. **Repair the eslint boundary block** in the same change, restoring `no-restricted-imports` for `src/model`, `src/contracts`, and `src/client`.

Delivery is staged C0–C4 in the plan; each stage is one gate-green change. The published surface is untouched: cordis plugin name, `Config` schema, route paths, `state.json` format, and the `.` / `./client` package exports stay as they are.

## Revisit when

- A third status surface appears (both status builders share a shape but no invariant; a shared abstraction waits for that second implementation).
- The harness ships a documented plugin-module layout convention that differs from this grouping.

## Considered options

- **Vertical feature slices (`src/mcp/` owning its own layers) — rejected.** Re-records ADR 0001's finding: discovery, install-state enrichment, cache invalidation, and enabled-suite calculation are shared across surfaces; slicing would recreate the catalog read model implicitly and spread its ownership.
- **Moving `mcp.json` validation out of `catalog/` into the MCP domain — rejected.** It is layout-dialect validation; the glossary keeps dialect and surface as separate axes.
- **Leaving the arrow inversion documented but un-gated — rejected.** The shared-primitives note already tried deferring it once; an un-gated boundary is a comment, not a constraint.

## Supersession

Partially extends [ADR 0001](0001-catalog-centered-modular-refactor.md) (layer skeleton unchanged, intra-layer organization added) and records the module relocation the [shared primitives note](../../../.agents/notes/implemented/architecture/2026-09-12-shared-primitives-and-declared-seams.md) deferred. Neither is superseded: ADR 0001 stays authoritative for the layered architecture, the note for the collaborator split inside `application/`.
