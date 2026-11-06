# Agent Note: the MCP mount startup budget is thirty seconds

Status: implemented

## Problem

The built-in MCP bridge bounded every connection attempt with a ten-second startup timeout: a server that had not completed its handshake and its first `tools/list` by then counted as unreachable, and the mount failed. The tools of such a server never appeared, which the owner reads as "the model cannot find MCP" - the tools are not missing, the mount never finished.

Ten seconds is short for a server reached over the public internet: the TLS handshake, an OAuth discovery round trip and a large tool listing all sit on that clock. The plugin's budget was also tighter than the host's own tolerance for a single call - the host's MCP client has no startup knob at all and lets one tool call run for 60 seconds, so the bridge gave up on a server the host itself would still have waited for. The owner works around it by raising the two servers that need it to 60000 by hand; the default is what every other server gets.

## Decision

- **The default startup budget is 30 seconds.** `DEFAULT_STARTUP_TIMEOUT_MS` is 30_000, and both readers - the resolved mount policy and the bridge's connect-time fallback - pick it up through the constant, so one number carries the decision.
- **The budget covers the whole mount path, per request.** The initialize request and every `tools/list` page are each capped at this value, so a server that answers its handshake in time and then takes its time listing tools still mounts.
- **30 seconds is a deliberate middle.** It is long enough for a public server's TLS handshake, OAuth discovery and tool listing, and short enough that a dead server fails visibly instead of hanging. It stays below the MCP SDK's own 60-second request default - what an undeclared server used to fall through to, holding its process, transport and browser leg for a full minute - and below the host's 60-second per-call tolerance, so mounting a server is never held to a tighter budget than one call against a server that already answered.
- **The user's and the suite's values still win.** The resolution order is unchanged: the user's override, then the suite's declaration, then this default. A server that needs longer than 30 seconds still declares `startupTimeoutMs`, and the host compatibility backend still refuses a server carrying one, because that backend cannot enforce it.
- **The reconnect budget is untouched.** The supervisor's give-up is attempt-counted, not clock-counted: ten failed attempts with delays doubling from 500ms to the 30s ceiling, then the tools are unregistered. A longer attempt does not change that count, so the supervisor still gives up and still unregisters the tools.

## Supersession

This partially supersedes [settings and cards ride the host](../architecture/2026-09-13-settings-and-card-ride-the-host.md): that note's decision still holds - every connection attempt is bounded by a built-in default, a server may declare its own, and the default is resolved at connect time inside the built-in bridge - but its stated value of ten seconds is now thirty. The fact is updated in place in that note; the decision is not rewritten.

## Alternatives considered

- **Match the host's 60-second tool-call timeout exactly.** Rejected: that timeout governs a call against a server that already answered, while the startup budget governs a server that has not proved it answers at all. A minute of silence before the mount reports a failure is a minute a user waits for a server that will never come up, and the reason the bridge has a budget at all - failing visibly instead of hanging until the SDK's default expires - argues for the shorter value.
- **Leave the default at ten seconds and let every slow server declare a timeout.** Rejected: the servers that need longer are mostly the user's own, declared in a manifest the user does not edit, and the symptom is a mount that silently never completes.
- **Drop the built-in default and inherit the MCP SDK's 60 seconds.** Rejected: that is the behavior the September note replaced. An unreachable server would hold its process, transport and browser leg for a full minute before failing, and the bridge would lose the one budget it controls.
- **Raise the reconnect budget to compensate.** Rejected: the give-up is attempt-counted, so it already fires. Raising the attempt count would multiply the outage window instead of bounding it, and the tools are unregistered at the give-up either way.
- **Make the budget proportional to the transport.** Rejected: a stdio server starts locally and answers in milliseconds, while a public HTTP server pays for distance. One number that is generous to the slow case and harmless to the fast one is simpler than two.

## Consequences

- The reconnect budget's own arithmetic is unchanged - ten attempts with delays of 500, 1000, 2000, 4000, 8000, 16000 and then 30000 four times, 151.5 seconds of backoff in all - and so is the give-up, which still unregisters the tools after the tenth failed attempt. What moves is the wall clock that spans it. A server that fails immediately, on a refused connection, still loses its tools after about 151.5 seconds - the two and a half minutes people reason with - and that number did not change. A server that hangs until its budget expires spends the whole startup timeout on every attempt, so its tools now survive about 451.5 seconds, seven and a half minutes, instead of about 251.5 seconds.
- A dead server now takes 30 seconds to fail its first mount attempt instead of 10.
- A server that needs between 10 and 30 seconds now mounts instead of failing, which is the point: the tools appear and the model can call them.
- The editor's placeholder for an unset startup timeout shows the effective value, so it now reads 30000. No locale string and no user-facing document states the number.
- The OAuth browser leg keeps its own five-minute budget, so a human approving a server in the browser is not shortened by the startup timeout.

## Verification

- `packages/market-mcp/test/mcp-startup-budget.test.ts` pins the default and the relation that makes it defensible: the mount budget stays below the 60-second tool-call timeout.
- The market-mcp suite passes (6 files, 42 tests) and the market-bundle MCP tests pass (5 files, 83 tests): the resolved policy's default, the server-config template and the editor's placeholder all read 30000.
