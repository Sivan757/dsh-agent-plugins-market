# Agent Note: a failure says how long it took

Status: implemented

## Problem

"挂载太慢" was the one complaint in the owner's list that the product could not answer. A row that failed after ten seconds and one that failed after forty milliseconds read the same: one reason line, no number anywhere. The difference decides what to look at (a handshake that hangs, a proxy that never answers, a configuration error), and nothing in the status payload carried it.

## Decision

- **The registry times the attempt.** `mountThenReport` is the only place that knows when a mount began, so it measures around `mountWith` and puts `mountMs` on the diagnostic it reports. The contract grows one optional field on `McpMountDiagnostic` and one on `McpStatusEntry`; nothing is invented when a path did not time itself.
- **The row says it where the cause is.** The card appends the seconds when the attempt took a second or more (`连接超时 · 10.0s`), because the list is scanned to find the row that needs attention. The detail carries `挂载用时  10013 毫秒`, and the copyable diagnostics block carries `mountMs: 10013`, so a pasted report answers the question without a second round trip.
- **Only failures are timed for now.** A successful mount needs its timing to travel from the registry to the status builder through a new port; the failures are where the question is asked, and that path already existed end to end. The note records the follow-up rather than pretending the success case is covered.

## Alternatives considered

- **Log the duration instead of surfacing it.** Rejected: the person asking is looking at the panel, and a log line they cannot see answers nothing.
- **Show it for every row.** Rejected for now: a healthy row's number is noise, and the status payload is read on every tab switch; the field is optional so a future success path can populate it without another contract change.
- **Measure in the client around the retry request.** Rejected: that time includes the queue, the status re-read and the render, so it would report a number that is not the mount.

## Consequences

- A slow failure is distinguishable from a fast one before opening anything.
- The advice sentence and the duration now sit side by side, so "ten seconds then timeout" reads as a network problem rather than a configuration error.
- A successful mount still reports no duration; that is the next slice.

## Verification

- Live in `market-dev`, after restarting the host so the new server code ran: the failed `kuboard` connector shows `挂载用时  10013 毫秒` and its copied block ends with `mountMs: 10013` before the cause chain. The 10.0s matches the connect timeout the proxy path burns.
- `packages/market-bundle/test/integration/mcp-status.test.ts` pins the diagnostic's duration reaching the row; `mcp-mounts.test.ts` and `mcp-backend.test.ts` pin that a failed attempt records one at all; `packages/market-ui/test/mcp-status-render.test.ts` pins the detail row and the copied block.
