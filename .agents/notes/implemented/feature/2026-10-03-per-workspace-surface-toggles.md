# Per-workspace surface toggles

Date: 2026-10-03 · Status: implemented · Surfaces: market, skills, commands, agents, mcp, lsp

## Decision

The six plugin surfaces carry per-workspace on/off switches stored globally — under the plugin data root keyed by a hash of the workspace's absolute path — never inside the project tree. The composer control (host slot `conversation.input.left`) writes a toggle and the change runs through the ordinary reconcile chain, so a switch unmounts or remounts real surfaces rather than hiding UI.

## Why this shape

- **Global storage, hashed workspace key**: the toggle is this user's opinion about that project; two checkouts of one repo keep independent opinions, and no path can leak into a file name.
- **Gate at the mount data flow, not the UI**: each surface answers its own switch where its data is produced, and every seat survives a toggle without re-registration. Skills serve an empty list behind `ToggledSkillProvider` — which wraps both contributors, the suite provider and the user's own panel entries — and the role list collapses to empty. The MCP, commands and LSP suite mounts read the switch inside the reconciler's own branch: the enabled-suite list is never filtered, because all three mount from that one snapshot and dropping a suite for one switch would tear down its mounts on the other two. The same gate reaches the project-dimension contributors, so an off commands or MCP switch also reconciles the project mounts to none, and an off commands switch releases the user-panel command registrations rather than skipping the pass. LSP additionally serves an empty direct-server table, so its direct rows and its suite mounts both go to zero. The market routes never mount at all.
- **The switches are orthogonal**: MCP and LSP share a suite snapshot but not a switch. Turning MCP off reconciles the MCP mounts to zero servers while the same suites keep their language servers, and the reverse for LSP; a toggle reaches the mount branch through the ordinary reconcile chain.
- **Host slot over a custom panel**: `conversation.input.left` is an additive, unoccupied seat (replaceRisk none) that renders exactly where the user asked — beside the composer.

## Alternatives considered

- **Host settings namespace for storage**: rejected for this need — the namespace is plugin-config-shaped (typed volatile refs served by the host settings page), while toggles are per-workspace rows that must not surface as six global config fields.
- **Re-registering providers on toggle**: rejected — the seats are stable; only the data they serve changes, so re-registration would churn the host registry for nothing.
