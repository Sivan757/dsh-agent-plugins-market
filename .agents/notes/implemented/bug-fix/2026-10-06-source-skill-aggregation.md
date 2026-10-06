# Agent Note: Aggregate undeclared skill-only sources

Status: implemented

## Problem

Repositories such as [jeecgboot/skills](https://github.com/jeecgboot/skills) contain independent skill directories without plugin declarations. One card per skill mistakes a resource boundary for an installation boundary.

## Decision

[Rooted discovery](../../../../src/catalog/scan-resolvers.ts) groups validated, undeclared skill-only roots into one source-level suite. Marketplace entries, declared plugin roots, and roots with other runtime surfaces retain their identities. Existing checkout-root suites remain unchanged.

The aggregate uses the source-qualified reserved ID `@skills`. Sanitized child IDs cannot collide with it, so a single-skill install cannot silently enable its siblings. The display name comes from the checkout basename.

Each skill retains its original file and resource directory. Duplicate names keep the first discovered resource. Invalid skills remain excluded with diagnostics.

## Alternatives considered

**Group only the UI cards.** This leaves installation and detail lookup split across individual suites. The catalog must own the installable unit.

**Reuse the checkout basename as the ID.** A same-named child can already carry an enabled installation. Reusing that ID grants access to unselected siblings.

**Rescan every component at the checkout root.** This changes relative command paths and includes unrelated root components. Reuse validated skills and leave non-skill roots separate.

**Add a parser or change the host.** Existing suite discovery provides validated skills and resource paths. This change needs no additional dependency or host capability.

## Consequences

Users install the aggregate separately. Existing individual installation records remain unchanged and do not authorize the aggregate. Collections with non-skill surfaces retain separate cards because their relative paths depend on their original roots.

## Testing

[Aggregation tests](../../../../tests/skill-source-aggregation.test.ts) cover user/project discovery, legacy ID collisions, duplicates, diagnostics, installation, reload, and runtime resource paths. Eight focused test files pass with 164 tests. The repository refactor gate also passes.

A real checkout of `jeecgboot/skills` at `12760b936b0a083ce70905021ea82149f36537d4` produces one suite, 14 skills, and no diagnostics on macOS. Two upstream files use lowercase `skill.md`, so case-sensitive filesystems can produce a different count. This change preserves the existing filename handling.

## Related

[One skill per declared directory](2026-09-22-declared-skill-directory-is-one-skill.md) still owns resource-directory parsing. Source-level grouping does not supersede that decision.
