# Agent Note: MCP configuration answers back

Status: implemented

## Problem

Configuring an MCP service was one-way: a save either succeeded or produced a single sentence, a paste of several servers either worked or failed as a block, and a failed mount printed whatever the transport said. Six open-source MCP managers were surveyed; all six converge on the same answers — a rejection that names its field, a per-entry import report, advice attached to a failure, and key/value paste into multi-line fields.

## Decision

- **The status wire carries each tool's input schema.** `inspectToolRegistry` reads `parameters` off the host's `schemas()` listing, `buildMcpStatus` keeps it only while it stays under 20,000 characters, and the panel opens a parameter table from the tool's name.
- **A rejected save names its fields.** `McpConfigError` carries `{ field, message }` entries derived from the schema's `instancePath`; the route returns them beside the message; the editor places each one under its input. Reasons the schema cannot attribute — URL scheme rules, placeholder rules — stay at form level instead of being guessed onto a field.
- **A paste is judged per entry.** `importUserMcpServers` checks each entry on its own (name shape, conflict, schema), writes the file once after every check, and returns what it imported and what it skipped with a reason each.
- **A failure carries its next step.** `mcpGuidanceKey` classifies the wording the layers actually produce — credentials, authorization, transport, backend, DNS, TLS, refused, timeout, missing command, early exit, handshake — into one line of advice; an unrecognized reason produces no advice instead of a generic one.
- **Multi-line fields accept a pasted block.** `rowsFromPastedText` reads `KEY=VALUE` and `Key: Value`, strips one pair of quotes, and appends one row per line.

## Alternatives considered

- **Validate fields in the browser only.** Rejected: the schema is the authority, and a rule re-implemented in the panel drifts away from it. The panel places the server's answers; it does not invent them.
- **One message listing every skipped entry.** Rejected: the user needs to know which entry each reason belongs to.
- **A default piece of advice for anything unclassified.** Rejected: a line that fits every failure tells the user nothing.

## Consequences

- The status payload grows by each tool's schema, bounded at 20,000 characters per tool; the panel renders the top level, and the model's own tool list stays the full definition.

## Testing

`tests/client-mcp-detail.test.ts` covers the parameter disclosure and the guidance classifier; `tests/mcp-status.test.ts` pins schema transport and the size bound; `tests/server-config.test.ts` asserts that a rejected save names its field; `tests/mcp-direct-config.test.ts` covers the per-entry import outcomes and overwrite; `tests/client-detail-editors.test.ts` covers the pasted block.

## Related

- [MCP user policy rides the override record](./2026-09-21-mcp-user-policy-in-overrides.md) — what the advanced disclosure holds.
- [The document carries every setting](./2026-09-22-document-carries-every-setting.md) — why the editor is a document rather than a form.
- [The service detail reads as a record](./2026-09-21-service-detail-skeleton.md) — the skeleton these answers fill in.
