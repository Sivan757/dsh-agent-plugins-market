# Agent Note: MCP surface switch latency

Status: implemented

## Problem

Turning the MCP surface off or on felt slow enough that the owner reported it as a defect ("MCP 的开关非常慢"). The cost was spread over three places and only the last one was visible in a profile:

- one mount pass spent one network handshake per server in series, because `McpMountRegistry` awaited each `mountWith` inside a `for` loop, and awaited each child's teardown the same way,
- every settings switch request waited for that whole pass, because `ResourceFilterService` awaited the change pipeline its write scheduled, and the panel row switch awaited `refreshSettled`, so one server that would spend its whole startup timeout held the switch for that timeout,
- nothing let a switch answer before the mount work it started had finished, so the answer time was the pass time.

With three remote Streamable HTTP servers, a measured pass over loopback endpoints that delay `initialize` by 300 ms took 977 ms and the switch route answered in 931 ms. A server that spends its whole declared startup budget pushes the switch to that budget, and the built-in default is 10 seconds.

## Decision

Three changes, each measured on its own.

### One mount pass runs its servers at the same time, bounded

`packages/market-mcp/src/runtime/mcp/mcp-mounts.ts` splits a pass into a removal batch and an addition batch, and runs each batch through `runBounded` with `MOUNT_PASS_CONCURRENCY` (4) in flight. Removals still finish before additions start, so a pass never mounts a server whose sibling it is still tearing down. `disposeAll` uses the same bound.

`runBounded` is total: it wraps each item and returns an `ok` or a failed slot, so a lane that throws becomes one reported failure instead of a rejected batch. That matters because `SerialPassQueue` releases its tail when a pass rejects. A rejected batch would let the next pass compute its removals from `this.live` while a straggler lane was still mounting, which is the stale mount this registry exists to prevent. A failed slot is reported as `mount-failed`, schedules its own retry, and drops any namespace reservation it left.

Duplicate derived serverNames are settled in wanted order before any handshake starts, and a copy whose name the winner failed to claim is mounted after the additions batch. Without that second attempt, a broken first arrival would leave the server unmounted for good, and the passes that follow would describe it as a redundant copy.

Results are collected in input order, so diagnostics read the same however servers interleave, and `SerialPassQueue` still guarantees a pass cannot overlap another.

### A switch waits for its pass only within one budget

`ResourceFilterService.settle` waits for the pipeline its write scheduled. The budget is `switchSettleMs`, resolved by the composition root through `resolveSwitchSettleMs` and defaulting to `SWITCH_SETTLE_MS` (1000):

- the write is already on disk and in the published snapshot before the wait starts, so the switch is durable regardless of the outcome,
- a pass that settles inside the budget keeps the previous contract, including propagating its failure to the caller,
- a pass still running at the budget lets the switch answer, and the pass is never cancelled,
- an overrun, or a failure that lands after the answer, reaches `ResourceFilterHooks.onPipelineReport`, which the composition root logs,
- `0` never waits, which is the documented way to take lane speed over an accurate immediate status.

`McpService.updateServerOverride` gives the same budget to `refreshSettled`, so the MCP panel row switch is bounded the same way. The panel's next read shows the pass's own outcome.

The budget is a configuration field rather than a constant because it is a user-visible latency policy: a deployment that mounts many slow servers may want to wait longer, and one that never wants to wait can set `0`.

## Measured before and after

Same harness both times: `packages/market-bundle/test/integration/mcp-toggle-latency.test.ts` against three loopback Streamable HTTP endpoints, 300 ms `initialize` delay each, on the same machine.

| Measurement                                                            | Before  | After   |
| ---------------------------------------------------------------------- | ------- | ------- |
| One pass, mount 1 server (the harness's unit of work)                  | 770 ms  | 772 ms  |
| One pass, mount 3 servers                                              | 977 ms  | 346 ms  |
| One pass, nothing to do                                                | 2 ms    | 2 ms    |
| One pass, unmount with 200 ms teardown each                            | 606 ms  | 211 ms  |
| Surface-toggle route, MCP on                                           | 931 ms  | 314 ms  |
| Surface-toggle route, MCP off                                          | 11 ms   | 7 ms    |
| Surface-toggle route, one server uses its whole 2500 ms startup budget | 3128 ms | 1006 ms |

The mount and switch rows are one handshake deep instead of three, which the three-server row shows against the one-server unit beside it. The hanging row is the budget, not the server.

## Alternatives considered

- **Keep `SWITCH_SETTLE_MS` a constant** was rejected because it changes a user-visible guarantee rather than describing a protocol or a safety limit: it decides how long a person waits. The plugin already makes deployment-varying timeouts configurable, in `git.timeoutMs` and per-server `startupTimeoutMs`, so a fixed value here would be the inconsistent choice. It is now a configuration field with the old value as its default.
- **Make `MOUNT_PASS_CONCURRENCY` a configuration field too** was rejected because it is a containment bound rather than a preference. It caps how many children and remote connections one pass opens at once, so a high value is a descriptor and thundering-herd risk and a value of one restores the serial stall. A limit the implementation needs in order to be safe stays fixed.
- **Answer the switch before anything mounts, with no wait at all** was rejected as the default because a switch that never waits also never confirms that an ordinary, healthy pass happened. It survives as the `0` setting, chosen rather than imposed.
- **Cache the wanted set and skip pass work when the toggle did not change** was rejected because the pass is already 2 ms when nothing changes, so the cache would buy almost nothing while adding a second place that decides what is mounted.
- **Let each mount settle in the background so the pass never waits for a handshake** was rejected because a pass that returns before it knows which servers are live cannot assert that a demanded server is mounted, and `assertMounted` is the guarantee a session preset relies on.
- **Bound the wait inside `onChanged` in the composition root** was rejected because that hook also serves catalog mutations that must not acquire a switch's UI budget, and the durable write it follows differs per caller.

## Consequences

An MCP switch now costs one handshake rather than one per server, and by default never more than one second, whatever the servers do. The trade-offs:

- A switch answered after its budget does not prove the pass finished. A status read taken in that window reports the previous state. The next read reports the pass's outcome, and the overrun is logged.
- Two switches in a row are serialized by the policy queue, so the second answer can be up to two budgets on a pathological profile. The second write still lands, because the dequeued closure writes unconditionally. A healthy profile answers both in milliseconds.
- Mount concurrency is fixed while the switch budget is configurable. The asymmetry is deliberate: one bounds resources, the other bounds patience.
- A busy profile still pays one handshake per pass, so the remaining latency scales with the slowest server rather than with their number.
- A failure inside a bounded slot is now a diagnostic instead of a rejected pass. That contains it better, and it also means a bug in the mount path shows up as one failed server rather than as a broken pass.

## Testing

The latency test asserts concurrency from recorded `initialize` and teardown spans, so a serial regression fails on any machine speed. It also normalizes the three-server pass against a one-server pass measured on the same harness, and it keeps the printed numbers as evidence rather than as assertions. Wall-clock thresholds survive only for the switch budget, which is a time contract.

## Verification

`packages/market-bundle/test/integration/mcp-toggle-latency.test.ts` drives the real mount registry, the real reconciler gates and the real surface-toggle route, and pins the five behaviors this change must keep:

- one pass mounts every server at the same time and mounts each exactly once, and a repeat pass mounts nothing,
- a batch unmounts at the same time,
- the switch answers before a server that spends its whole startup budget, the pass then reports `mount-failed`, and the hung server owns no tools,
- flipping the LSP gate never re-runs an MCP handshake, while the MCP gate itself unmounts and remounts exactly once per server,
- a server that refuses connections reports `mount-failed` and leaves no namespace reservation.

Two of those carry a regression of their own:

- a throw inside one mount becomes a `mount-failed` diagnostic and the rest of the batch still mounts, with the following pass tearing everything down,
- a duplicate whose winner could not claim the name is mounted by the takeover, so exactly one copy ends up owning it,
- a namespace another MCP client really does own is still reported as `foreign-mount`.

`packages/market-bundle/test/integration/resource-filter-budget.test.ts` pins the switch budget: the answer arrives on the budget while the pass continues, the write is durable before the answer, a pass that fails inside the budget still rejects to the caller, a pass that fails afterwards is reported instead, `resolveSwitchSettleMs` keeps the default and rejects a negative or non-finite value, and a `0` budget answers before the pass and still stores the choice.

The pipeline-failure branch of `settle` has no production trigger today. `runStage` in the composition root catches each stage, so `onChanged` never rejects, and the branch exists for the seam's own contract: any caller whose hook can reject gets the old behavior inside the budget and a report outside it.
