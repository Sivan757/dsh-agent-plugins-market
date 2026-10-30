# Agent Note: a dropped MCP connection says what happened

Status: implemented

## Problem

A server that connected and then died kept its tools registered while the supervisor retried, so the status row still read "connected" with no reason and the panel could not distinguish it from a healthy service. The only account of the outage was a log line: connection lost, retrying in 16s, attempt 5 of 10. Backoff grows to 30s per attempt and the outage allows ten of them, so a user could stare at an apparently healthy row for minutes while every call failed, with nothing saying why or when it would end.

The mount diagnostics did not cover this case. They describe a server that never came up; an established connection that dropped produces no diagnostic, and the retry path only wrote to the logger.

## Decision

- **The supervisor publishes its phase.** `startConnection` takes an observer and reports every edge — connecting, connected, reconnecting, and failed — with the attempt, the attempt budget, the next retry time, the phase's start time, a reason, and the last redacted error. The transport's `onerror` is captured too, so a crashed process names its error instead of a bare close.
- **One registry, one port.** `runtime/mcp/mcp-connection-registry.ts` holds the latest observation per derived serverName; the composition root reads it through `CatalogPorts.mcpConnections`, and bridge disposal forgets the entry. Keying by serverName matches how the status builder already joins tools to suites.
- **The observation outranks the tool snapshot, the diagnostic outranks the observation.** A row whose connection dropped reports `degraded` while the supervisor retries and `failed` once it stops, with codes `reconnecting` and `reconnect-stopped`; its last error becomes the row's reason. A row that never mounted keeps the diagnostic's words and gets no connection field.
- **The panel tells the story and follows it.** The card's body line and the detail band render "connection lost; reconnecting (attempt 2 of 10)" plus the last error. The detail offers retry whenever a live connection dropped, not only when the row already reads failed, because retrying is what shortens the wait. While any row is reconnecting, the panel re-reads every 1.5s so the attempt count stays true, and stops as soon as every row settles.
- **The retry policy itself stays.** Delays were left at 500ms to 30s over ten attempts. The 30s cap doubles as the stability window that closes an outage, so lowering it would let a crash-looping server reset its budget sooner; the missing piece was visibility and a manual path, not a shorter ladder.

## Alternatives considered

- **Polling the host tool registry to infer an outage.** Rejected: tools stay registered during the retry, which is exactly the state that read as healthy.
- **Lowering `maxDelayMs` to make reconnects feel faster.** Rejected for now: it also shortens the stability window that distinguishes a recovered connection from a crash loop. The row now names the wait and offers the retry that ends it.
- **Rendering the reason from the existing log line.** Rejected: the logger is not a surface, and the panel had no channel to read it back.
- **Marking the row failed as soon as it drops.** Rejected: the supervisor is still retrying, and failed would offer no distinction between "waiting" and "gave up".

## Consequences

- The connection registry is process-wide; two registration scopes supervising the same serverName share the last observation, which is the same identity the status rows use.
- A reconnecting panel costs one status read every 1.5s until the outage ends; a stopped or healthy row costs none.
- Every status row may now carry a `connection` record, so a consumer that renders its own MCP surface should prefer `state` plus `code` over the tool count.

## Verification

- `packages/market-mcp/test/mcp-connection-observations.test.ts` drives the real supervisor against a process that exits before the handshake: the phases arrive in order, each retry edge names its next attempt and time, the budget stops at gave-up, and the spawn error rides along.
- `packages/market-bundle/test/integration/mcp-status.test.ts` pins the row merge: a reconnecting observation turns a healthy-looking row degraded with its last error; a stopped one turns it failed; a mount diagnostic keeps its own words.
- `packages/market-bundle/test/integration/client-mcp-detail-actions.test.ts` pins retry availability and the connection sentence in both locales' key form.
- Typecheck clean on the server, client, and both test projects; the MCP suites pass (65 tests across the touched files).
