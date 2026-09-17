# 2026-09-17 — Agent Plugins v1 conformance and the com.deepseek.harness namespace

## Decision

`agent-plugin-v1` suites read exactly three inputs: the specification's fixed locations (`skills/`, `mcp.json`), and this client's §8 extension namespace `com.deepseek.harness` (manifest data under `extensions`, files under the top-level directory of the same name). The shared root-directory conventions (`commands/`, `agents/`, `hooks/`, `hooks.json`, `lsp.json`, `.lsp.json`, `.mcp.json`) no longer apply to this dialect; their presence produces a scan note. Inline manifest component keys are reported and ignored per §5.2. Both published releases (1.0.0, 1.1.0) are recognized and validated against their own vendored schemas.

The namespace carries what the portable format cannot: commands, agent roles, hooks, LSP declarations, and per-server client policy (`auth`, `enabledTools`, `disabledTools`, `startupTimeoutMs`, `toolCallTimeoutMs`) keyed by the server's own `mcp.json` name. OAuth moved there from the hand-edited vendored `mcp.schema.json`, which is restored to the upstream bytes; §10.1 forbids reassigning a published schema id to different contents. Portable `mcp.json` values follow §9.2 literally: only `${PLUGIN_ROOT}`/`${PLUGIN_DATA}` expand, everything else stays literal, and the credential resolver is never consulted for portable packages. User-owned MCP data (`~/.agents/mcp.json`, project-native config, per-server overrides) keeps the `${NAME}` seam and its own leniency; overrides are user data, not package data.

## Alternatives considered

- **Keep shared-directory fallbacks for v1.** Rejected: the suite then reads files the specification does not define, silently changing what an upstream-conformant package means. A note plus namespace declaration keeps the boundary visible and opt-in.
- **Extend the vendored `mcp.schema.json` with `auth` (previous state).** Rejected: the vendored file must match the canonical id byte for byte; client-specific fields belong in the namespace, which is exactly what §8 exists for.
- **Credential expansion for portable `mcp.json`.** Rejected: §9.2 mandates literal preservation; the client-managed credential path is the per-server override (settings card) and namespace policy.
- **Namespace readable from the directory alone (no manifest declaration).** Rejected for now: requiring `extensions["com.deepseek.harness"].schemaVersion` keeps both seats coupled and makes the namespace strictly opt-in. §8 permits the seats to be independent; if a real suite ships only the directory, split the gate and record it here.
- **Per-server policy keyed by derived serverName (`suiteId__serverKey`).** Rejected: the namespace is written by the suite author, who knows the `mcp.json` names but not this client's derivation; mount-time collisions are already handled by `duplicate-mount`.

## Consequences

- A v1 suite without the namespace contributes skills and MCP only — by design. Our own suite fixtures declare the namespace.
- Vendored-schema updates are again a pure copy from upstream; `schemas/com.deepseek.harness/` evolves under its own `schemaVersion`.
- `PLUGIN_DATA` is created before any stdio spawn and both variables are injected after the configured env overlay (§9.1), so data-directory `cwd`/`args` references work on first launch.

## Related

- [MCP user policy rides the override record](../feature/2026-09-21-mcp-user-policy-in-overrides.md) — the namespace declaration is the suite's default: the service editor's Advanced settings may override either timeout, user tool denials only tighten the declared filtering, and the suite's allow-list cannot be widened.
