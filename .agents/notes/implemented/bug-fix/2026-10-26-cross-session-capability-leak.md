# Agent Note: A session apply must not narrow another session's capabilities

Status: implemented

## Problem

Switching an extension preset in one session sometimes made a different session report that a tool was gone. Two mechanisms produced that symptom: a lost mount behind the model's tool list, and a call denied with `extension-resource-disabled`. Both were defects in this plugin's shared-state bookkeeping, not in the host.

## Decision

Two owners were wrong, and each now has one owner.

### Catalog authority belongs to the catalog pipeline

A session apply published the declaration read it had just made as process-wide authority (`runtime.setCatalogAuthority`). Every other session's demand was then projected through that one read, so a read that was partial, stale, or raced a source update unmounted another session's MCP servers and unregistered their tools.

`RuntimeReconciler.ensureCatalogAuthority` seeds authority only while no pass has published it. A session apply calls that, so it can still project its own demand. `refreshCatalog` remains the only writer that replaces authority, and the catalog pipeline is its only caller, which owns a fresh read on every change.

### Fail-closed refresh is no longer permanent

`ExtensionRuntime.refreshAgent` returned early for a session that was not ready and for a successful refresh that landed in a superseded epoch, leaving `stale` and `dirty` set with nothing scheduled. `allows` fails closed on `stale`, so the per-agent gate denied every managed tool, and for an idle session nothing ever came back. A catalog change during the attach window was enough, and the attach window is the whole of session startup.

The peak bad state, stale and dirty with no work in flight, is now unreachable:

- every early return and every failed refresh arms the next retry, whose delay doubles from the base and settles at the ceiling,
- the schedule never stops while the session is denied. A budget that ran out would turn a transient failure into the same permanent denial this fixes, one minute later,
- a successful refresh cancels the retry and clears its budget,
- a busy session still heals through `whenIdle`, and the deferred pass arms the retry if that pass could not finish either,
- recovery from the not-ready branch re-reads the inventory inside a catch, then either refreshes the agent or arms the retry, because that branch replays a committed selection without reading anything. A throw there cannot leave the agent half-recovered.

The schedule is `inventoryRetry.baseMs` and `maxMs`, resolved once by `resolveInventoryRetry` and defaulting to 200 and 60000 milliseconds. Those are deployment-varying, so they are validated configuration fields rather than constants, the same rule the switch budget follows. A malformed value fails at load, and a base above the ceiling is refused rather than silently clamped.

The fail-closed window is unchanged while a catalog read is genuinely pending: `allows` still denies. Only the permanence is gone.

### The denial now has a name

`ExtensionRuntime.denialReason(agent)` returns `extension-inventory-pending` when the agent is stale, and both surfaces a person reads carry it:

- the per-agent tool gate appends a reason that names `extension-inventory-pending` and says the capability returns on its own, instead of the withdrawal text that tells the model to ask the user to enable something already enabled,
- the session window publishes `status.inventoryPending`, and the preset menu shows one bilingual line from it. The window also answers from cached rows when the read fails, so the panel says why rather than dying.

## Alternatives considered

- **Retry only, without readiness observation** was rejected because a retry is a timer and a session that finishes attaching a moment later should be served immediately. The deferred `whenIdle` pass and the retry together cover both, and the retry is what closes the window for an idle agent.
- **Observe readiness only, without a retry** was rejected because readiness is not the only way a refresh stalls. An inventory read can fail with a stable epoch, and nothing would observe that.
- **Clear `stale` unconditionally once a re-read was attempted** was rejected because it would authorize a resource that genuinely disappeared. The negative control is explicit: a withdrawn suite still denies, and the retry never resurrects it.
- **A bounded attempt budget that gives up** was rejected because giving up is the bug. A session denied after the budget is exactly the stranded session this fixes, only later and more quietly.
- **Keep the schedule as constants** was rejected on the repository rule: a slow machine and a large catalog change how long a re-read takes, so the schedule is policy and belongs in validated configuration.
- **Scope invalidation to the catalog revision each agent read** was rejected as the only fix because it removes the cross-session trigger, not the permanence. A session that could not complete its own refresh would still be stranded. The authority change above is the scoping fix, and this is the permanence fix.
- **Fix the host** was rejected on evidence: `tools.restrict` throws when unscoped, a restriction filters only inherited layers, a scoped mount is invisible to another agent, and no global tool list is cached. The mechanism was entirely local.

## Consequences

A session's preset apply can no longer change what any other session may mount, and a catalog change can no longer deny a session forever. The trade-offs:

- A denied session is retried on a schedule that slows to one attempt per ceiling and never stops. A session whose inventory stays unreadable keeps its tools denied, logs one line when it enters the slow schedule, and recovers on its own whenever the read starts working.
- The status surface distinguishes a pending read from a withdrawn resource, in the model-facing reason and in the preset menu, so the failure is not model-facing only.
- Recovery from the not-ready branch costs one inventory read it did not perform before.
- A failed inventory read no longer fails the whole panel read.

## Verification

`packages/market-bundle/test/integration/cross-session-mount-isolation.test.ts` drives the real reconciler and the real MCP mount registry against a loopback MCP server. A second session's apply with a partial declaration read leaves the first session's server mounted, the catalog pipeline can still narrow authority, a first-applier seed cannot hide a suite another session later selects, and a session whose read disagrees with published authority is refused with `extension-shared-demand-unavailable` rather than mounting nothing. The last case runs two live sessions through `ExtensionRuntime`: session A applies with a read that omits B's suite, and B keeps its mount and its authorization.

`packages/market-bundle/test/integration/extension-stale-recovery.test.ts` drives real Agents on a real AgentLoop with the real tool registry: a catalog change during the attach window does not cost the session its tool, a failed inventory read heals once the read works again, the retry keeps running past any old attempt budget, a genuinely withdrawn resource still denies and stays denied, the model-facing reason names `extension-inventory-pending`, the session window publishes the pending flag and clears it, and recovery that cannot finish its own refresh still schedules a retry.

`packages/market-bundle/test/integration/inventory-retry.test.ts` pins the schedule: the documented defaults, doubling that settles at the ceiling without ever stopping, delays bounded by the base and ceiling, a refused hot-loop or never-runs value, a refused base above the ceiling, and a frozen result.

`packages/market-bundle/test/integration/client-extension-presets.test.ts` renders the pending line for a ready session and asserts it is not the not-ready state.

Negative controls, each reverted, the named test failing, the file restored:

- `ensureCatalogAuthority` made to behave like the old `setCatalogAuthority`: the partial-read case fails with `expected ['demo/alpha'] to deeply equal ['demo/alpha', 'demo/beta']`.
- `scheduleRetry` made a no-op: the failed-read case fails, authorization stays denied.
- `resolveInventoryRetry` validation dropped: the hot-loop case fails with `expected [Function] to throw an error`.
- The retry ceiling removed: the schedule case fails with `expected [Array(8)] to deeply equal [100, 200, 400, 800, ...]`.
- The gate's pending reason made generic: the model-facing case fails, the reason no longer contains `extension-inventory-pending`.
- The window's pending flag dropped: the window case fails with `expected undefined to be true`.

The attach-window case passes with the retry disabled, because becoming ready re-reads the inventory and clears the mark. The failed-read case is the one that discriminates, and it is the case a stable epoch produces.
