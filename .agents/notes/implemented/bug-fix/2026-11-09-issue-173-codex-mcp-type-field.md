# Agent Note: Codex MCP `type` is accepted and checked against the inferred transport

Status: implemented

## Problem

The Codex MCP importer (`packages/market-catalog/src/scanning/codex-mcp.ts`) keeps a field allow-list per `[mcp_servers.*]` table and rejects any server carrying a key outside it. Real `~/.codex/config.toml` files carry `type = "http"` (issue #173): every such server was dropped with `unsupported fields: type`, so a user importing a working Codex setup saw an empty MCP list. The key is redundant — the importer already infers the transport from `command` vs `url` — but redundancy must not be fatal.

## Decision

`type` is now in the allow-list. When present it must agree with the transport the table's own fields imply: `stdio` is accepted only on a command table, and `http`, `sse`, `streamable-http` and `streamable_http` only on a url table. Any other value, or a value that contradicts the inferred branch, rejects that one server with a per-server diagnostic; a table without `type` behaves exactly as before. The check runs inside the transport branch after the existing mutual-exclusion diagnostics (`HTTP options cannot be combined with a stdio command`, `stdio options cannot be combined with an HTTP endpoint`), so a table mixing both option families still reports that conflict first. The key never changes the produced transport: the fields decide, `type` must only agree.

This tolerance is safe because Codex itself ignores unknown fields in `[mcp_servers.*]` (its own test `deserialize_ignores_unknown_server_fields`; `McpServerTransportConfig` in `codex-rs/config/src/mcp_types.rs` is untagged and never carried a `type` field). A config that runs in Codex must therefore import here. The surrounding registry decision — fail-closed per server, other servers unaffected — is unchanged; see [the layout registry note](../architecture/2026-09-09-layout-registry.md).

## Deferred

The allow-list still trails Codex's schema and will again reject tables that Codex itself accepts. Codex's per-server schema spans two structs in `codex-rs/config/src/mcp_types.rs`. `McpServerConfig`, the Serialize view, shows eight value-typed fields beyond the allow-list: `http_headers_helper`, `environment_id`, `required`, `startup_readiness`, `supports_parallel_tool_calls`, `tool_input_schema_max_bytes`, `omit_tools_from`, `auth`. `RawMcpServerConfig` (`mcp_types.rs:395-397`) is the struct TOML actually deserializes into, and serde accepts seven more per-server keys there: `bearer_token`, `default_tools_approval_mode`, `scopes`, `oauth`, `oauth_resource`, the legacy `name` (serde rename), and `tools`, fifteen keys beyond the allow-list in total. Five of the Raw-side keys (`default_tools_approval_mode`, `scopes`, `oauth`, `oauth_resource`, `tools`) are documented, realistic user-config keys, so a working Codex config carrying `tools = { … }` or `scopes = [ … ]` is dropped today.

Widening is a deliberate follow-up decision, not a drift fix to fold into this change: each field needs its own mapping-or-ignore ruling. A future report of `unsupported fields: …` on a working Codex config is this deferred item surfacing, not a new class of bug.

## Alternatives considered

**Tolerate any `type` value.** Rejected: the key would be unchecked prose, and a real typo (`type = "htpp"`) would pass silently while the transport actually used differs from what the user declared. Checking against the inferred branch keeps the diagnosis at import time.

**Widen the allow-list to the whole Codex schema now.** Rejected as scope creep: the eight fields listed above each need a decision (map into `McpServer`, ignore, or reject), and bundling them into the `type` bug fix would hold issue #173 behind a schema-mapping design. Recorded under Deferred for its own round.

**Keep rejecting `type`.** Rejected: it breaks real, working Codex configs — the exact failure issue #173 reports — for no behavioral gain, since the field carries no information the importer does not already infer.

## Consequences

Cost: two more validation rules to keep in mind when editing the importer, and an allow-list that still needs manual synchronization with upstream Codex (see Deferred). Bought: untouched Codex configs import cleanly, and a declared type that contradicts the table is diagnosed at import instead of silently re-interpreted.

## Testing

`packages/market-catalog/test/codex-mcp.test.ts` pins the accepted spellings (`http`, `sse`, `streamable-http`, `streamable_http` on url tables; `stdio` on command tables), both mismatch directions, the unknown-value error, a non-string `type`, the unchanged no-`type` behavior, the surviving `unsupported fields` message, the mutual-exclusion precedence, and per-server isolation.
