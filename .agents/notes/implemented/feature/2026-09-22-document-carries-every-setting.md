# Agent Note: The document carries every setting

Status: implemented

## Problem

The configuration editor is a form, so anything the form has no control for is unreachable: a timeout the portable `mcp.json` has no seat for, a tool deny list, a key another MCP client introduced. Every such gap became a request against the form, and each added control lengthened the common path for everyone.

## Decision

- **One document, two seats.** The editor's JSON is the document the Agent Plugins specification already defines for a service: the portable definition under `mcpServers`, and this client's policy under the `com.deepseek.harness` namespace (`toolCallTimeoutMs`, `startupTimeoutMs`, `disabledTools`, `auth`). No new shape was invented; the portable half keeps the shape the specification fixes, and the policy half is the seat §8 leaves entirely to this client.
- **The form is a view, not the model.** `ServerConfigEditor` parses the document, the form writes only its own half, and the other half rides along untouched, so a key the form does not know survives both a form edit and a JSON edit.
- **Only what changed is sent.** `policyRequestOfDocuments` submits the entries the user moved; an entry dropped from the document asks for inheritance. A value set on one mount backend therefore never rides along to another, where the same value can be refused.
- **User-owned declarations are local data.** `validateUserMcp` and the user-owned save path run `validateMcpJson` with `packageRules: false`: unknown keys are kept as written, the package-only rules (closed server shape, bare command names, plugin-relative paths) stay off, and each transport's shape and required fields are still checked. A suite's packaged `mcp.json` keeps every package rule.

## Alternatives considered

- **Invent a flat shape** (`toolCallTimeoutMs` beside `command`). Rejected: the specification closes the server object per transport, so the file would declare a schema it does not satisfy.
- **Keep adding form controls.** Rejected: every uncommon setting lengthens the common path, and the request queue never empties.
- **Loosen the schema for every file.** Rejected: a suite's packaged `mcp.json` is a distributable contract, and accepting fields this client cannot mount would report a mount that cannot work.
- **Keep the policy in a separate document.** Rejected: a setting reachable through one view is a setting the other view silently drops.

## Consequences

- The editor's JSON is a service document rather than a bare definition, so a paste from another client needs its definition under `mcpServers`.
- `ServerConfigPayload` carries the declaration key; without it the client cannot key the document.
- A user-owned file may hold fields the bridge ignores at mount time. They are ignored, never dropped.

## Testing

`tests/mcp-direct-config.test.ts` keeps unknown keys in a user file; `tests/server-config.test.ts` stores a user-owned service carrying one and still refuses unknown keys on a package; `tests/client-detail-editors.test.ts` proves a form edit keeps a key it has no control for; `tests/client-server-config-policy.test.ts` submits a policy written into the document, and only the entry that changed.

## Related

- [MCP configuration answers back](./2026-09-22-self-service-mcp-configuration.md) — what the answers say.
- [MCP user policy rides the override record](./2026-09-21-mcp-user-policy-in-overrides.md) — where the policy lands on disk.
