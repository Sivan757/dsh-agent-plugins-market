# Agent Note: Compose one role child's instructions from the plugin

Status: implemented

## Problem

The `subagent_role` tool promises that the role's own instructions apply. The plugin sent them in the subagent start request as `persona: policy.content`, and host 0.2.0-rc.2 honored that field.

Host 0.2.1 removed `persona` from `SubagentStartRequest` and started rejecting it for the host's own tool. The plugin kept sending the field, the host silently dropped it, and every role child on the installed host ran without the card body while the tool reported success. A role child still reached the catalog and the route, so the failure produced confident output under a role name with no role instructions and no diagnostic. The plugin's own tests pinned the broken behavior: they asserted that the request carried `persona`, which no host on the installed line reads.

The plugin already composes role instructions for role teammates with a scoped prompt section and a durable creation snapshot. Role children had no equivalent after the host removed the field.

## Decision

`packages/market-runtime/src/runtime/agents/role-composition.ts` owns one role child's instructions.

- The child identity is minted with `SessionId(randomUUID())` from the existing `@deepseek-ai/dsh-session` peer and passed into the start input, so the plugin can compose the exact child before the host publishes it.
- One mechanism applies per host line, and the seam decides which. The member spelling is the discriminator: while `startContinuable` exists the host still honors the request `persona`, so the request carries it and the plugin installs no section. From `0.2.1-alpha.2` on, the request carries no `persona` and the plugin installs `deployment:persona-prefix` with `interpolate: false` through the child's own `systemPrompt`.
- The section is installed on `agent/created`, which the host awaits before it delivers the first prompt, so the first model request already carries the card body.
- Creation records one plugin-owned context message carrying the role identity and the card body, and `ctx.sessions.flush` must return true. A later resume reads that record and installs the section again without appending a second message.
- The channel fails closed in five places, and every refusal names the role. A missing persistence service rejects before a child exists. A host with no mounted composition rejects before the start call, because the composition is a required field on the host contract and the executor refuses again for a host built through a cast. A section that cannot be installed, or a binding that cannot be committed, rejects the creation, and the host rolls the child back. A host that publishes an identity other than the reserved one is refused, because the composition is keyed by that id; the continuable channel then releases the uncomposed child through the seam's drain member so it does not stay resident without instructions.
- `applyRoleRoute` and `installPersonaSection` moved into this module, so the role teammate path and the role child path share one writer for each fact.

The mount subscribes when the role tool mounts. `systemPrompt` joined its inject list, while `sessions` and `sessionQuery` stay optional reads: `sessionQuery` is an optional host peer, and a hard requirement would keep the whole role tool from mounting on a host that lacks it.

## Alternatives considered

- **Register one Agent Preset per role card.** Rejected on semantics. `agentPreset` is absent before 0.2.1-alpha.3, so the floor host needs a second branch anyway, and a preset must be loader-resolvable because registration mounts a plugin tree. The role-card path must work without loader entries.
- **Prepend the card body to the prompt.** Rejected. The content becomes a user message, loses system-prompt authority, competes with the task text, and survives compaction differently.
- **Keep the request `persona` field and cast it.** Rejected. The host copies only known fields, so the field is inert on the installed line; a cast would hide the silent loss instead of restoring the behavior.
- **Repair only the foreground crash and leave the instruction gap documented.** Rejected. A child that runs without its instructions produces wrong output under a role name, which is worse than the crash the issue reported.

## Consequences

- Every role child on both host lines receives the card body, and the tool's stated contract holds again.
- A role child now needs session persistence on both channels. `delivery: 'caller'` made persistence optional for the host, but the durable binding makes it required for the plugin, and a host without it refuses the call by name.
- A child created before a host upgrade keeps running. The 0.2.0 line recorded the request `persona` in the child's descriptor, and the 0.2.1 host re-applies that descriptor persona into the child's own layer on resume, which is the same layer this module registers in. The composition recognises the collision and compares the slot to the card body, in meaning rather than in raw text: identical text renders as already applied only when the slot also preserves the text literally — the host applies its copy with no `interpolate` flag, so a card body containing template braces would be substituted or fail to render under that copy. A slot that is not identical in both respects refuses, and the refusal names the older host line, the slot, and whether the text differed or its rendering did, so the cause is legible.
- A deployed agent preset that carries persona does not displace the card body, because the two registrations land in different layers. `applyChildComposition` binds a child under its preset's generation scope, so a preset's `deployment:persona-prefix` sits in that inherited layer, while this module registers through `agent.ctx`, which is the child's own scope. Scoped sections shadow an inherited section of the same name instead of colliding with it, so the card body wins. That is the precedence the host documents for a child composition ("shadowing the deployment's" persona). The real-host test asserts the card body reaches the child's first system prompt, and the negative test proves the collision mechanism that fires when two registrations share one layer.
- `docs/user/agent-roles.md` and its Chinese pair state the composition and the resume behavior. The tool description needed no text change: its statement that the role instructions apply became true again.
- `packages/market-runtime/test/role-composition.test.ts` drives the published host packages end to end. It covers the first system prompt, the fail-closed section install, the unpersisted binding, the absent persistence service, and a full context restart with exactly one binding record.
