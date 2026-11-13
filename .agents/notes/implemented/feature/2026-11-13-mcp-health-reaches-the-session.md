# Agent Note: MCP health reaches the session

Status: implemented

## Problem

An MCP server that dies after it connected leaves almost no trace. The supervisor keeps its tools registered while it retries, so the model's next request still lists them and every call fails at the transport; when the attempt budget runs out the tools are unregistered, and the next request simply carries fewer tools. The only durable record is a process log line. Nothing in the conversation says that a capability disappeared.

The host client's own mechanisms stop at reconnection: bounded backoff, a stability window that resets the budget, and the registry's `tools/change`, which reports that the tool set moved without saying why or who moved it. A `ToolDefinition` carries no owner, so a name such as `mcp__signoz__query_metrics` is the only provenance the harness has. This plugin knows more: the mount registry maps a derived `serverName` to the suite and declaration behind it, and the bridge already publishes every connection phase as an `McpConnectionObservation`. That knowledge reached the status panel and stopped there — a panel a reader has to open before learning anything.

## Decision

- **One fold, two surfaces.** `McpHealthMonitor` turns the supervisor's phase edges into at most three transitions per outage: `degraded` at the second failed attempt, `stopped` when the attempt budget is spent, and `recovered` once the server has served tools for five seconds. Edges drive every decision; the recovery is the one deferred check, a single per-outage timer any later edge cancels, because a supervisor reconnects a crash-looping server on every attempt and each of those connects is real — reporting one recovery per flap would turn a single outage into a stream of contradictory messages.
- **The publication gained a subscription, not a new publisher.** `observeMcpConnections` on the connection registry is the seam; the monitor subscribes through it, so no supervisor knows the monitor exists and the status panel keeps reading the same snapshot. This builds on [a dropped MCP connection says what happened](../bug-fix/2026-10-30-mcp-connection-observations.md), which established the phases and the panel; that note's record stays accurate, and its registry gained the subscription.
- **A notice reaches the session.** `mountMcpHealthNotices` injects one user-role message per transition, carried by a `notice`-form source (`plugin-market-mcp`), with a localized one-line summary and a body naming the service, its suite, the attempt, the next retry, and the last error. Delivery uses `agent.inject`, never `followup`: a connection change never starts a turn, so an idle session receives the notice with the next request that would have used the missing tools. Every session gets its own message identity, because one message shared across inboxes would cross session boundaries.
- **A health section reaches the model.** `mountMcpHealthSection` registers one global `systemPrompt.section` at `MCP_SERVERS + 1`, and renders an empty string while every server is healthy. It is process-wide because the mounts are: MCP tools are registered once for the process, not per workspace, so every agent reads the same list. It sets `interpolate: false`, because a suite id is authored text that must reach the model as written.
- **The section is fixed English; the notice is bilingual.** The section is read beside the harness's own MCP sections and tool descriptions, the same split `host-locale.ts` already records for the subagent catalog. The notice is an interface string and resolves through that host locale table, defaulting to zh.

## Alternatives considered

- **Poll the status route and diff consecutive reads.** Rejected: it invents a second clock, pays catalog work on every tick, and still misses transitions that happen between two polls. The supervisor already publishes on the edge.
- **A model-facing `mcp_health` tool.** Rejected: it asks the model to suspect the failure first, and the failure mode is a model that quietly works around a missing tool — exactly the case in which nobody thinks to ask.
- **Wake the session with `followup`.** Rejected: a reconnect is not a user request, a transient outage would start a turn nobody asked for, and its answer would be paid for by no question.
- **Announce every retry edge.** Rejected: a bounce that reconnects on the first retry is not news, and one notice per backoff step turns a single outage into ten messages.
- **Keep the facts only in the system prompt.** Rejected as the sole channel: the section says what is missing now, but the reader of the conversation sees nothing; the notice is what says it happened.
- **Report the recovery as a mount rebuild.** Rejected: a bridge disposal followed by a fresh connect is the ordinary remount path, and calling that a recovery would announce connections that never failed. The monitor keeps a marker only for an outage it had announced, so the next connect still closes the story.
- **Announce the recovery on the first `connected` edge.** Rejected after a live flap test in a standalone host: a crash-looping server connected and died every 1.2 seconds, so the session received a recovered notice followed by a fresh degraded one on every cycle, and the model reported a recovery that was already false. Recoveries now wait out an uptime window, which is the same stability question the supervisor's own budget reset asks.
- **Wrap every bridge tool's execution errors with the connection state.** Deferred, not rejected: it is the next layer, and it changes the execution path of every tool rather than one publication seam.

## Consequences

- A dropped server is visible to the session that lost it, in the reader's language, without opening the panel; and the model can name the missing capability instead of silently working around it.
- A healthy session pays nothing: the section is empty and no notice is produced.
- `mcpEnhanced: false` (the host compatibility backend) produces no notices, because that client publishes no connection phases through this seam. The services guide states that boundary.
- An announced outage keeps a marker when its bridge is disposed, so the remount's connect still resolves as a recovery. The marker is one entry per server name and is cleared by the next connect or the next outage.

## Testing

- `packages/market-mcp/test/mcp-health.test.ts` pins the announcement threshold, the once-per-outage rule, the stopped announcement, the recovery that survives a bridge rebuild, and listener containment.
- `packages/market-runtime/test/mcp-health-section.test.ts` and `mcp-health-notice.test.ts` pin the rendered copy in both languages, the empty-when-healthy section, and the delivery contract: one message per session, no wake, and one refused session that does not stop the others.
- `packages/market-bundle/test/integration/mcp-health-wiring.test.ts` drives the real chain from `recordMcpConnection` through the fold to the notice and the section, so a wiring change that leaves a link unsubscribed fails there.
