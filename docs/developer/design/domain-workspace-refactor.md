# Domain workspace refactor

## Contract

The user selected private domain workspace packages with one public installation package. The [architecture v2 design](../../../design/architecture/index.html#revision-v2) defines the target responsibilities. The [behavior freeze](../../reference/behavior-freeze-2026-10-07.md) defines the behavior that this refactor preserves.

The public package name, import specifiers, bundle identity, routes, settings keys, persisted data and UI behavior remain stable. Internal emitted paths can change with explicit export mappings and packed-artifact tests. No host edit or multi-package publication is part of this work.

## Ownership

| Workspace | Owns | Does not own |
| --- | --- | --- |
| market-contracts | Stateless model records, wire records, identifiers and portable settings semantics | Filesystem access, mutable services, runtime registrations |
| market-catalog | Source acquisition, dialect parsing, validated declarations, snapshots and install state | Translation engine, MCP connections, session selection |
| market-runtime | Presets, session transactions, content integration, Team roles and shared-demand coordination | Concrete MCP/LSP construction, HTTP transport, browser components |
| market-mcp | MCP configuration, bridge, credentials integration, mounts and status | Session selection policy, translation engine |
| market-lsp | LSP configuration, mounts, processes and status | Session selection policy, translation engine |
| market-translation | Translation engine, providers, queues, cache and host translation adapters | Catalog installation, session authorization |
| market-ui | Browser entry, feature views, shared presentation and transport clients | Node implementation imports |
| market-bundle | Product composition, retained application facade, transport assembly and platform wiring | Duplicate domain implementations |

The extra contracts workspace is stateless. It is not a universal shared-state service. Domain packages expose explicit entry surfaces. Internal cross-domain imports are rejected after the migration completes.

## Delivery

Private workspaces organize source ownership, not independent npm delivery. The root compiler emits their code into the public package. Cross-workspace runtime imports remain relative so the installed artifact does not require private npm packages. The browser bundle remains one host-loaded artifact.

The root package remains the only release-please package. Published dependencies and peers remain owned by the public deployment package. Workspace manifests describe their source roles and public entry surfaces.

## Sequence

1. Commit the verified behavior freeze.
2. Move source ownership and update deterministic path consumers, with no second implementation.
3. Remove entry-type cycles and reverse dependencies. Move transport contracts to their domain owner.
4. Inject concrete MCP/LSP adapters into runtime coordination. Keep transaction ordering unchanged.
5. Remove domain logic from product entry hotspots where a domain owner already exists.
6. Enforce package entry and portable-layer rules. Preserve existing architecture prohibitions.
7. Update tests, documentation links, reuse ledger and scripts to the new owners.
8. Compare all baseline test identities, build and inspect the packed artifact, and test an isolated DSH installation.

## Exclusions

Do not change translation stop semantics, polling cadence, recovery interaction, Hook identity format, experimental defaults, or legacy filter behavior. Record discovered behavior defects separately. Do not silently fix them inside structural commits.

## Acceptance

Every source file has one domain owner. No duplicate implementation remains at an old path. The catalog does not instantiate translation or connector services. Runtime coordination receives concrete adapters through an explicit composition boundary. Browser code imports portable contracts only.

All 1,860 baseline test identities remain exercised. Assertions change only for relocated paths or deliberately removed test-only private coupling. Type, lint, formatting, architecture, reuse, host alignment and artifact validation all pass. The public installation works without a source checkout or private workspace symlinks.
