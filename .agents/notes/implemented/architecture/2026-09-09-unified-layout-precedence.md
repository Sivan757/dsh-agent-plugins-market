# Agent Note: Unified layout precedence

Status: implemented

## Problem

Suite manifests follow the layout registry, while marketplace paths separately promote Claude Code and Codex. A source carrying several dialects can therefore select different layout priorities depending on discovery mode.

## Decision

Derive marketplace paths directly from `PLUGIN_LAYOUTS` in declaration order. Keep each layout's catalog aliases adjacent and ordered. Layouts without dedicated catalogs add no paths; shared root `marketplace.json` remains last because it does not identify a dialect. Suite manifest order stays unchanged, and selection now walks that order when a manifest is rejected — see the [manifest fallback decision](2026-09-12-manifest-priority-fallback.md).

The first productive marketplace still wins; empty or invalid catalogs permit fallback. This extends the [layout registry decision](2026-09-09-layout-registry.md), which continues to own source identity and project scope. Only its marketplace ordering is refined.

## Alternatives considered

**Keep two orders and explain them.** Separate priorities retain the ambiguity the user asked to remove.

**Move suite manifests to the old marketplace order.** This changes existing suite identities unnecessarily. Deriving catalog order from the existing registry removes the duplicate policy.

## Consequences

Universal catalogs now precede Claude Code catalogs; Cursor and Kimi catalogs precede Codex catalogs. Sources carrying competing productive catalogs can expose a different suite list on refresh. No host changes or data migration are required. Integration tests exercise each priority transition, Codex aliases, the shared root fallback, and invalid/empty catalogs.
