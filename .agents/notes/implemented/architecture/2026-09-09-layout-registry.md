# Agent Note: Layout registry and project scope

Status: implemented

## Problem

Adding ZCode, Qoder CLI and Copilot requires coherent manifest, marketplace and project support. Existing project skill discovery does not establish project command or service execution. Scattered layout definitions make omissions likely.

## Decision

The [unified precedence decision](2026-09-09-unified-layout-precedence.md) derives marketplace order from the same registry as suite manifests; shared root catalogs remain the final fallback.

The [schema component decision](2026-09-09-schema-components.md) extends the registry with Kimi Code's primary manifest, declared resource resolution and commit-pinned isolated repository tests. Source identity and project scope remain owned by this decision.

Keep the source strategy chain, centralize pure layout declarations, and derive manifest kinds from that registry. Native project discovery has one persisted `scanProjectLayouts` switch, default on, with immediate snapshot invalidation. Runtime consumers preserve explicit surface masks and resolve project resources through the calling agent's session.

The registry, three new dialects, project role lookup and agent-scoped command/MCP/hook lifecycle are implemented. Native JSON and Codex TOML MCP configurations have explicit project execution roots. The user-approved `smol-toml` dependency parses TOML; tool filters and timeouts reach the bridge instead of being discarded. Invalid manifests fail closed and marketplace paths require realpath containment. [The ADR](../../../../docs/adr/2026-09-09-layout-registry.md) records the supported formats, evidence and boundaries.

## Alternatives considered

**Extend independent switches.** This repeats the current maintenance problem and lets type declarations drift from scan paths.

**Replace the scan pipeline.** Its marketplace/rooted/flat strategy interface is adequate; the missing abstraction is layout data and project runtime ownership.

**Mount all projects globally.** This mixes sessions and cannot provide correct project isolation.

## Verification

The [subagent catalog decision](2026-09-09-subagent-catalog.md) replaces generated role aliases with exact role IDs, retaining both plain and compound-suffix Markdown definitions. Ordinary `agent-*` skills remain skills. The scan switch has been verified through the real settings UI across page reload and an isolated host-process restart, with its false value persisted in that host's `settings.yaml`.

All three dialects resolve manifests and marketplaces, supported project layouts work through runtime consumers, the switch persists and invalidates cached/in-flight discovery correctly, and unsupported semantics are diagnosed. Tests cover execution, simultaneous projects and switching, not only file counts. Bilingual docs and compatibility matrices agree with current scanner behavior.

## Consequences

Supported project hooks share the agent lifecycle. Their normalized snapshots are private runtime artifacts, not copied installations, and are removed on reload/disposal. ZCode native MCP and hook formats are verified against the installed 3.11.2 runtime and first-party guides. Nonportable agent/hook semantics remain documented limitations.

The user declined changes to `deepseek-harness`: project LSP is diagnosed and stays inactive because its host registry is global. That separate feature is not a prerequisite for layout scanning. Existing cache and runtime-scheduling notes remain applicable; the cache fingerprint additionally includes the scan switch. The older `compat-layouts-plan.md` includes user/global work beyond this change and is not evidence of its delivery.
