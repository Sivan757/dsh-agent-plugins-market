# Agent Note: MCP surface switch latency

Status: implemented

## Problem

Turning the MCP surface off or on felt slow enough that the owner reported it as a defect ("MCP 的开关非常慢"). The cost was spread over three places and only the last one was visible in a profile:

- one mount pass spent one network handshake per server in series, because `McpMountRegistry` awaited each `mountWith` inside a `for` loop, and awaited each child's teardown the same way,
- every settings switch request waited for that whole pass, because `ResourceFilterService` awaited the change pipeline its write scheduled, and the panel row switch awaited `refreshSettled`, so one server that would spend its whole startup timeout held the switch for that timeout,
- nothing let a switch answer before the mount work it started had finished, so the answer time was the pass time.

With three remote Streamable HTTP servers, a measured pass over loopback endpoints that delay `initialize` by 300 ms took 977 ms and the switch route answered in 931 ms. One server that spends its whole declared startup budget pushes the switch to that budget, and the built-in default budget is 10 seconds.

## Decision

Three changes, each measured on its own.

### One mount pass runs its servers at the same time, bounded

`packages/market-mcp/src/runtime/mcp/mcp-mounts.ts` splits a pass into a removal batch and an addition batch, and runs each batch through `mapBounded` with `MOUNT_PASS_CONCURRENCY` (4) in flight. Removals still finish before additions start, so a pass never mounts a server whose sibling it is still tearing down. Results are collected in input order, so diagnostics read the same however the servers interleave. `disposeAll` uses the same bound.

The pass queue itself is unchanged: `SerialPassQueue` still guarantees a pass cannot overlap another, which is what keeps a stale mount impossible.

### A switch waits for its pass only within one budget

`SWITCH_SETTLE_MS` (1000) lives beside `settlesWithin` in `packages/market-catalog/src/application/deadline.ts`, because it is a wait bound and not a policy of its own. `ResourceFilterService.settle` waits that long for the pipeline its write scheduled:

- the write is already on disk and in the published snapshot before the wait starts, so the switch is durable regardless of the outcome,
- a pass that settles inside the budget keeps the previous contract, including propagating its failure to the caller,
- a pass still running at the budget lets the switch answer, and the pass is never cancelled,
- an overrun, or a failure that lands after the answer, reaches `ResourceFilterHooks.onPipelineReport`, which the composition root logs.

`McpService.updateServerOverride` gives the same budget to `refreshSettled`, so the MCP panel row switch is bounded the same way. The panel's next read shows the pass's own outcome.

## Measured before and after

Same harness both times: `packages/market-bundle/test/integration/mcp-toggle-latency.test.ts` against three loopback Streamable HTTP endpoints, 300 ms `initialize` delay each.

| Measurement                                                            | Before  | After   |
| ---------------------------------------------------------------------- | ------- | ------- |
| One pass, mount 3 servers                                              | 977 ms  | 367 ms  |
| One pass, unmount 3 servers                                            | 4 ms    | 4 ms    |
| One pass, unmount with 200 ms teardown each                            | 606 ms  | 202 ms  |
| Surface-toggle route, MCP on                                           | 931 ms  | 317 ms  |
| Surface-toggle route, MCP off                                          | 11 ms   | 6 ms    |
| Surface-toggle route, one server uses its whole 2500 ms startup budget | 3128 ms | 1005 ms |

The mount and switch rows are one handshake deep instead of three. The hanging row is the budget, not the server.

## Alternatives considered

- **Answer the switch before anything mounts, with no wait at all** was rejected because a switch that never waits also never confirms that an ordinary, healthy pass happened, and the cost of that confirmation is what the budget spends. A budget keeps the common case exact and caps only the pathological one.
- **Cache the wanted set and skip pass work when the toggle did not change** was rejected because the pass is already 2 ms when nothing changes, so the cache would buy almost nothing while adding a second place that decides what is mounted.
- **Raise the mount concurrency to every server in the profile** was rejected because a profile with many suites would open every child and remote connection at once, which trades a serial stall for a burst that is harder to diagnose and can exhaust file descriptors.
- **Let each mount settle in the background so the pass never waits for a handshake** was rejected because a pass that returns before it knows which servers are live cannot assert that a demanded server is mounted, and `assertMounted` is the guarantee a session preset relies on.
- **Bound the wait inside `onChanged` in the composition root** was rejected because that hook also serves catalog mutations that must not acquire a switch's UI budget, and the durable write it follows differs per caller.

## Consequences

An MCP switch now costs one handshake rather than one per server, and never more than one second, whatever the servers do. The trade-offs:

- A switch answered after its budget does not prove the pass finished. A status read taken in that window reports the previous state; the next one reports the pass's outcome, and the overrun is logged.
- Mount concurrency is a fixed safety bound, not a setting: it caps how many servers one pass may start at once, and it is not deployment-varying in the way a timeout policy is.
- A busy profile still pays one handshake per pass, so the remaining latency scales with the slowest server rather than with their number.

## Verification

`packages/market-bundle/test/integration/mcp-toggle-latency.test.ts` drives the real mount registry, the real reconciler gates and the real surface-toggle route, and pins the four behaviors this change must keep:

- one pass mounts every server at the same time and mounts each exactly once, and a repeat pass mounts nothing,
- a batch unmounts at the same time,
- the switch answers before a server that spends its whole startup budget, the pass then reports `mount-failed`, and the hung server owns no tools,
- flipping the LSP gate never re-runs an MCP handshake, while the MCP gate itself unmounts and remounts exactly once per server,
- a server that refuses connections reports `mount-failed` and leaves no namespace reservation.

`packages/market-bundle/test/integration/resource-filter-budget.test.ts` pins the switch budget: the answer arrives on the budget while the pass continues, the write is durable before the answer, a pass that fails inside the budget still rejects to the caller, and a pass that fails afterwards is reported instead.
