# Agent Note: Project Agent layouts are opt-in

Status: implemented

## Problem

Native project layouts (`.claude`, `.agents`, `.codex`, `.cursor`, `.kimi`, `.zcode`, `.qoder`, `.github`) were scanned by default. A session whose working directory held one of those directories silently gained that project's skills, commands, agent roles, MCP servers and hooks: a checkout could change what the session offers without anyone choosing it, and a user who never opened the plugin card never learned that the working directory had contributed anything. Declining was possible too, but only after discovering the switch.

## Decision

`scanProjectLayouts` in the `dsh-agent-plugins-market` settings namespace defaults to `false`: a project contributes its own layouts only once the user turns the switch on. An explicit `true` persists in the settings document and is honored as before.

Every other behavior is unchanged. The switch still takes effect on the next discovery pass, so candidates appear or disappear immediately; it still invalidates discovery and project snapshots, and still participates in the discovery fingerprint so an older scan cannot supply a differently configured snapshot. Configured sources, installed suites and `<project>/.dsh/agent-plugins` project state are unaffected in both directions.

The [layout registry decision](2026-09-09-layout-registry.md) owns the registry, the per-client dialects and the project runtime. This note owns the default only.

## Alternatives considered

**Keep `true` and document the switch.** Rejected: documentation does not make an injection visible at the moment it happens. The contributing directory is often one the user did not put there deliberately, and the resources it adds are indistinguishable in the panels from installed suites unless the user already knows to look.

**Grandfather existing installs at `true` and start new installs at `false`.** Rejected: the same action would then behave differently depending on installation history, and a persisted value in `settings.yaml` could no longer be explained from that document alone.

## Consequences

A project that was contributing resources stops contributing until the switch is on, so an existing user who relied on the implicit behavior must opt in once. In exchange, reaching a session's surfaces now always follows a choice the user made, and the settings document states the whole answer.

The switch is a persisted setting rather than a per-project grant: turning it on admits every project the user runs a session in, and there is no per-repository opt-in. A project-local opt-in remains available as its own change if that granularity is ever wanted.

## Verification

The settings-schema test pins a missing `scanProjectLayouts` section to `false`; a project-discovery test pins that the same project yields no suite before the switch is on and one suite after. The [ADR](../../../../docs/developer/decisions/2026-09-09-layout-registry.md) records the switch and its persistence evidence; its earlier settings-UI run was performed while the default was `true`.
