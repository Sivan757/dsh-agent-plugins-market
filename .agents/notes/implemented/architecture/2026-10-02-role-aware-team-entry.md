# Agent Note: Role-aware teammates over public host hooks

Status: implemented

## Problem

The Team profile replaces host subagent control tools. A standalone role child is not a Team member, so its UUID cannot be addressed by Team tools. Removing the role tool avoids that conflict but also removes role instructions and model selection. The user requires a plugin-owned enhanced creation tool, without modifying the host.

## Decision

In a Team deployment, `spawn_teammate_role` replaces `subagent_role`; native Team tools remain unchanged. The enhanced entry calls `agentTeams.spawnTeammate`. A uniquely named continuation provider contributes a fresh creation specification and associates its reserved child id with a call-local role snapshot. The awaited `agent/created` hook verifies the exact parent/member identity before applying scoped persona and `installModelSelection`. It never mutates parent options, patches host methods or creates a separate roster.

The validated role snapshot is stored in source metadata on a `teammate-role-binding` context message injected into the host inbox and flushed before initial task acceptance. The source records child id, role identity, instructions and effective route. Recovery observes the child-owned log through `sessionQuery`; inherited role bindings cannot become another member's role. A dedicated external event was rejected by the released persistence reader, and appending a user surface before the first system head made replay invalid; the inbox preserves both the known event envelope and correct message order.

Role discovery remains a compact durable catalog rather than a changing global tool schema. Its mode marker forces replacement when switching between standalone and Team mode, even for unchanged entries. Team guidance only helps choose a role after user-authorized Team work; it does not authorize spawning. Existing standalone catalog behavior remains outside Team deployments. Service presence, observed dynamically, selects the entry point because Team tools are registered later and per Agent scope. Independent coordination and Lead/member responsibilities are defined in [Team coordination separate from discovery](2026-10-05-team-coordination-separate-from-discovery.md).

## Installed reference evidence

Claude Code 2.1.284 (`/opt/homebrew/bin/claude`) exposes `subagent_type` and model override in its installed SDK declarations; its executable contains initial, added and removed agent-type announcements. Codex CLI 0.158.0 (`/opt/homebrew/bin/codex`) contains `Available roles:` and the explicit rule that agent-role guidance never authorizes spawning. These are installed-binary observations, not proof of every request assembly branch. They support keeping discoverability while separating role choice from creation authority.

## Alternatives considered

**Modify the host Team tool or request schema.** Rejected by the user. The published request does not forward persona or agentOptions, but public awaited Agent initialization, scoped system-prompt sections and model-selection listeners provide a plugin path.

**Keep a second child-management tool or shadow native names.** Rejected: a unique helper name would make detached children reachable but retain two incompatible management contracts; shadowing native names depends on load order and scope. Adding list/send/stop to the role tool has the same ownership problem.

**Keep standing down in Team deployments.** Rejected as the final product: role instructions and routes are the plugin's value. Two creation entry points may share one native Team roster and management API.

**Put roles into a mutable tool description or enumerate them in its schema.** Not selected: project roles vary by caller and change during a session. Existing catalog publication already handles changes, removals, restore and compaction without re-registering a global tool. Do not include an in-flight member roster in the role catalog; native Team listing owns that state.

**Put persona text in the task prompt or return extra fields from prepareContinuable.** Rejected: task text is not scoped persona, and the provider only returns fresh/fork data. Role composition uses explicit public Agent hooks instead.

## Consequences

- Role identity is reusable; Team member names are lifetime-unique and the native member limit still applies. Follow-up work should message existing members rather than repeatedly creating them.
- The enhanced entry always starts fresh and returns a native target plus effective route. It has no foreground/job channel or fork parameter. Native spawn_teammate stays available for ordinary members.
- Card edits affect new members only; recovery uses the creation snapshot. Plugin unload drains live role children before removing composition. Keep the plugin installed when resuming role members; the host does not independently reconstruct this plugin's role source.
- The rc.2 native roster is not a route readout: a member row uses the live Agent's model and falls back to the Lead's model once that member is inactive (`live?.options.model ?? root.options.model` in `list`). The enhanced tool result and the persisted request header identify the effective model; no native presentation is patched, so the documentation points operators at the tool result.
- Agent, Session, Subagent, system-prompt, Team and Session-query packages are declared peers with exact development mirrors. Team/query peers are optional; integration tests use published loop/testkit/persistence/native-Team packages. Their transitive native koffi build is disabled because these tests do not exercise desktop I/O. The alignment gate permits dev-only packages absent from production imports, but still checks their exact pins; tests prove importing one from src without a runtime declaration fails and repair does not promote test-only dependencies to consumer peers.

## Testing

Real published Team/AgentLoop/JSONL tests cover first-request role and route, an explicit call effort, native roster and messaging addressed by the member's own Session, cold resume across a complete Context restart, plugin replacement, a live member composed only by restore(), parallel snapshot isolation, initialization cancellation, direct-provider refusal, Lead-only and empty-prompt refusal, a seeded fork whose inherited binding belongs to its parent, late Team activation/removal and repeated compact initialization. Assertions on member traffic select requests by Session rather than array position, which is what keeps them independent of Lead scheduling. Catalog tests cover mode replacement and non-authorizing Team wording. Model adapters are in-memory: no paid provider calls or desktop profile restart is claimed. Each guarded behavior was confirmed by mutation: disabling the composition, the route, the binding filter, the restore, or either refusal fails the suite.

## Related decisions

Consolidates and supersedes the uncommitted one-delegation-surface-per-deployment note: namespace isolation, dynamic service detection and rejection of parallel management remain; disabling role capability does not. The old note's management alternatives are retained here. Extends [the role catalog contract](2026-09-22-subagent-delegation-contract.md) and preserves [standalone two-channel delegation](../bug-fix/2026-10-02-role-delegation-two-channels.md).
