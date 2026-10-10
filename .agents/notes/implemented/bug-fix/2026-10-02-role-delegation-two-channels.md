# Agent Note: Role delegation offers the host's two channels, not a job channel

Status: implemented

## Problem

`subagent_role` exposed three channels through one `run_in_background` parameter: omitting it returned a continuable child, `false` ran one foreground child, and `true` registered a tracked job through `ctx.get('jobs')` and returned a `jobId` for `job_output` and `job_kill`. The third channel never worked in this deployment.

It could not work as written. `executeAgentRole` passed `owner: parent` to `jobs.start`, but the host's `JobSpec.owner` is a `SessionId`, and every host caller passes `parent.id` or `owner.id`. The jobs registry resolves an owner through `agents.get(session)` and throws when that lookup misses, so the call failed with `session "[object Object]" has no live agent (background job owner must be live)`. The interface declared `owner?: unknown`, so the compiler could not catch the mismatch, and `tests/agent-role-router.test.ts` asserted `owner: parent` — the test pinned the defect instead of catching it. A second path failed earlier still: `ctx.get('jobs')` is undefined unless the deployment loads `@deepseek-ai/dsh-jobs` and `@deepseek-ai/dsh-tool-jobs`, and the package never declared them, so the call reported `background role jobs unavailable`.

The channel was also unreachable in practice. `run_in_background` is a host tool parameter name, and the host reads it as `request.run_in_background ?? options.continuable`. Under this deployment's `backgroundMode: continuable`, omitting the parameter and passing `true` take the same branch, so the host's own `subagent` never returns a job id here. Only this plugin's tool had a third branch, and the guidance published with the catalog described that branch in the host tool's parameter vocabulary. A parent that had learned "true means a tracked job collected with `job_output`" applied it to a host `subagent` call that returned a subagent id, and then collected a subagent id with `job_output`: the session logs contain `Error: unknown job <subagent-uuid>` in five sessions.

## Decision

`subagent_role` offers the host's two channels and states them the way the host states them. Omitting `run_in_background` returns `{ kind: 'continuable', subagentId }`; `false` runs one foreground child through the host's one-shot `start` and returns `{ kind: 'foreground', runId, output }`. A `true` value keeps the continuable default rather than selecting a channel, which is exactly the host's own reading under `backgroundMode: continuable`.

The job branch, `AgentRoleJob`, `AgentRoleJobs` and the `ctx.get('jobs')` read are deleted. The tool description's parameter text is the host's own sentence — "Defaults to true. Set false only when your next action depends on the result." — so both tools teach one rule.

The published guidance states the practice rather than explaining the parameter: leave `run_in_background` unset, and set it to `false` only when the next action depends on the result. It no longer describes a channel menu, names `job_output` or `job_kill`, or says which tool continues a running child, because those are other packages' contracts and the reachable tool of that name in this deployment is not the one the catalog described.

## Alternatives considered

**Fix the owner argument and keep the channel.** Rejected: passing `parent.id` repairs one defect and leaves a channel that only this plugin can reach, whose result is a job id that nothing else in the session's vocabulary addresses, and whose contract has to be re-stated in the catalog every step. The host decided its own delegation tool offers two channels under this deployment; a second implementation inventing a third is the drift this repository exists to remove.

**Keep the channel behind a declared `@deepseek-ai/dsh-jobs` dependency.** Rejected: the dependency would make the channel startable, but the guidance problem survives — one `run_in_background` name would still mean "job" for this tool and "durable child" for the host's, and the catalog is read while choosing between them.

**Keep the channel and drop it from the guidance.** Rejected: an undocumented third channel is worse than no channel, because the model's only route to it is guessing.

**Align on `one-shot` so `true` selects a real job for both tools.** Rejected by the deployment: `backgroundMode: continuable` is what keeps a role child durable across turns and reachable for a later instruction. Trading that for parity on a rarely used parameter would remove the continuation semantics the role feature is built on.

## Consequences

- The defect is gone by construction: no code path calls `jobs.start`, so no owner argument can be wrong. The test that asserted `owner: parent` is deleted with the branch it pinned.
- `subagent_role` and the host's `subagent` now answer `run_in_background` identically, so a rule learned on one tool holds on the other.
- A caller that wants a tracked job has no channel here. The host's `subagent` under a `one-shot` composition still offers one, and the general delegation path remains the documented route for work no role matches.
- The package no longer reaches a host seam it never declared, so `check:host-alignment` has one less undeclared dependency to reconcile.
- What is given up: the ability to fire a role child as a job and collect it with `job_kill`. Cancellation now goes through `interrupt_agent` on the durable child, which is the host's own path for continuable children.

## Testing

`tests/agent-role-router.test.ts` asserts the continuable request shape, the foreground path with its disposal and stop-reason mapping, the refusal cases, and the registered parameter surface with two result branches; the job-registration case and its cancellation assertions are deleted. `tests/subagent-catalog.test.ts` asserts the scheduling rule is stated as a practice, and that `job_output`, `job_kill` and the tracked-job phrasing appear nowhere in the published contract.

## Related decisions

Partially supersedes [the delegation contract ships with the role catalog](../architecture/2026-09-22-subagent-delegation-contract.md): where the operating contract lives, the fixed English text, the digest coverage and the general-channel fallback remain in force; the three-channel inventory and its `run_in_background` description do not. Supersedes the job channel in [agent role delegation over the host continuation seam](../architecture/2026-09-10-agent-role-delegation-via-host-continuation.md); its continuable delegation, exact-route rule and tool-filtering removal remain in force.
