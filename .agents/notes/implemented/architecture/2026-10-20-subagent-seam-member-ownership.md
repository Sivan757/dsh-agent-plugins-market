# Agent Note: One module owns the host subagent member names

Status: implemented

Partial supersession of [drive one host seam across host release lines](2026-10-16-cross-release-host-seam.md): the rename table, the guarded members, and the zod pin stay as that note decided. This note replaces its ownership claim and its answer to "what prevents the next rename from reaching a user".

## Problem

The host renames and removes members of `ctx.subagents` between releases. The plugin already had a seam module with a guarded rename table, and it still shipped a bare `host.subagents.start(...)` call in the foreground branch of the role router after host 0.2.1 removed that member. Users who passed `run_in_background: false` got a raw `TypeError`.

Two gaps made that possible. The rename table carried only two of the four members the plugin drove, so `start` and `registerProvider` stayed outside it and outside every guard. And nothing in the build compared the table with the host: the role router's `AgentRoleHost` is a local interface reached through a cast, so the compiler never saw the host package, and the tests supplied hand-written fixtures that carried whatever member the plugin's own interface declared.

## Decision

`packages/market-runtime/src/runtime/agents/subagent-seam.ts` becomes the only module in the repository that names a host subagent member.

- One exported table, `SEAM_MEMBER_ALTERNATIVES`, lists every spelling of every driven operation, preferred spelling first:

  | Operation          | Spellings, in preference order              |
  | ------------------ | ------------------------------------------- |
  | `oneShotChild`     | `start`, `startActivation`                  |
  | `continuableChild` | `startContinuable`, `startActivation`       |
  | `drainChildren`    | `drainContinuableChildren`, `drainChildren` |
  | `registerProvider` | `registerProvider`                          |

- Every guard resolves its member through that table, so a guard and a test cannot read different lists. A host exposing no spelling of an operation is refused with a message naming all of them.
- One exported adapter per operation, `SEAM_ADAPTERS`, so an operation added to the table without an adapter fails a test instead of a user session.
- `teammate-role-runtime.ts` stops reading the service directly: its provider registration and its drain call go through seam helpers, and its field is typed as the seam rather than the host class.
- Two tests enforce the rule. `packages/market-runtime/test/host-seam-contract.test.ts` reads `Object.getOwnPropertyNames(SubagentRuntime.prototype)` from the installed host package and asserts that every table operation resolves through at least one spelling. `packages/market-bundle/test/repo/subagent-seam-ownership.test.ts` scans `packages/*/src` and fails when a file outside the seam module reads or calls a host subagent member.

The dependency-cruiser check cannot host the source rule: it analyses module edges, not property access.

## Alternatives considered

- **Add the missing members to the existing table and stop there.** Rejected. The table was already the right shape; what failed was that nothing compared it with the host and nothing stopped a new call site from bypassing it. The two tests are the part that turns a convention into a gate.
- **Express the source rule as a dependency-cruiser rule.** Rejected on capability. `check:architecture` forbids and permits module edges; it cannot see that one module dereferences one property of one service.
- **Hold the member names in a committed host inventory and compare it with the host.** Rejected. An inventory of every host package drifts with each release and needs a generator, a refresh step, and its own staleness rule. Reading the prototype of the one service the plugin drives answers the question directly.
- **Cast the seam to the installed host class and let the compiler check the calls.** Rejected. The plugin supports two release lines whose member sets differ, so no single class type can describe both, and a cast is what hid the last break.

## Consequences

- Removing or renaming a host subagent member now fails the contract test at build time, before a user session reaches it.
- A new call site that names a host member fails the ownership test, so the seam cannot be bypassed by accident.
- The table is the one place a future rename is recorded. A member that disappears from every spelling of its operation is a failing test, not a silent `undefined` dereference.
- The ownership test is a text scan, so an installed package's own code is out of scope by construction: it scans this repository's sources and nothing else.
- `registerProvider` gained a guarded adapter it did not have. The role teammate path keeps its behavior; it now reports a host without a provider registry by name instead of failing on a property read.
