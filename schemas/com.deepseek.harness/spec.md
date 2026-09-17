# com.deepseek.harness namespace contract

The client extension namespace of this manager under the [Agent Plugins specification](https://agent-plugins.org/specification) §8. The namespace has two seats, which the specification leaves entirely to the owning client:

1. **Manifest data** — `plugin.json` → `extensions["com.deepseek.harness"]`, validated against [`namespace.schema.json`](namespace.schema.json).
2. **Extension directory** — the top-level `com.deepseek.harness/` directory.

Both seats open only when the manifest data declares `"schemaVersion": "1.0.0"`. A suite that ships the directory without the declaration, or with an unsupported version, contributes its portable core only (`skills/`, `mcp.json`) and the directory is ignored with a scan note.

## Extension directory layout

| Path                                    | Surface                                                           |
| --------------------------------------- | ----------------------------------------------------------------- |
| `com.deepseek.harness/commands/*.md`    | Slash commands                                                    |
| `com.deepseek.harness/agents/*.md`      | Agent roles                                                       |
| `com.deepseek.harness/hooks/hooks.json` | Command hooks (Claude Code event-table shape)                     |
| `com.deepseek.harness/lsp.json`         | LSP server declarations (`lspServers` table or a bare server map) |

## What the namespace carries

Everything a portable suite cannot express because the v1 format fixes its component set to Agent Skills and MCP, and closes the manifest:

- **Commands, agent roles, hooks, LSP declarations.** The specification records these component types as outside the format "until their formats converge"; the namespace is where they live for this client.
- **Per-server client policy** (`extensions["com.deepseek.harness"].mcpServers`): OAuth authorization, tool allow/deny lists, and timeout policies for servers declared in the portable `mcp.json`. The portable file stays schema-clean; client-specific fields ride the namespace, keyed by the server's own name.

## Failure behavior

| Situation                                               | Behavior                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| Namespace value is not an object                        | Reported, ignored; plugin keeps loading                     |
| `schemaVersion` missing or unsupported                  | Reported; both namespace seats skipped; portable core loads |
| Directory exists but the manifest declares no namespace | Directory not read; scan note records it                    |
| One command / agent / hook / LSP entry invalid          | That entry skipped with a diagnostic; the rest load         |
| Namespace path resolves outside the plugin root         | That path rejected (§4.1)                                   |

## Placeholder rules

Values inside the namespace seats expand `${PLUGIN_ROOT}`, `${PLUGIN_DATA}`, and `${NAME}` credential references — the namespace is client-owned data, so the credential seam the portable `mcp.json` forbids (§9.2) is available here. Missing credential references fail that surface closed with a diagnostic.

## Provenance

- Sources: [Agent Plugins specification](https://agent-plugins.org/specification) §8 (client extensions), §9.2 (placeholder expansion), and the runtime behavior of `src/catalog/manifests.ts` (manifest seat) and `src/catalog/scan-resolvers.ts` (directory seat).
- Verified: 2026-09-17 against `agentplugins/agent-plugins-spec` `ff8ab5e` (1.0.0 published, 1.1.0 working draft).
- Unresolved: none. The specification assigns no semantics to namespace contents, so every rule above is this client's own contract and can evolve by bumping `schemaVersion`.
