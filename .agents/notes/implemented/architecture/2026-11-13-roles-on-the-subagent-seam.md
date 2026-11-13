# Agent Note: Roles ride the subagent seam, not Team

Status: implemented

## Problem

The host's 0.2.2-rc.2 line removed the Agent Teams member API. `ctx.agentTeams` keeps its name but publishes task-graph operations only: `isEnabled`, `setEnabled`, `createTask`, `getTask`, `listTasks` and `updateTask`. Creation, messaging, interruption, roster, membership and wait moved to the ordinary subagent controls, because the host now derives the Team from the subagent tree.

The role layer was built on the removed API. A seat withdrew `subagent_role` whenever the `agentTeams` service existed, `spawn_teammate_role` created members through it, and a coordination system section read membership at every prompt assembly. On the new host the seat saw the service and withdrew the working surface, while the Team-built surface could not mount: role delegation disappeared, and with it the `subagent-catalog`.

## Decision

Delete the Team integration and keep one role surface over the host's own subagent seam.

`subagent_role` mounts whenever tools, LLM, subagents, agents and the system-prompt service are available. No seat observes another service, and the catalog publishes from the same mount. `spawn_teammate_role`, its runtime, the coordination section and the seat are deleted, together with their tests. The plugin declares no Team package: nothing here mounts Team, and the host's own bundle supplies the task board and the `team:policy` section.

A role child needs no Team-specific creation path. The host derives membership from the subagent tree, so a child started through `ctx.subagents` is a Team member wherever collaboration is enabled, with the standard messaging, interruption, navigation and task tools.

The activation seam now passes the child request flattened into the host's `SubagentActivationSpec` instead of nesting it under `request`, and returns the activation handle. The nested shape was latent: the seam typed that member loosely, so the call built a spec the host rejects for a missing `parent` and `prompt`. The handle is also the per-child release on this line, because the service's `drainDescendants` closes whole trees; `drainChildren` and `drainContinuableChildren` remain for older lines.

## Supersession

Archived: [the role-aware Team entry](../archived/architecture/2026-10-02-role-aware-team-entry.md) and [the separate Team coordination section](../archived/architecture/2026-10-05-team-coordination-separate-from-discovery.md). Their replacement is this decision plus the host's own Team policy.

[Role delegation through host continuation](2026-09-10-agent-role-delegation-via-host-continuation.md) remains active and still owns the composition channel, the durable binding and the refusal behavior.

## Alternatives considered

**Keep the seat and test the member API.** That was the first pass. It kept the crash out of prompt assembly, but it also withdrew the working surface from every deployment whose `agentTeams` service exists, which on this host line is all of them. Rejected: the role surface follows the delegation seam, not a service's presence.

**Rebuild the enhanced entry on the new Team service.** That service has no member API, so an entry built on it would duplicate `subagent_role`. Team owns tasks; the subagent seam owns children.

**Declare `@deepseek-ai/dsh-agent-team` to stay Team-aware.** No module here calls it. An unused host declaration weakens the alignment gate that exists to make declarations meaningful.

**Keep the coordination section.** The host publishes its own `team:policy` section in every Team-enabled request, so a second section restates the same rules in the same context.

## Consequences

Role delegation and the catalog work on the baseline host line and on every line the seam still supports. Collaboration belongs to the host: task board, messaging, interruption, member navigation and shared tasks. The plugin loses a Team-specific creation entry and the member-only catalog mode; `subagent_role` is the only creation path and its catalog is the only catalog.

The seam now types the activation member as the host declares it, which is the point: a release that renames a field fails typecheck instead of a user session.

## Verification

`pnpm run typecheck`, `pnpm run lint` and the full `pnpm run test` pass. Real-host tests cover the flattened activation spec (a start publishes the reserved identity, and its handle releases exactly that child), the catalog's first publication and replacement, and role composition through the prompt-section channel. `pnpm run check:host-alignment` reports every declared host package matching 0.2.2-rc.2.
