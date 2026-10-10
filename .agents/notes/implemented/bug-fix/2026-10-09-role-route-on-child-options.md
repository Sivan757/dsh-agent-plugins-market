# Agent Note: Role route on the child Agent options

Status: implemented

## Problem

A role member executes the route its card or call declares, but every host surface that reports a member's model reads the child Agent's own `AgentOptions`: the Team roster (`live?.options.model ?? root.options.model`), the image-input admission gate, and the member's own delegation inheritance. The host Team creation request carries no per-member route, so the child Agent starts with the Lead's route and those surfaces described the Lead's model while the member ran the role route. An idle member is worse: natural settlement releases its Agent, so the roster falls back to the Lead's model with no per-member value left to read.

## Decision

`TeammateRoleRuntime` writes the validated role route onto the member's own `AgentOptions` when it composes a member, and restores the inherited values when that composition is disposed. `installModelSelection` remains the request-time route owner; the options write keeps the host-facing reads (`TeamMemberView.model`, `assertImageCapable`, `parentAgentOptionsForDelegation`) equal to it for as long as the member is resident. A host that freezes the object is reported through the runtime diagnostic and keeps the model selection, so no request route depends on the write.

The idle case stays host-owned: once the member's Agent is released, `TeamMemberView.model` falls back to `root.options.model` and no plugin-visible value can correct it. [The agent-roles page](../../../../docs/user/agent-roles.md) directs route verification to the creation result instead of `list_agents`.

## Alternatives considered

**Carry the route through the model selection alone.** This was the previous state: requests routed correctly, while every host surface that reads `AgentOptions` kept reporting the Lead's route during a member turn and image admission was checked against the wrong model.

**Keep an idle member resident.** No public seam holds a continuable child open. Natural settlement disposes an idle activation, and defeating it with a pending inbox item or a dummy owned child would leak one Agent per member.

**Shadow `list_agents` with a plugin tool.** The host registers the Team tools in the Lead's Agent scope, so a wider-scope registration is shadowed, and duplicating the host management surface was already rejected in [the role entry note](../architecture/2026-10-02-role-aware-team-entry.md).

**Have the host carry a per-member route.** That remains the complete fix for the idle readout, and it is out of scope for this change at the user's direction.

## Consequences

- The roster row, the image-input gate and a member's own delegation agree with the executed route while the member is resident. The plugin writes a field the host type marks `readonly`; the diagnostic covers a host that makes it non-writable.
- An idle member still shows the Lead's route in the roster. Route verification belongs to the creation result.
- The role binding is unchanged: the durable creation snapshot still owns the route across cold resume and plugin reload, and `restore()` re-applies the selection and the options write together.

## Testing

`tests/teammate-role.test.ts` pins the live roster row and the member's own options, the `restore()` path, and the frozen-options degradation, where the request still uses the role model. Confirmed by mutation: disabling the options write fails the roster and restore assertions.
