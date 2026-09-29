# Agent Note: Re-authorize belongs to servers that authorize in a browser

Status: implemented

## Problem

The detail dialog offered **re-authorize** for two remote servers that carry their own `Authorization` header: one declared `Bearer ${CONTEXT7_API_KEY}`, the other a literal token. The action drops the stored OAuth grant and lets the server's next 401 open the browser authorization — but a header-authenticated server does not reach that path, so the button described a recovery the server was never in a position to need.

`canReauthorize` was computed from the transport and the declared `auth` block: remote plus auth-enabled. A static header is not an `auth` declaration, so both servers qualified.

## Decision

**A server that supplies its own Authorization header is not offered the OAuth action.** `declaresAuthHeader(config)` in `application/mcp/mcp-status.ts` answers whether the effective configuration carries that header, whatever its casing, and `McpService.status()` requires its absence for `canReauthorize`. The rule lives beside the status vocabulary rather than in the dialog, so every reader of the flag agrees on what it means.

## Alternatives considered

**Ask the credential store whether a grant exists.** The most precise signal — a grant is exactly what the action drops. Rejected: it costs a round trip per entry through a service the panel may not have, and the flag would arrive later than the row it decorates.

**Drop the action for every remote server.** Simpler rule, and it removes the one case the action exists for: a suite that declares OAuth and challenges with 401.

**Leave the action and explain its empty outcome in the dialog.** The dialog already confirms what the action does; a confirmation that explains why nothing will happen is a worse answer than not offering it.

## Consequences

- Header-authenticated services keep their retry action and lose the re-authorize one; a service that authorizes in a browser keeps both.
- A server that declares `auth` _and_ ships an Authorization header loses the action: its header is what it answers with, and the one recovery action left is the one that applies.
- The flag is `McpStatusEntry.canReauthorize`; the detail dialog's own action list is unchanged.

## Testing

- `tests/mcp-status.test.ts` — `declaresAuthHeader` reads `Authorization` in any casing, ignores other header names, and answers false for a missing headers map.
- `tests/client-mcp-detail-actions.test.ts` — the dialog's action list still keys off the flag it is given.
