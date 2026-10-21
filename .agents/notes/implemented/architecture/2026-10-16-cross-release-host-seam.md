# Agent Note: Drive one host seam across host release lines

Status: implemented

## Problem

The plugin declares its host contract on the `next` candidate line, and `scripts/check-host-alignment.mjs` keeps that declaration current. The host's own compatibility check reads those ranges with prereleases admitted, so a range like `^0.2.0-rc.2` already claimed compatibility with `0.2.1-alpha.4`. The claim was unmet in code: measured against the 0.2.1-alpha.4 packages, the plugin failed to compile in two source files and 130 of its 2052 tests failed. The line moved again before the fix shipped: `next` moved to `0.2.1-rc.2`, and the declared baseline followed it.

The host renamed or removed every member behind that failure:

| Consumed surface            | 0.2.0-rc.2                                        | 0.2.1-alpha.4                                                     |
| --------------------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| Start one continuable child | `subagents.startContinuable(spec)`                | `subagents.startActivation(spec)`, which also requires `delivery` |
| Start one foreground child  | `subagents.start(provider, request)`              | `subagents.startActivation(spec)` with `delivery: 'caller'`       |
| Release resident children   | `subagents.drainContinuableChildren(parent, ids)` | `subagents.drainChildren(parent, ids)`                            |
| Provider capability record  | `toolFilter`, `persona`                           | removed; `agentPreset` added                                      |
| Team message result         | `{ messageId, status }`                           | `{ messageId }`                                                   |
| JSONL persistence plugin    | default export                                    | named `apply`, `name`, `Config`                                   |
| zod                         | host range `^4.4.3`                               | host pin `4.4.3`                                                  |

The host documents the first two renames in [`subagent-activations`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-alpha.1/subagent-activations/guide.md) and [`subagent-preset-composition`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-alpha.1/subagent-preset-composition/guide.md).

The zod row is a copy problem, not a version preference. A plugin schema crosses into the host's `ProjectionDefinition.stateSchema`, whose `ZodType` comes from the host's own zod. While the host used a caret range, one copy resolved for both sides. The host now pins zod exactly, so a second copy appears and the host's `ZodType` becomes nominal: the plugin's `z.object({...})` no longer matches it.

## Decision

The declared baseline stays on the `next` candidate line — `0.2.1-rc.2` since 2026-10-17 — and the code works on both that line and its predecessor `0.2.0-rc.2`.

`packages/market-runtime/src/runtime/agents/subagent-seam.ts` owns the rename table. Every member is optional, every call is guarded with `typeof`, and a host that exposes neither name is refused with a message naming both. The router's continuable and foreground starts and the role runtime's drain call go through the seam instead of a host member directly. The foreground path is a seam member too: `startOneShotChild` maps the older `start` and the newer `startActivation` with caller delivery to one blocking run shape.

The provider capability record is one variable carrying both spellings. The host reads only the flags it knows, so one record serves both lines; an object literal would fail the newer excess-property check.

`zod` is declared as `^4.4.3` and `pnpm-workspace.yaml` pins it to `4.4.3` through `overrides`, so the plugin and the host resolve one physical copy. The override is a dev-tree dedupe, matching the existing `source-map-js` entry.

## Alternatives considered

- **Move the baseline to the `alpha` tag and repin every host entry.** Rejected: it reverses [resolve the alignment baseline from the prerelease candidate line](../process/2026-09-23-next-channel-baseline.md), which rejected the experimental channel because it runs ahead of the host consumers install, and `^0.2.1-alpha.4` excludes `0.2.0-rc.2`, the host a local `dsh` still runs.
- **Rename the calls without guards.** Rejected: it compiles on one line and breaks the other, which is the drift the alignment gate exists to prevent.
- **Cast the renamed members instead of guarding them.** Rejected: the seam follows the plugin standard's rule for a host capability the declared types do not carry, and a cast would hide the next rename instead of reporting it.
- **Leave zod alone and cast the projection schema.** Rejected: the duplicate copy is the defect; a cast would silence the symptom while the second copy stays.

## Consequences

- One module holds the host rename table. The next rename adds one guarded member there instead of spreading conditionals through the runtime.
- A host exposing neither name fails with a named error instead of a property access on `undefined`. This holds for the foreground channel as well: a host exposing neither one-shot start member is refused by name before a child exists.
- The zod pin tracks the host family's exact pin. A host that moves zod needs the same move here, or the two-copy type failure returns.
- The plugin compiles and passes its full suite on the pinned `0.2.1-rc.2` baseline, and the seam keeps `0.2.0-rc.2` working because that host is still installed on the development machine.
- 0.2.1 also mounts the subagent service behind `workingDirectory` and gates a `run_code` call with an Agent on it, so every test that mounts the real subagent service now asks the test kit for the directory fixture.

## Related decisions

Partially superseded by [one module owns the host subagent member names](2026-10-20-subagent-seam-member-ownership.md): that note covers the ownership rule and the contract tests, while this note remains authority for the rename table, the guarded members, and the zod pin.

Keeps [resolve the alignment baseline from the prerelease candidate line](../process/2026-09-23-next-channel-baseline.md) in force on the channel question and adds the code-side tolerance that decision left implicit.
