# Agent Note: Team coordination separate from role discovery

Status: implemented

## Problem

Role-aware Team creation preserved persona and model routing, but its compact catalog retained mostly restrictions and API guidance. It did not assign the Lead responsibility for user clarification and direction, or explain how to delegate research before knowing its answer. A role catalog can also be empty, so it cannot be the only place that explains Team collaboration.

## Decision

`team-coordination.ts` contributes one dynamic `market:team-coordination` system section after the host Team policy. Each assembly resolves its exact live Agent through the registry and Team membership. Lead text covers authorized proactive delegation, self-contained research briefs, scope and dependency ownership, user corrections, member reuse, nonduplicated work and verified final delivery. Member text covers identity, target-based Lead/peer communication, bounded execution, decision escalation and evidence-based reporting. No scope, a stale/forged identity or a non-Team subagent renders no contribution.

The contribution needs only agents, agentTeams and systemPrompt; it is independent of role discovery, the agents resource filter and the enhanced creation dependencies. Native members and sessions with no role catalog receive the same coordination contract. The entry inject controls service arrival/removal; the prompt registry owns disposal. There is no per-Agent listener/map, timer, polling loop or new roster.

The role catalog owns names and entry selection, while tool descriptions own API and lifecycle semantics. A guidance fingerprint in its source metadata makes old catalogs refresh once on the next step after wording changes, independently of role-entry changes; it does not rewrite history. Enhanced member onboarding includes the actual Team name from membership and the readable catalog name from the call. Internal role identity remains in the unchanged durable snapshot schema. The short identity reminder appears both at creation and in the current system section deliberately: the former is a persistent task checkpoint; the latter also covers native members, old role bindings and fresh prompt assemblies after compaction. Workflow guidance has only the system-section home.

## Alternatives considered

- Extend the host policy or overwrite global AGENTS/memory: rejected; the user requires plugin-only changes. Existing authorization and additional approval rules remain authoritative, and the new section cannot grant permission itself.
- Put the full workflow back into the catalog: rejected; empty/filtered roles and native members would miss it. Repeating it in tool descriptions and user rules would create multiple competing copies.
- Install separate listeners and maps for each Agent: unnecessary; the published system-prompt section text callback receives the current assembly scope. Exact registry identity plus Team membership prevents a child from receiving retained Lead instructions.
- Rewrite third-party skill, role or MCP text: rejected; this manager transfers authored content in place. Shared project safety rules remain useful to both Lead and members.
- Treat a status wait as the result-delivery channel: rejected. The host delivers messages/settlement notices; progress updates are not final completion claims. Required member results must still be verified before final delivery.

## Consequences

The enhanced tool remains globally registered, with host-scoped restrictions on each non-Lead Agent so inherited visibility is denied too. Registration and restrictions are removed on plugin teardown; execution still checks Lead membership. Role matching is conditional on the catalog and enhanced tool being available; native creation remains the fallback, including fork. The Lead is not encouraged to select an unsuitable role merely for its model parameters. Blocking questions go to the Lead with a proposed next decision; unblocked work can continue. Overlapping assignments require an explicit handoff. These are model instructions, not locks or additional permissions.

System instructions add a small recurring contribution rather than repeated workflow catalog messages. Their wording is fixed English like the existing model-facing contracts. Role-card editing, routing precedence, persistence schema and native Team management are unchanged. Runtime module changes require the consuming host to reload; a build alone does not update an existing process.

## Testing

Real published AgentLoop, Team and prompt services cover existing/new Leads, native members without a role catalog, two independent Teams, empty/forged/non-Team scopes, repeated compact notifications, ordering after native policy and removal. A role-member test checks persona plus member-only coordination on first request and cold resume, preserving its creation message and durable identity. These tests assert actual assembled/request system content, not just registered strings. They do not establish an A/B improvement in autonomous model behavior.

## Related decisions

Partially extends [role-aware Team entry](2026-10-02-role-aware-team-entry.md): native Team ownership, model/persona composition and creation snapshots remain; the catalog no longer owns coordination guidance. Standalone subagent guidance remains unchanged.
