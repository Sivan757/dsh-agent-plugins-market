# Agent Note: Bounded change pipeline and request waits

Status: implemented

## Problem

Installing, uninstalling, enabling or disabling a suite answered only after the whole change pipeline had finished: the durable state write, then every derived surface — project commands, suite instructions, project MCP and hooks, user commands, and the runtime mount reconcile. A mount that never settled therefore held the request open, and with it the market page's blocking overlay. Nothing on the path had a deadline: the client's `fetch` calls had none, the pipeline had none, and `ReconcileScheduler` cleared its in-flight pass only in a `finally`.

The failure was observed as a single stuck mount freezing every later mutation. `POST /api/agent-plugins/mcp-retry`, which runs exactly the reconcile that an enable awaits, did not answer in 280 seconds on a live profile while plain reads answered in milliseconds and a full 1,026-suite scan took 1.2 seconds. Because `request()` joins the pass in flight, each later mutation waited on the same promise: one wedged pass meant no enable, disable, install or uninstall could complete until the Host restarted, and the overlay could not be dismissed.

## Decision

A mutation answers when its state is durable, never when its mounts are live. `CatalogContext.notifyChanged` invalidates snapshots synchronously and schedules one coalesced refresh pass in the background; a pass already in flight absorbs the changes that land while it runs. `CatalogContext.refreshSettled(deadlineMs)` is how an explicit caller waits for that pass, bounded by `DERIVED_REFRESH_WAIT_MS` (10 s) so an overrun reports back instead of being awaited.

Bounds apply to waits, never to work. `settlesWithin(work, deadlineMs)` (`src/runtime/deadline.ts`) races a promise against a timer and reports which happened first; nothing is cancelled, because cancelling a mount would either orphan a spawned server process or discard an authorization the user is completing. The composition root gives every change-pipeline stage the same treatment (`CHANGE_STAGE_DEADLINE_MS`, 20 s in `src/index.ts`), logging an overrun and continuing, so a stuck surface costs its own freshness rather than the pipeline's liveness.

Manual MCP retry rebuilds what is live. A bridge whose server died underneath the registry still matches its own resolved config fingerprint, so no pass would ever re-verify that mount — a local IDE-side endpoint was reported `connected` long after it began refusing connections. `McpMountRegistry.forceRemountAll` flags every live mount for an explicit rebuild, wired through the `mcpRemountAll` port and applied by `retryMounts` before the pass it then waits on.

The client never waits without end. Reads are bounded by `READ_TIMEOUT_MS` (15 s) and mutations by `MUTATION_TIMEOUT_MS` (10 min) in `src/client/api.ts`; a `RequestTimeoutError` reaches the user as the `requestTimeout` label through `clientErrorMessage`. The blocking overlay states a long wait after `BUSY_LONG_RUNNING_MS` (20 s) instead of implying one.

## Alternatives considered

**Keep the pipeline awaited and bound only the total.** It preserves the old reading — the dialog closes when the mounts are live — but every toggle still blocks for a mount the user did not ask to wait for, and the ceiling becomes a number chosen for the slowest legitimate clone rather than for the work the user just did.

**Cancel the request and the mount on a deadline.** A deadline cannot tell a wedged mount from a pending browser authorization. Abandoning the latter discards the authorization the user is completing, and abandoning a stdio mount orphans its child process; bounding the wait keeps both recoverable, which is also why the mount-level OAuth bound (`CALLBACK_TIMEOUT_MS`, five minutes) is left to the bridge.

**Probe every mount when building the MCP status payload.** It would report a dead endpoint honestly, but it puts network I/O on a panel read and still cannot distinguish an idle server from a dead one. Rebuilding on explicit retry fixes the reported symptom without inventing a probe policy.

## Consequences

A mutation and the overlay it raises now finish in the time of a state write. Mounts, commands, hooks and LSP registrations catch up behind it, so a client that reads immediately after a toggle can see new state before the corresponding surfaces are live; the status panels are where mount readiness is read. A mount that wedges delays its own surface until the bridge's own bound trips, and now logs an overrun instead of freezing every later change. Because the derived refresh is coalesced, a burst of mutations costs one pass rather than one per mutation, and a rejected pass no longer wedges the queue.

## Testing

`tests/catalog.test.ts` pins that a mutation resolves while the change callback is still gated, that `refreshSettled` reports the running pass, and that a rejected pass does not stop later refreshes. `tests/deadline.test.ts` pins the bounded wait, including that the work still settles after the deadline expired. `tests/mcp-mounts.test.ts` pins the forced rebuild of every live mount. `tests/client-busy-overlay.test.ts` pins the long-running warning and the lease release. `tests/project-commands.test.ts` and `tests/project-mcp.test.ts` await `refreshSettled` after a project-layout switch, which is the contract for any test that asserts derived state.
