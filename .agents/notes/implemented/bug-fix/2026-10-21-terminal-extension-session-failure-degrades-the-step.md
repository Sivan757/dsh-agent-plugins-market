# Agent Note: a terminal extension-session failure degrades the step

Status: implemented

## Problem

Every workspace session runs an extension session start before its first step. The start captures the session's selection: it reads the workspace inventory, then applies the selection through the host. If that capture throws, the service records the error and marks the agent unavailable, and the pre-step handler refuses to enter a step: it re-prepends the claimed messages and rejects. The host then ends that turn as `blocked` and keeps the messages queued.

Rejecting is correct for a transient failure, because something retries it. A capture that failed at session start has no such retry. `initialize` is single-flight and memoizes the error, an explicit recovery re-runs the same failing read, and the per-agent state is keyed by the Agent. The request behind that rejection therefore waits forever: each user send ends in another blocked turn, and the agent never starts.

Issue #113 reported this as the visible symptom of a packaging defect ([`files` did not ship the schemas]](./2026-10-21-published-artifact-ships-its-schemas.md)). The scan threw `ENOENT` once per session attempt, and every workspace session, new or resumed, stopped after its first user message. The first message in the log was the start; the second was a fresh Agent for the same session id doing the same failing read.

## Decision

`ExtensionSessionState` records whether the failed attempt was the session start itself. On the next pre-step, a recorded error that is terminal enters the step instead of rejecting it, and the turn runs degraded.

Terminal means three facts together: the error came from `initialize`, no attempt is in flight, and the code is neither `extension-session-busy` nor `extension-session-corrupt`. A busy attach owns its retry on idle. A corrupt record is an uncertain log that the user must clear. Everything else with no retry behind it degrades the step.

Degrading grants nothing. The status stays not ready with its error, `read()` still throws `extension-session-not-ready`, `ExtensionRuntime.allows` denies, and the tool gates deny, so the session keeps working while its managed resources stay unavailable. The failure stays visible twice: `status.error` for the panel and one `warn` line per recorded code for the log.

A failure recorded after a working session keeps the old contract: the request waits for the explicit recovery that re-applies the committed selection, because a turn that runs between a half-applied and a rolled-back selection is worse than a wait with a recovery control. The start-failure mark is cleared by any published state, so that distinction is exact.

## Alternatives considered

**Install an empty fail-closed selection on a failed start.** This makes `status` report ready and the selection a normal one, so the turn runs without any special branch. It also removes the recovery control for a failure that has nothing to recover, and it publishes a selection nobody chose. Every consumer that reads "no selection means no authorization" would have to learn the difference between an empty real selection and this one.

**Stop re-prepending and let the turn end with no step.** The request would be consumed without a model call and without an answer, which reports success for work that never ran. Entering the step at least answers the user and states that managed resources are unavailable.

**Cap the number of blocked turns and then fail.** A count changes when the session gives up, not whether the request is ever served: a capture with no retry behind it fails identically on every attempt.

**Retry the capture on a timer.** The repository already bounds its retry schedules for mounts, but a session start is a one-shot capture that produced a deterministic error. Retrying it burns turns on a failure whose cause does not change, and the user still cannot tell why the session is empty.

**Change the host to start the agent without waiting for the plugin.** The host already supports this: an `enter` decision grants nothing on its own, and the plugin owns the decision whether to enter. The fix belongs on this side of the seam.

## Testing

`packages/market-bundle/test/integration/extension-session-scan-failure.test.ts` drives the real agent loop with a recording model adapter and an inventory port that throws the packaged artifact's `ENOENT`:

- a failed start on create: one inventory call, status `ready:false` with `error: 'ENOENT'`, then a user send reaches the model with one request, the turn ends `completed`, and the tool gate reports the managed tool absent;
- a failed start on resume: a first agent commits a selection and is disposed, and a second agent for the same session id replays the apply with a throwing inventory. It reaches the model the same way, with exactly one inventory call;
- a session that recovers, then fails mid-session: the request is parked again, which pins the distinction the clear-after-publish rule exists for.

Two cases in `extension-session-recovery.test.ts` encoded the old park-forever contract for a failed start and were updated with the contract: the undecidable-eligibility case and the failed-maintenance case. Both still assert that nothing is granted.

## Related

This partially supersedes the recovery rule in [serialize policy state and recover queued user work](../architecture/2026-10-08-policy-and-recovery-stability.md): a request behind a failed session start no longer waits for an explicit recovery, while a request behind a mid-session failure still does. It also qualifies [shared surfaces and next-turn selection](../architecture/2026-10-08-shared-surfaces-and-next-turn-selection.md): its busy rejection is the `extension-session-busy` path that keeps its own retry and therefore never degrades. Neither decision is fully superseded.

## Consequences

A session whose extension start fails now runs with no managed skills, commands, subagents, hooks, MCP servers, or LSP providers until the user recovers. That is the deliberate trade: a session that answers without managed resources beats a session that never starts. A user who expects plugin resources in that session sees them missing, and the panel's error names why.

A mid-session failure still parks the request. Widening the degrade rule to every failure would let a turn run between a half-applied and a rolled-back selection, and restoring the committed selection needs the explicit recovery control.

The start-failure mark is in memory and keyed by the Agent, which is correct: a host restart replays the session and makes one fresh attempt, so a stale mark would be wrong.

Issue #113's "hundreds of iterations per minute" is not a spin inside this plugin. Each attempt costs exactly one scan, so the multiplicity came from whatever re-issued the session attempt. The defect on this side is that one attempt was enough to hang the session forever, and this decision removes that.
