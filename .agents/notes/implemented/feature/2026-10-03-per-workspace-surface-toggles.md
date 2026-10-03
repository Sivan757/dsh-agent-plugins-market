# Per-workspace surface toggles

Date: 2026-10-03 · Status: implemented · Surfaces: market, skills, commands, agents, mcp, lsp

## Decision

The six plugin surfaces carry per-workspace on/off switches stored globally — under the plugin data root keyed by a hash of the workspace's absolute path — never inside the project tree. The composer control (host slot `conversation.input.left`) writes a toggle and the change runs through the ordinary reconcile chain, so a switch unmounts or remounts real surfaces rather than hiding UI.

## Why this shape

- **Global storage, hashed workspace key**: the toggle is this user's opinion about that project; two checkouts of one repo keep independent opinions, and no path can leak into a file name.
- **Gate at the mount data flow, not the UI**: skills answer an empty list behind `ToggledSkillProvider`, the MCP scheduler reconciles over an empty suite list, LSP serves an empty server table, user-command reconciliation returns early, the role list collapses to empty, and the market routes never mount. Each surface's seat survives a toggle without re-registration.
- **Host slot over a custom panel**: `conversation.input.left` is an additive, unoccupied seat (replaceRisk none) that renders exactly where the user asked — beside the composer.

## Alternatives considered

- **Host settings namespace for storage**: rejected for this need — the namespace is plugin-config-shaped (typed volatile refs served by the host settings page), while toggles are per-workspace rows that must not surface as six global config fields.
- **Re-registering providers on toggle**: rejected — the seats are stable; only the data they serve changes, so re-registration would churn the host registry for nothing.
