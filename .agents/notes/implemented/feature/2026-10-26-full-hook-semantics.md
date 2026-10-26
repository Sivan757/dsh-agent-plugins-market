# Agent Note: Applied hook decisions and the events they cover

Status: implemented

## Problem

The market's hooks surface ran command hooks and threw away what they decided. `ExtensionHooks` decoded every matched hook through `@deepseek-ai/dsh-hook-protocol`, logged the fields it could not use, and mapped three outcomes: a deny, an ask, and an added context. A `continue: false` was recorded and the run continued. `systemMessage` was logged by nobody. A tool-input rewrite was warned about per hook and per event. Seven events ran, so a suite declaring `PostToolUseFailure`, `PreCompact` or `SessionEnd` read as an unsupported-event diagnostic while the reference tool would have run it.

The consequence is a class of suite that "works" and does nothing. The seven suites in the default catalog show it: hookify blocks with `permissionDecision: deny` and puts the rule text in `systemMessage`, with no `permissionDecisionReason`, so a user read `blocked by PreToolUse hook` instead of the rule. ralph-loop and hookify's Stop rules spend their reason on a continuation that the cap-less bridge could repeat forever. code-modernization and claude-security declare events this plugin rejected outright.

## Decision

Apply every decision the host extension points can express, and report the ones they cannot.

`packages/market-runtime/src/runtime/surfaces/extension-hooks.ts` now applies, per event:

- `PreToolUse` maps deny to `{ kind: 'deny', reason }`, ask to `{ kind: 'ask', reason, displayReason }`, and allow to a pre-approval: the hook allow replaces a downstream `ask` and never overrides a downstream `deny`, so a later policy keeps its veto. `additionalContext` reaches the next request through `agent.inject`, which is the logged inbox channel, and only for a call that proceeds.
- `PostToolUse` turns a block into corrective feedback, and a block after a failed call into context instead, because replacing a failure result would hide the failure.
- `UserPromptSubmit` rejects the step for a block, and folds `additionalContext` and plain stdout into the enter decision.
- `SessionStart` and `UserPromptSubmit` also read plain, non-JSON stdout as context, which is the reference rule for those two events.
- `Stop` steers the reason, or the context, as a continuation. `stop_hook_active` reports a forced continuation instead of the constant `false`, and eight consecutive continuations are the cap, matching the reference tool.
- `continue: false` cancels the run through `agent.cancel({ kind: 'hook', reason })`. `AgentCancelCause` in `@deepseek-ai/dsh-session` already has that arm, and the loop records the turn as `{ kind: 'aborted', reason: { kind: 'hook', reason } }`, so the halt is durable rather than a logged field.
- A blocking reason falls back through the reference's own channels in order: `permissionDecisionReason` (or a top-level reason, or exit-2 stderr), then `stopReason`, then `systemMessage`, then a stable sentence. hookify's shape now reaches the model with its rule text.

Three events join the set. `PostToolUseFailure` is `tools/post-execute` with `result.isError`, which is the whole difference between the two events. `PreCompact` is the `compaction/start` entry on `session/event`, with the trigger derived from a present `sourceCommandId`. `SessionEnd` runs from the bridge's own disposal, with the reference 1.5-second budget and `reason: other`, because the agent disposal payload carries no reason.

The support table in `packages/market-contracts/src/contracts/extension-presets.ts` stays the one home for what can run. The catalog validator now derives its admitted events from that table, and `packages/market-runtime/test/hook-event-coverage.test.ts` holds `HOOK_RUNTIME_POINTS` to the same table, so the validator, the runtime and the Hooks tab cannot disagree. `Notification` and `PermissionRequest` are `registered-only` in truth: nothing runs them, and their rows say so.

## Alternatives considered

- **Report a gap for every field instead of applying decisions.** Rejected: the host decision unions already carry deny, ask, allow, block, context and cancellation. The class doc admitted a limitation the seams no longer have.
- **Rewrite tool input inside the pre-execute listener.** Rejected as impossible, not as undesirable: `ToolExecution.arguments` is deep-frozen and the `tools/execute` wrapper may change only `exec.signal`. `PreToolDecision` in `@deepseek-ai/dsh-tools` has no rewrite arm and documents the exclusion. The field is reported with that symbol named.
- **Return `{ kind: 'allow' }` without calling `next()` for a hook allow.** Rejected: it would short-circuit every later `tools/pre-execute` listener, turning a suite hook into a permission bypass. Pre-approving only a downstream `ask` keeps the most-restrictive fold.
- **Inject `systemMessage` as model context.** Rejected: the reference field is user-visible text, and sending it to the model changes what the model decides. It stays a logged warning, and it is the block-reason fallback when the hook wrote nothing else.
- **Build a plugin-owned notice surface for `systemMessage`.** Deferred, not rejected: the client would need a session-scoped route, a store and a panel, and the market's own Hooks panel is sessionless. The reference page names that option so the next change starts from it.
- **Register our own `CompactionEngine` to veto compaction.** Rejected: it replaces the host engine, which is a takeover of host responsibility rather than a bridge.
- **Add the approval package for `PermissionRequest` and `Notification`.** Rejected: peers are not installed by a profile (see the hook-protocol self-provisioning note), so a peer import can lose every surface.
- **Keep `Notification` as `supported-partial`.** Rejected: no runtime code ran it, and a support tag that promises a bridge nobody shipped is the defect this change removes.

## Consequences

- A blocking hook now explains itself with its own text, so a user reads the rule instead of a generic sentence.
- A hook allow removes an approval prompt. A deployment with no approval service already degrades `ask` to deny, so allow changes nothing there.
- `continue: false` ends the run and clears pending input, which is what a halt means and what a suite asking for one expects.
- The Stop cap stops an unconditionally blocking hook after eight turns. A suite that wants an unbounded loop can no longer get one, which is the reference behavior.
- `PostToolUse` no longer runs for a failed call. A suite that relied on the old shared path must declare `PostToolUseFailure`, which is exactly what the reference protocol splits.
- `PreCompact` hooks run on a durable event the plugin does not produce. The host compaction package is not a dependency here, so the trigger read validates the payload as data and reports one it cannot read.
- `SessionEnd` runs during disposal, so it cannot append `hook/invoked` or `hook/result`: the protocol keeps that pair turn-enclosed and disposal happens outside any turn. Its outcomes are logged instead.
- Three reference fields remain unapplied, and each now names the host symbol that would have to change. docs/reference/hooks-event-coverage.md is the table.

## Testing

`packages/market-bundle/test/integration/extension-hooks.test.ts` covers each applied field against a fake shell: a hook allow pre-approving a downstream ask while a downstream deny survives, a deny whose reason comes from `systemMessage` alone, PreToolUse context reaching `agent.inject` only for a call that proceeds, `continue: false` arriving as `{ kind: 'hook' }` cancellation, exit 2 with stderr as the reason on the prompt, tool and stop points, plain stdout folded on the two events that document it, `PostToolUseFailure` keeping the failed result with its context, `PreCompact` on a compaction event with the missing veto reported, `SessionEnd` once from disposal, the eight-continuation cap with `stop_hook_active`, `updatedInput` reported and not applied, and the per-event timeout defaults.

`packages/market-runtime/test/hook-event-coverage.test.ts` holds the runtime point list to the support table. `packages/market-bundle/test/integration/project-hooks.test.ts` covers the validator admitting the new events and rejecting `PermissionRequest`. `packages/market-bundle/test/integration/extension-hooks-inventory.test.ts` covers the support verdicts the Hooks tab reads, and `hooks-overview-identity.test.ts` covers a partial event staying read-only beside a selectable one.
