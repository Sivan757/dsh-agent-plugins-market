# Agent Note: The new-service dialog is one short form

Status: implemented

## Problem

The new-MCP-service dialog carried three ways in: two shortcut buttons (templates, paste JSON), a paste box with its own count, overwrite switch and per-entry report, and only then the form. The shortcuts existed because a form cannot cover every key a server definition may carry, but they put that complexity in front of every user on the most common path — creating one service whose shape the form already fits.

## Decision

- **The dialog is the form.** `McpAddModal` renders the name, the transport and the single field that transport requires, plus the advanced disclosure the editor already had. The template list and the paste box are gone.
- **JSON is the escape hatch.** A definition the form cannot express is written in the editor's JSON view — the same document, so nothing the form has no field for is lost; it is simply typed instead of parsed.
- **The import pipeline is gone with the UI.** `POST /mcp-servers/import`, `Catalog.importMcpServers`, `McpService.importServers`, `importUserMcpServers` with its per-entry outcome wire, `MCP_TEMPLATES`, `parsePastedServers`/`parsePastedServer`/`normalizePastedServer`, their locales and their styles are removed. Adding a service goes through `mcp-servers/add` alone, which already validates the complete document before writing.

## Alternatives considered

- **Keep paste as a single-service fill.** Rejected: it kept the dual action ("fill the form" vs "import") and the count/overwrite affordances the dialog is shedding, and a multi-server paste is exactly the bulk operation this change removes. Users with a whole `mcpServers` map can paste it into the JSON view and delete what they do not want.
- **Move the shortcuts into the advanced disclosure.** Rejected: it keeps the second interaction model alive behind a fold for no recurring need; the buttons have shipped for weeks and telemetry-free review says the form path is the one used.
- **Keep the import route without UI.** Rejected: an unauthenticated API surface no client calls is attack surface, not convenience.

## Consequences

- A user importing another client's configuration now copies entries one at a time, or edits the JSON view directly. The per-entry skip report (invalid name, already exists) no longer exists anywhere.
- The wire contract loses one route (`importMcpServers`); `MarketMutations` loses one member. No deprecation shim: the only consumer was this panel.
- `addUserMcpServer` remains the single write path, so the file-per-write validation story is unchanged.

## Testing

`tests/mcp-status-render.test.ts` asserts the dialog opens with no starter buttons; `tests/routes.test.ts` drops the import forwarding; `tests/mcp-direct-config.test.ts` and `tests/client-detail-editors.test.ts` drop the paste-parser cases; `tests/client-detail-editors.test.ts` keeps `rowsFromPastedText` block-paste into env/headers rows.

## Related

- [The document carries every setting](./2026-09-22-document-carries-every-setting.md) — why the JSON view makes the shortcuts redundant.
- [MCP configuration answers back](./2026-09-22-self-service-mcp-configuration.md) — the per-entry import report this change retires; the field-naming and guidance decisions there stand.
