# Agent Note: Stage C2 relocated the mis-homed modules and gated the layer arrow

Status: implemented

## Problem

The module-cohesion plan's [measured baseline](../../../../docs/developer/design/module-cohesion-plan.md): `src/application/` imported `src/runtime/` forty times across eleven files — the opposite of the arrow the engineering refactor plan draws — and nothing gated the direction. The inverted edges existed because a dozen pure modules (stores, projections, validators, region routing, the portable-format mapper) had accumulated in `runtime/` while `application/` grew the services that consume them.

## Decision

Move every pure module to `application/` and make the arrow a gate:

- **Stores and persistence**: `state-store`, `storage-migration`, `legacy-root-migration`, `mcp-overrides`, `mcp-direct-config`, `lsp-direct-config`, `lsp-server-state`, `server-config`, `user-store`, `user-hooks`, `profile-seam`.
- **Projections and validation**: `mcp-redaction`, `mcp-status`, `lsp-status`.
- **Portable-format mapper**: `mcp-config` moved whole. Its "pure half" (effective servers, policy resolution, credential refs) and its "mount half" (`toMcpMounts`) share types and spec paragraphs; splitting the file would cut the JSDoc contracts in half for a layering technicality. `runtime/mcp-mounts` imports it — the arrow's legal direction.
- **Bridge config vocabulary**: `mcp-client/config.ts` became `application/mcp-bridge-config.ts`. It is type/constant data extending `model` types, including `ReconnectConfig`, whose ownership moved with it.
- **Selectors and seams**: `mcp-backend` (schema declaration + host probe; node:module/fs are application-legal), `regions`, `deadline`, and the agent-role frontmatter parser (extracted from the 527-line cordis router into `application/agent-roles.ts`; the executing half stays in runtime).
- **Structural seam types live in `ports.ts`**: `McpToolSnapshot`, `LspMountStatusSource`, the user-panel store surface in `panel-resources`. Wire-owned types (`McpBackend`, `McpMountDiagnostic`, `LspMountDiagnostic`) moved to `contracts/mcp.ts` and `contracts/lsp.ts`.
- **Locale read became a port**: `localePreference(): string` on `CatalogPorts`, wired from `index.ts` as `readLocalePreference() ?? 'zh'`. The composition root owns host seams; services stay host-agnostic.
- `dependency-cruiser`'s `application-cannot-import-runtime` flipped from warn to error; the run reports zero violations.

## Alternatives considered

- **Splitting `mcp-config.ts` into pure and mount halves across the layers.** Rejected: one file, one spec; the split serves only the gate.
- **Keeping the locale read a direct `runtime/host-locale` import.** Rejected: the settings-backed preference is exactly the kind of host seam `CatalogPorts` exists to declare, and two services read it.
- **Re-export shims at the old paths.** Rejected: this is a pre-1.0 package with no external importers of internal paths; tests import the new locations directly.

## Consequences

- `src/application/` no longer imports any runtime module; `src/runtime/` imports application (legal direction) for the mapper, backend selection, store types and role parsing.
- `legacy-root-migration.ts` moved rather than deleted: `storage-migration.ts` absorbed the pre-0.5.4 `agent-plugins-data` fold-in long ago, but the module still has no `src/` importer — deletion is a separate decision requiring a release-note line, not a side effect of a refactor.
- `inspectToolRegistry` is no longer re-exported through `mcp-status`; its consumers (`index.ts`, the status test) import `runtime/tool-registry-observer` directly.

## Verification

- `pnpm run check:quick` (four tsc projects + eslint), `pnpm run test` (98 files, 842 tests), `pnpm run check:architecture` (zero violations, rule at error) — all green.
- Each moved module kept its public API; only import specifiers changed.
