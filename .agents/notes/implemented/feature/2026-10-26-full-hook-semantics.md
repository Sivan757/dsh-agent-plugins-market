# Agent Note: Applied hook decisions and the events they cover

Status: implemented

## Problem

The market's hooks surface ran command hooks and threw away what they decided. `ExtensionHooks` decoded every matched hook through `@deepseek-ai/dsh-hook-protocol`, logged the fields it could not use, and mapped three outcomes: a deny, an ask, and an added context. A `continue: false` was recorded and the run continued. `systemMessage` was logged by nobody. A tool-input rewrite was warned about per hook and per event. Seven events ran, so a suite declaring `PostToolUseFailure`, `PreCompact` or `SessionEnd` read as an unsupported-event diagnostic while the reference tool would have run it.

The consequence is a class of suite that "works" and does nothing. The seven suites in the default catalog show it: hookify blocks with `permissionDecision: deny` and puts the rule text in `systemMessage`, with no `permissionDecisionReason`, so a user read `blocked by PreToolUse hook` instead of the rule. ralph-loop and hookify's Stop rules spend their reason on a continuation that the cap-less bridge could repeat forever. code-modernization and claude-security declare events this plugin rejected outright.

## Decision

Apply every decision the host extension points can express, and report the ones they cannot.

`packages/market-runtime/src/runtime/surfaces/extension-hooks.ts` now applies, per event:

- `PreToolUse` maps deny to `{ kind: 'deny', reason }`, ask to `{ kind: 'ask', reason, displayReason }`, and allow to a pre-approval: the hook allow replaces a downstream `ask` and never overrides a downstream `deny`, so a later policy keeps its veto. `additionalContext` reaches the next request through `agent.inject`, which is the logged inbox channel, and only for a call that proceeds.
- `PostToolUse` turns a block into corrective feedback. A block after a failed call rides the next request as context instead, because replacing a failure result would hide the failure.
- `PostToolUseFailure` is the failure event. A suite that declares a matching group for the tool gets the reference split. A suite that declares only `PostToolUse` keeps that hook running for failed calls, and the first such run per suite writes one host log line naming the event to declare. Both events track an execution, not a waterfall visit: a result carrying `ABORTED`, `ABORTED_BEFORE_DISPATCH`, `UNKNOWN_TOOL` or `INVALID_ARGS` fires neither, because the tool body never ran.
- `UserPromptSubmit` rejects the step for a block, and folds `additionalContext` and plain stdout into the enter decision.
- `SessionStart` and `UserPromptSubmit` also read plain, non-JSON stdout as context, which is the reference rule for those two events.
- `Stop` steers the reason, or the context, as a continuation. `stop_hook_active` reports a forced continuation instead of the constant `false`, and eight consecutive continuations are the cap, matching the reference tool.
- `continue: false` cancels the run through `agent.cancel({ kind: 'hook', reason })`. `AgentCancelCause` in `@deepseek-ai/dsh-session` already has that arm, and the loop records the turn as `{ kind: 'aborted', reason: { kind: 'hook', reason } }`, so the halt is durable rather than a logged field.
- A blocking reason falls back through the reference's own channels in order: `permissionDecisionReason` (or a top-level reason, or exit-2 stderr), then `stopReason`, then `systemMessage`, then a stable sentence. hookify's shape now reaches the model with its rule text.

Three events join the set. `PostToolUseFailure` is `tools/post-execute` with `result.isError`; the two tool events share one listener and differ in which declaration they serve. `PreCompact` is the `compaction/start` entry on `session/event`, with the trigger derived from a present `sourceCommandId`. `SessionEnd` runs from the bridge's own disposal, with the reference 1.5-second budget and `reason: other`, because the agent disposal payload carries no reason.

The support table in `packages/market-contracts/src/contracts/extension-presets.ts` stays the one home for what can run. The catalog validator now derives its admitted events from that table, and `packages/market-runtime/test/hook-event-coverage.test.ts` holds `HOOK_RUNTIME_POINTS` to the same table, so the validator, the runtime and the Hooks tab cannot disagree. `Notification` and `PermissionRequest` are `registered-only` in truth: nothing runs them, and their rows say so.

## Compatibility

The event split is the one behavior change an installed suite can feel, and it is scoped so that no suite in the default catalog changes behavior silently.

Two suites declare `PostToolUse` and no `PostToolUseFailure`, so neither can be edited from this repository:

- **`hookify`** declares `PostToolUse` with no matcher, so the hook covers every tool. Its rules read `tool_name` and `tool_input`, which exist on a failed call, so a rule about an attempted write still fires.
- **`security-guidance`** declares `PostToolUse` on `Edit|Write|MultiEdit|NotebookEdit` and on `Bash`. What stops running under a bare reference split is its failed-edit branch (`security_reminder_hook.py`, the `tool_response.get("error")` early return) and its `Bash` commit-review read of `tool_response` stdout, stderr, exit code and `interrupted` (the same file, around lines 1402 to 1423).

Both keep working. The reason they do is an ordering rule inside the owner, not a property of the bridge: `ScopedExtensionContributors` disposes the hook bridge while the mount's grant is still open, on both teardown paths. `SessionEnd` is the one event that runs from disposal and it reaches every suite through a closure that reads that grant, so closing the flag first runs the event against nothing while the Hooks tab still advertises it. `packages/market-bundle/test/integration/extension-hooks-session-end-ordering.test.ts` pins both paths. Because neither declares a matching failure group, their `PostToolUse` hooks still run for failed calls through the compatibility pass, with the payload they already received. Declaring `PostToolUseFailure` is how a suite opts into the reference split, and it is also how the compatibility line stops. One host log line per suite names that event, so the divergence is visible instead of silent.

Three other suites are unaffected: `learning-output-style` and `explanatory-output-style` declare `SessionStart` only, and `ralph-loop` declares `Stop` only. `code-modernization` declares `PostToolUseFailure` alone, and `claude-security` declares both events, so its failure reviews take the reference path and never run twice.

`docs/reference/hooks-event-coverage.md` publishes the rule and the two suites. `docs/user/resources.md` states it for a user.

## The one divergence that stays

A denial from another `tools/pre-execute` listener, including this plugin's own `PreToolUse` hook, reaches `tools/post-execute` as an ordinary failed result. `PreToolDecision.deny` in `@deepseek-ai/dsh-tools` carries an optional `info`, and the registry sets `error.info` only when the denying decision supplied one, so a policy denial and a tool that ran and failed are indistinguishable at that point. `PostToolUseFailure` therefore fires for a denied call.

The other three non-executions do have codes and are excluded: a cancellation before dispatch, a cancellation during dispatch, an unknown tool, and rejected arguments.

Guessing the marker from the denial message is not acceptable here: the message is authored text, and a suite would silently stop firing on a wording change. The follow-up is a host change, stated for an upstream proposal:

- Add a stable failure code to the result a policy denial produces, beside `UNKNOWN_TOOL` and `ABORTED_BEFORE_DISPATCH`. With one, this bridge adds it to the exclusion set and the divergence closes.

## Alternatives considered

- **Report a gap for every field instead of applying decisions.** Rejected: the host decision unions already carry deny, ask, allow, block, context and cancellation. The class doc admitted a limitation the seams no longer have.
- **Rewrite tool input inside the pre-execute listener.** Rejected as impossible, not as undesirable: `ToolExecution.arguments` is deep-frozen and the `tools/execute` wrapper may change only `exec.signal`. `PreToolDecision` in `@deepseek-ai/dsh-tools` has no rewrite arm and documents the exclusion. The field is reported with that symbol named.
- **Return `{ kind: 'allow' }` without calling `next()` for a hook allow.** Rejected: it would short-circuit every later `tools/pre-execute` listener, turning a suite hook into a permission bypass. Pre-approving only a downstream `ask` keeps the most-restrictive fold.
- **Inject `systemMessage` as model context.** Rejected: the reference field is user-visible text, and sending it to the model changes what the model decides. It stays a logged warning, and it is the block-reason fallback when the hook wrote nothing else.
- **Build a plugin-owned notice surface for `systemMessage`.** Deferred, not rejected: the client would need a session-scoped route, a store and a panel, and the market's own Hooks panel is sessionless. The reference page names that option so the next change starts from it.
- **Register our own `CompactionEngine` to veto compaction.** Rejected: it replaces the host engine, which is a takeover of host responsibility rather than a bridge.
- **Add the approval package for `PermissionRequest` and `Notification`.** Rejected: peers are not installed by a profile (see the hook-protocol self-provisioning note), so a peer import can lose every surface.
- **Keep `PostToolUse` firing for failures and never add the failure event.** Rejected: it is the pre-split behavior this change exists to replace, it makes `PostToolUseFailure` impossible to serve, and a suite cannot express "I handle failures differently" at all.
- **Fire `PostToolUse` for every failed call, unconditionally, beside `PostToolUseFailure`.** Rejected as the shipped rule because a suite that declares both events, like `claude-security`, would run two hook chains for one failed call and double whatever the hook reports. The shipped rule keeps the compatibility run only where the suite declares no matching failure group, which is exactly the set that would otherwise break.
- **Keep `Notification` as `supported-partial`.** Rejected: no runtime code ran it, and a support tag that promises a bridge nobody shipped is the defect this change removes.

## Consequences

- A blocking hook now explains itself with its own text, so a user reads the rule instead of a generic sentence.
- A hook allow removes an approval prompt. A deployment with no approval service already degrades `ask` to deny, so allow changes nothing there.
- `continue: false` ends the run and clears pending input, which is what a halt means and what a suite asking for one expects.
- The Stop cap stops an unconditionally blocking hook after eight turns. A suite that wants an unbounded loop can no longer get one, which is the reference behavior.
- `PostToolUse` and `PostToolUseFailure` are separate events. A suite that declares a failure group gets the reference split and pays one hook chain per failed call instead of two, while a suite that declares only `PostToolUse` keeps the older superset until it opts in.
- `PreCompact` hooks run on a durable event the plugin does not produce. The host compaction package is not a dependency here, so the trigger read validates the payload as data and reports one it cannot read.
- `SessionEnd` runs during disposal, so it cannot append `hook/invoked` or `hook/result`: the protocol keeps that pair turn-enclosed and disposal happens outside any turn. Its outcomes are logged instead.
- Three reference fields remain unapplied, and each now names the host symbol that would have to change. docs/reference/hooks-event-coverage.md is the table.

## Testing

`packages/market-bundle/test/integration/extension-hooks.test.ts` covers each applied field against a fake shell: a hook allow pre-approving a downstream ask while a downstream deny survives, a deny whose reason comes from `systemMessage` alone, PreToolUse context reaching `agent.inject` only for a call that proceeds, `continue: false` arriving as `{ kind: 'hook' }` cancellation, exit 2 with stderr as the reason on the prompt, tool and stop points, plain stdout folded on the two events that document it, `PostToolUseFailure` keeping the failed result with its context, a suite that declares only `PostToolUse` still seeing a failed call with one compatibility notice and no repeat on the second failure, and the fallback stopping for a tool a suite routes to the failure event, `PreCompact` on a compaction event with the missing veto reported, `SessionEnd` once from disposal, the eight-continuation cap with `stop_hook_active`, `updatedInput` reported and not applied, and the per-event timeout defaults.

`packages/market-bundle/test/integration/extension-hooks-session-end-ordering.test.ts` runs the real bridge over a fake scope and asserts the closing event still fires, on both the owner-dispose and the fiber-unwind paths. `packages/market-bundle/test/integration/extension-tool-event-execution.test.ts` covers the four excluded codes and the code-less real failure. `packages/market-runtime/test/hook-event-coverage.test.ts` holds the runtime point list to the support table. `packages/market-bundle/test/integration/project-hooks.test.ts` covers the validator admitting the new events and rejecting `PermissionRequest`. `packages/market-bundle/test/integration/extension-hooks-inventory.test.ts` covers the support verdicts the Hooks tab reads, and `hooks-overview-identity.test.ts` covers a partial event staying read-only beside a selectable one.
