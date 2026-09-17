# Agent Note: MCP user policy rides the override record

Status: implemented

## Problem

A user could not change how long a suite server's tool call may take. The bridge defaults (60 000 ms per call, 10 000 ms to start) and the suite's `com.deepseek.harness` declaration were the only sources, so a self-hosted server whose tool legitimately runs past a minute failed with `MCP error -32001: Request timed out` and nothing in the market could raise the limit.

Tool selection was equally out of reach. The namespace can declare `enabledTools` / `disabledTools`, and the built-in bridge enforces both, but a user who wants one tool off has to edit a package file that the next refresh overwrites.

## Decision

The per-server override record stays the one place user policy lives, and it grows the three fields the suite cannot own for the user:

- `toolCallTimeoutMs` and `startupTimeoutMs` — a timeout is a plain override. The user's stored value wins, a suite declaration fills in when the user set none, and the built-in default stands behind both.
- `disabledTools` — the tool names the user turned off.

**Tool filtering only tightens.** The effective deny list is the suite's own entries unioned with the user's, and the effective allow-list is the suite's, unchanged. A user cannot open a tool the suite left out, so a suite's narrowing survives every user edit.

**An undeclared startup timeout stays absent.** With neither layer setting one, the bridge config omits `startupTimeoutMs`: the built-in bridge applies its own default at connect time, and host compatibility mode — which cannot enforce one — keeps mounting the server.

**A save carries the policy beside the document.** `POST server-config/save` takes `policy: { toolCallTimeoutMs, startupTimeoutMs }`, where a number sets a value and `null` clears it back to inheritance. An absent field keeps its stored value, and the client sends only the fields whose text moved from the loaded baseline — a value the user did not touch on this backend never rides along to another one that refuses it. The server validates a positive whole number of milliseconds within the 2 147 483 647 timer range and rejects anything else with a readable reason, so the client can show it in place rather than dropping it. After a successful save the editor reads the service back, so the policy view, the placeholders and the dirty baseline all describe what was stored.

**A config save replaces the connection fields and preserves the policy.** The submitted document already carries `url`/`headers`/`env`/`args`, so those override fields are cleared from the record while `enabled`, `auth`, `disabledTools`, the timeouts and the connect document survive. A leftover connection field would otherwise shadow the configuration just saved, because `applyOverride` layers it over the stored `config`.

**The portable document stays portable.** `schemas/1.0.0|1.1.0/mcp.schema.json` closes every server definition with `additionalProperties: false`, so the timeouts ride the override record and never the `mcp.json` body or the editor's JSON text; the editor document is the connection shape with the policy fields removed.

**One disclosure holds the optional inputs.** The MCP form keeps the required and credential-bearing fields in its main body — transport, command, arguments, environment, URL and headers. An **Advanced settings** disclosure carries the working directory for a stdio server, the two timeouts, and a line stating that a remote server negotiates OAuth itself on the server's 401 challenge, so the common path stays short and a rarely used input has one home.

**Host compatibility is named, not hidden.** `@deepseek-ai/dsh-mcp-client` refuses a mount config that carries a startup timeout or tool filters. A save or tool toggle that would set either is rejected up front with a readable reason, the service editor disables the startup field and states why, and the tool checkboxes render disabled under the same statement. The tool-call timeout is available on both backends, because the host client enforces it. A startup value stored while the built-in client was active keeps a clear control beside the disabled field, so it can be removed without switching backends.

### The checkbox model

The panel's tool list is the union of what the server registered, the suite's allow-list, the suite's deny list, and the user's deny list. A denied tool leaves the live registry, so the stored lists are what keep it on screen and available to switch back on.

A row shows one of three states:

- **Allowed** — within the suite's allow-list (or the suite declares none) and in no deny list. Checked, editable.
- **Rejected by the user** — in `disabledTools`. Unchecked, editable.
- **Limited by the suite** — outside a declared allow-list, or in the suite's deny list. Unchecked, fixed, and labelled as the suite's.

`setMcpServerTool(suiteKey, serverKey, tool, enabled)` writes the denial into the override record; clearing the last denial drops the field, so a server with nothing denied carries no tool policy at all. The change reconciles immediately through the same `notifyChanged(true)` + `refreshSettled()` path the enable switch uses.

## Alternatives considered

- **Put the limits in the service configuration document.** Rejected: the portable schema closes its server definitions, so the document would fail validation, and a package refresh could not carry a client-only field anyway.
- **Fold the user's denials into `enabledTools`.** Rejected: it erases the distinction between what the suite declares and what the user chose, and a user list written that way could widen a suite allow-list on the next read.
- **Let the client send the whole effective policy and replace the stored record.** Rejected: the editor never receives literal credential values, so a verbatim write would drop the keys redaction hides. Per-field writes with `null` meaning "clear" keep the rest of the record intact.
- **Keep the namespace-policy-wins order used for connection fields.** Rejected for tool lists and timeouts: a suite declaration is a default the user may change, and this order would make the field unchangeable for the servers that declare one.
- **Reject an out-of-range timeout by dropping the field.** Rejected for the save entry: a silent drop reads as a successful save, and the user has no way to learn the value did not stick. Storage still drops a malformed field, because a hand-edited file must not break the rest of the record.
- **Serve a single effective deny list and infer the suite's part on the client.** Rejected: a tool that both layers deny would read as user-rejected and offer a switch that cannot take effect. The wire carries the suite's allow-list, the suite's deny list, and the user's deny list apart.
- **Hide the tool checkboxes on the host backend.** Rejected: a disabled control that says why keeps the restriction discoverable, and switching back to the built-in client restores it without a reload of the page's meaning.

## Consequences

- A self-hosted or slow server gets the time it needs without leaving the built-in bridge or editing a suite.
- A denial is durable and reversible: the tool stays listed after the registry drops it, and re-checking it removes the stored name.
- The host compatibility backend mounts only servers whose policy it can enforce, and says which control to move when it cannot.
- The override record grows three fields, so `sanitizeOverrides`, `sanitizeOverridePatch` and `mergeOverridePatch` extend together; the record stays the single persisted home for user policy.
- `disabledTools` replaces wholesale like `args`, and an empty list persists as no field.

## Testing

`tests/mcp-overrides.test.ts` covers sanitizing the new fields, the timer-range drop, `parseTimeoutPatch` rejection, merge semantics and `withoutPolicyFields`. `tests/mcp-config.test.ts` pins the precedence: user timeout over suite, deny lists unioned, suite allow-list never widened, and an undeclared startup timeout absent from the mount config. `tests/server-config.test.ts` drives the save through the real filesystem: stored timeouts reported with their source, connection leftovers cleared, `enabled`/`auth`/`disabledTools` preserved, `null` clearing, out-of-range rejection, tool toggles writing and dropping the field, and the host backend refusing a startup timeout and a tool toggle. `tests/routes.test.ts` checks the wire parsing and `tests/mcp-status.test.ts` the reported lists. `tests/client-server-config-policy.test.ts` renders the disclosure, the placeholders, the invalid state and the read-back after a save, and drives the save request body: a changed timeout alone, `null` for an emptied field, a stored startup timeout left out of a tool-call-only save on the host backend, and the clear control removing one there. `tests/client-mcp-detail.test.ts` renders the three checkbox states, the host-backend disablement and the read-only foreign row.

## Related

- [agent-plugins v1 conformance and the harness namespace](../architecture/2026-09-17-agent-plugins-v1-conformance-and-harness-namespace.md) — where the suite's declared policy comes from.
- [live card affordances](./2026-09-16-workspace-live-card-affordances.md) — the server enable switch and its `set-mcp-server-enabled` route.
