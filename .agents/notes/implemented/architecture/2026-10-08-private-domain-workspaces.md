# Agent Note: Private domain workspaces retain one public artifact

Status: implemented

## Decision

Eight private workspaces own catalog, runtime, MCP, LSP, translation, browser UI, product composition and stateless contracts. The public installation package remains dsh-agent-plugins-market.

Domain consumers import explicit package entries. Contracts expose portable subpaths and a separate host augmentation. Dependency rules reject reverse composition imports, concrete connectors in runtime, browser-to-server imports and cycles.

The root TypeScript program emits every server package beneath lib. The public root entry re-exports the bundle. The browser entry remains one compiled client artifact. Private workspace dependencies do not appear in the published root manifest.

## Alternatives considered

Internal directories alone would not provide explicit workspace ownership or manifest dependency checks. The user selected real private workspaces.

Independent npm publication would require new package names, release coordination and installation policy. The user selected one public artifact, so release-please remains unchanged.

A new server bundler would add module-resolution and dynamic-import changes. Root TypeScript emission preserves relative imports and existing external dependencies instead.

A universal mutable shared service would obscure ownership. The contracts workspace contains stateless records, helpers and type-only ports, not stores or runtime registrations.

## Consequences

Catalog discovery does not instantiate translation or connector services. Runtime receives concrete connector factories from composition. Translation presentation rules live in its own service. MCP and LSP configuration use cases have separate owners.

Tests remain in the root integration suite for this migration. Package-entry smoke tests complement internal unit tests. All 1,860 frozen test identities remain exercised.

[The migration contract](../../../../docs/developer/design/domain-workspace-refactor.md) records ownership and exclusions. [The behavior freeze](../../../../docs/reference/behavior-freeze-2026-10-07.md) remains the comparison baseline.

## Related

This decision changes source ownership, not the behavior decisions in active lifecycle, settings and translation notes. Their implementation references move with the source. No frozen archival record is changed.
