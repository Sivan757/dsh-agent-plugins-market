# Hook event coverage

This page states which Claude Code hook events this plugin runs, what each one can do, and which reference fields have no host seam. It is the evidence behind the Hooks tab's support tag and behind the rejection diagnostics the catalog writes when a declaration names an event nobody can run.

Measured on 2026-10-26 against the installed host packages: `@deepseek-ai/dsh-agent` 0.2.1-rc.2, `dsh-tools` 0.2.1-rc.2, `dsh-session` 0.2.1-rc.2, `dsh-session-projection` 0.2.1-rc.2, `dsh-subagent` 0.2.1-rc.2, `dsh-hook-protocol` 0.2.0-rc.2. The runtime honors these limits as they are and never patches a host package.

## What runs

The runtime class is `packages/market-runtime/src/runtime/surfaces/extension-hooks.ts`. Its event list is exported as `HOOK_RUNTIME_POINTS`, and `packages/market-runtime/test/hook-event-coverage.test.ts` holds that list to `HOOK_EVENT_HOST_SUPPORT` in `packages/market-contracts/src/contracts/extension-presets.ts`. The catalog validator derives its admitted events from the same table, so a declaration either runs or is diagnosed. It is never registered in the belief that something will run it.

| Event | Host seam | Applied | Limits |
| --- | --- | --- | --- |
| `SessionStart` | `agent/created` source, run once per agent | `additionalContext` injected, plain stdout folded as context, `continue: false` halts | `initialUserMessage`, `sessionTitle`, `watchPaths`, `reloadSkills` and `CLAUDE_ENV_FILE` have no seam |
| `UserPromptSubmit` | `agent/pre-step` waterfall | `block`/`deny` rejects the step, `additionalContext` and plain stdout join it, 30-second default timeout, `continue: false` halts | `{ kind: 'reject' }` carries no reason field, so a blocked prompt's reason reaches the log, not the user |
| `PreToolUse` | `tools/pre-execute` waterfall | `deny`, `ask` with a bilingual approval prompt, `allow` as a pre-approval of a downstream `ask`, `additionalContext` queued for the next request, `continue: false` halts, exit 2 blocks with stderr as the reason | `updatedInput` and `defer` have no decision arm |
| `PostToolUse` | `tools/post-execute` waterfall after a successful call | `block` turns the reason into corrective feedback, `additionalContext` rides the next request | `updatedToolOutput` is not decoded by the shared codec, and `tool_response` is flattened to text |
| `PostToolUseFailure` | `tools/post-execute` when `result.isError` | `additionalContext` rides the next request, a blocking reason rides it too, `continue: false` halts | The failure is never replaced, so a hook cannot hide a failed call |
| `Stop` | `agent/turn-stopping` serial listener | `block` continues the turn with the reason, `additionalContext` continues as non-error feedback, `stop_hook_active` reports a forced continuation, eight consecutive continuations are the cap, `continue: false` halts | `last_assistant_message`, `background_tasks` and `session_crons` are not in the payload |
| `SubagentStart` | `subagent/start` emit | `additionalContext` injected into a live in-process child, `continue: false` cancels it | A remote child has no local target, and `agent_type` is the constant `general-purpose` |
| `SubagentStop` | `subagent/end` emit | The decoded outcome reaches the log | The end edge is emit-only, so a block cannot keep the child running and a halt cannot act on a child that already ended |
| `PreCompact` | `session/event` carrying `compaction/start` | Hooks run with the derived trigger (`manual` when a `sourceCommandId` is present, otherwise `auto`) | A block cannot veto a committed compaction |
| `SessionEnd` | Disposal of the agent-scoped bridge | Hooks run once with the reference 1.5-second budget | The reason vocabulary is `other` only, and output is discarded as the reference protocol specifies |

## Fields with no host seam

Each row names the symbol that would have to change. No row is applied approximately, and no row is reported as working.

| Reference field | What happens | Symbol that would have to change |
| --- | --- | --- |
| `PreToolUse.updatedInput` | Reported in the host log and not applied: the call runs with its original arguments | `PreToolDecision` in `@deepseek-ai/dsh-tools`, which documents that input rewriting is excluded because arguments are already logged and presented |
| `PreToolUse.permissionDecision: defer` | Rejected by the decoder, so no decision is applied | `PreToolDecision` in `@deepseek-ai/dsh-tools`; there is no pause-and-resume arm |
| `systemMessage` shown to the user | Recorded in the host log, and used as the block reason when the hook supplied none. No transcript channel exists, so the user reads it in the log | A user-facing notice service on the interception points. `MessageSource` in `@deepseek-ai/dsh-llm` describes model-visible messages only, so a plugin-side notice would be model-visible and diverge |
| `continue: false` | Applied through `agent.cancel({ kind: 'hook', reason })` on `AgentCancelCause` in `@deepseek-ai/dsh-session` | None: the host already models a hook-caused cancellation, and the turn records `{ kind: 'aborted', reason: { kind: 'hook', reason } }` |
| `UserPromptSubmit` block reason for the user | Logged, not shown | The `reject` arm of `PreStepDecision` in `@deepseek-ai/dsh-agent` carries no reason field |
| `PreCompact` veto | Reported as a limitation and not applied | A vetoable waterfall before `compactNow` or `compactIfNeeded` commits in the host compaction package |
| `Notification` | Not run: the event is rejected with a diagnostic | A notification channel plus the approval seam in `@deepseek-ai/dsh-user-approval`, which is not a declared dependency of this plugin |
| `PermissionRequest` | Not run: the event is rejected with a diagnostic | The `approval/request` waterfall in `@deepseek-ai/dsh-user-approval` |
| Every other reference event | Not run: the event is rejected with a diagnostic | Its own interception point |

## Failure containment

A hook that cannot be decoded, times out, is killed by cancellation, or answers for a different event contributes no decision. The point proceeds as if the hook had not run, and the outcome is recorded as a `hook/result` event with its exit code and bounded stderr. A malformed declaration is diagnosed by the catalog and skipped, so a suite never half-mounts. An executor rejection becomes an outcome with no exit code instead of an error that breaks the turn.

## Related

- [Hook support in your resources](../user/resources.md) carries the user-facing description.
- `.agents/notes/implemented/feature/2026-10-26-full-hook-semantics.md` records why the applied set stops where it does.
