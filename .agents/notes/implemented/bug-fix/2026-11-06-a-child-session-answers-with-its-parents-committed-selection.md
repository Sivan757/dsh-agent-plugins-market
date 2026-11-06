# Agent Note: a child session answers with its parent's committed selection

Status: implemented

## Problem

The per-agent tool gate denied every managed capability in an agent whose extension selection did not name them — and a child session's selection never named what its parent's committed selection granted. In a teammate or a subagent the model reported it could not find MCP, while the market panel showed every server connected. Measured before the fix: with the gate attached and a policy that answered false, the admitted set of a lead, a native teammate and a plain subagent each went from one root-registered probe tool to none of it.

Two causes stacked:

- A fresh child captured a selection out of nothing: the workspace default preset, the legacy workspace filters, or a default capture of the available rows. Nobody chooses a child session's resources, so the capture guessed, and the guess routinely missed the row the parent's own session granted.
- A child whose inventory had not landed yet denied like a withdrawn resource: \`denialReason\` only reported the transient \`extension-inventory-pending\` while the agent was marked stale, so the model was told the resource was gone and advised to ask the user to enable a resource the user had already enabled — advice that turns a moment of preparation into a permanent-looking absence.

## Decision

- **A child session's selection is its parent's committed selection.** \`initialSelection\` asks the agent's session header for \`parentSession\`, resolves that live agent, and answers its committed selection; the workspace capture runs only when there is no live parent or the parent has no selection of its own. The fork path already treated the parent's committed binding as the child's own — this extends that answer to a fresh child, whose plugin-spawned teammates all are.
- **A selection that has not published yet is its own denial reason.** \`ExtensionToolDenialReason\` grows \`extension-selection-pending\` beside \`extension-inventory-pending\`, with its own model-facing suffix: the session's resources are still being prepared, they return automatically, retry after a moment. The stale branch keeps the inventory text; the withdrawal text keeps advising the user, because there the resource really is gone.
- **The gate's mechanism is untouched.** It still restricts in the agent's own scope and guards execution; what changed is the answer the policy gives a child and the reason it states while preparation is pending.

## Supersession

No earlier note owns this decision: the gate's construction is recorded in the per-agent gate changes of 2026-10, and the fork inheritance was a property of the session state rather than a stated rule. This note is the first to state how a child answers.

## Alternatives considered

- **Exempt agents without a selection from the restriction.** Rejected: an ungoverned agent would see every managed tool the process ever mounted, including the rows its session never selected — the gate exists to answer per session, and this would answer per process.
- **Copy the parent's live selection continuously.** Rejected: the parent can change its preset mid-flight, and a child that follows it live has no stable authorization of its own; the committed selection at the moment the child attached is the grant the parent's session actually made.
- **Drop the gate for children entirely.** Rejected: it would re-expose the cross-session leak the gate was built to close — one session's catalog read must not decide another session's tools.
- **Seed from the parent's snapshot only when the child's inventory is pending.** Rejected: two authorization sources for one agent, and the denial reason still would not say which one answered.

## Consequences

- A teammate or a subagent sees the MCP tools, skills, commands and agents its parent's session granted, from its first turn, without a panel of its own.
- A child whose parent has no selection yet denies transiently with the new selection-pending reason instead of the withdrawal advice, so the model retries instead of asking the user to re-enable a resource that is enabled.
- A root session (no parent) keeps the workspace capture; nothing changes for the sessions a user opens directly.
- \`ExtensionToolDenialReason\` is exported, so a future surface can name the two transient causes without parsing suffix text.

## Verification

- \`packages/market-runtime/test/root-tool-visibility.test.ts\`: a root-registered probe claimed by the ownership map stays in the admitted set of a held teammate and a held subagent whose gate is attached with the runtime as policy; the parent's granted row appears in the child's own selection; the control with an allowing policy and the no-gate visibility matrix keep their earlier answers. The children are measured mid-turn on purpose: a settled run disposes the scope and releases the restriction with it.
- \`packages/market-bundle/test/integration/mcp-model-catalog-visibility.test.ts\`: a bridge-built tool reaches the model's own catalog chain (\`tools.resolve\` then \`systemPrompt.assemble\`) when the session allows it and leaves it when the session denies it.
