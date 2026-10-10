# Claude Code hooks full-support gap analysis

> 2026-10-07 · Scratch research for the presets team. The question: the host does not fully support Claude Code hooks, so assess whether and how this plugin can provide full support. Host evidence comes from the deepseek-harness checkout at `~/workspace/deepseek-harness` (last commit `c55d6205ff`, 2026-10-04) and from the packages installed under `node_modules`. Specification evidence comes from the official Claude Code hooks reference. This document changes no source. It proposes no host edit as our implementation. Work that only the host can do is flagged for an upstream proposal.

## Scope and method

The analysis covers the ten events named in the task: SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop, SubagentStart, SubagentStop, and PreCompact. The official reference documents 33 event sections in total as of 2026-10-07, from Setup through ElicitationResult ([hook events](https://code.claude.com/docs/en/hooks#hook-events)). The host bridge README counted 30 at its writing, so the reference grew since (the Known Limitations section of `packages/hooks/hooks-claude-code/README.md` in the harness checkout).

Evidence classes stay separate:

- Specification claims cite the official documentation at https://code.claude.com/docs/en/hooks (read 2026-10-07), with section anchors.
- Host claims cite file:line. Paths under `packages/` are relative to `~/workspace/deepseek-harness`. Paths under `src/` are relative to this repository. Claims about installed packages cite the pnpm store path under `node_modules/.pnpm/`.

Estimates use one scale, defined once: S means one to two days, M means three to five days, L means more than one week, for one engineer who knows both codebases.

## What the official specification says

### Event cadence and wire contract

Events fall into three cadences: per session (SessionStart, SessionEnd), per turn (UserPromptSubmit, Stop, StopFailure), and per tool call (PreToolUse, PostToolUse) ([hook lifecycle](https://code.claude.com/docs/en/hooks#hook-lifecycle)). A command hook receives the event as JSON on stdin. Common input fields are `session_id`, `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode`, `effort`, and `hook_event_name` ([common input fields](https://code.claude.com/docs/en/hooks#common-input-fields)).

Exit codes ([exit code output](https://code.claude.com/docs/en/hooks#exit-code-output)):

- Exit 0 passes. Stdout that starts with `{` and ends with `}` parses as JSON. Other stdout is plain text. Plain text becomes model context on UserPromptSubmit, UserPromptExpansion, SessionStart, and PostModelSwitch only.
- Exit 2 is a blocking error. Stderr becomes the blocking reason. JSON on stdout cannot override the block.
- Any other exit code is a non-blocking error. The action proceeds. The transcript shows a hook error notice with the first stderr line.

JSON output ([json output](https://code.claude.com/docs/en/hooks#json-output)) carries universal fields: `continue` (`false` halts the run and takes precedence over event decisions), `stopReason`, `systemMessage` (a user-visible warning), and `terminalSequence` (an allowlisted terminal escape). Event-specific fields live under `hookSpecificOutput`, keyed by `hookEventName`. Each of these strings caps at 10,000 characters.

Timeout defaults ([common fields](https://code.claude.com/docs/en/hooks#common-fields)): 600 seconds for `command`, `http`, and `mcp_tool` handlers, 30 for `prompt`, 60 for `agent`. UserPromptSubmit, PreModelSwitch, and PostModelSwitch lower the command default to 30 seconds. SessionEnd shares a 1.5-second budget, raisable to 60.

### Configuration sources and path variables

Hook configuration merges additively across `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, managed policy settings, plugin `hooks/hooks.json`, skill frontmatter, and subagent frontmatter ([hook locations](https://code.claude.com/docs/en/hooks#hook-locations)). Handler types are `command`, `http`, `mcp_tool`, `prompt`, and `agent` ([hook handler fields](https://code.claude.com/docs/en/hooks#hook-handler-fields)). The placeholders `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, and `${CLAUDE_PLUGIN_DATA}` substitute into command strings and are exported as environment variables on the spawned process ([reference scripts by path](https://code.claude.com/docs/en/hooks#reference-scripts-by-path)).

### In-scope event semantics

| Event | Fires | Matcher subject | Extra input fields | Decision control |
| --- | --- | --- | --- | --- |
| SessionStart | Session start or resume | Source: `startup`, `resume`, `clear`, `compact`, `fork` | `source`, `model`, `agent_type`, `session_title`, resume-cost fields | `additionalContext`, `initialUserMessage`, `sessionTitle`, `watchPaths`, `reloadSkills`, `CLAUDE_ENV_FILE` |
| SessionEnd | Session end | Reason: `clear`, `resume`, `logout`, `prompt_input_exit`, `other` | `reason` | None. Output is discarded. 1.5-second budget |
| UserPromptSubmit | Prompt submitted, before processing | None | `prompt`, `session_title` | `decision: "block"` stops the prompt, `reason` shows to the user, `additionalContext`, `suppressOriginalPrompt`. 30-second default |
| PreToolUse | After parameters, before the call | Tool name | `tool_name`, `tool_input`, `tool_use_id`, `mcp_server` | `permissionDecision` `allow`/`deny`/`ask`/`defer`, `permissionDecisionReason`, `updatedInput`, `additionalContext`. Precedence `deny` > `defer` > `ask` > `allow`. Exit 2 equals deny |
| PostToolUse | After a tool succeeds | Tool name | `tool_input`, `tool_response`, `duration_ms` | `decision: "block"` adds `reason` beside the result, `additionalContext`, `updatedToolOutput`, `classifierContext` |
| Notification | Claude Code sends a notification | Type: `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_*`, `agent_needs_input`, `agent_completed`, `quota_auto_resume_*` | `message`, `title`, `notification_type` | None. `systemMessage` and `continue` are discarded. `terminalSequence` works |
| Stop | Main agent finished responding | None | `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons` | `decision: "block"` with required `reason` forces continuation. `additionalContext` continues as non-error feedback. 8-consecutive-continuation cap |
| SubagentStart | Subagent spawn, resume, or teammate message | Agent type name | `agent_id`, `agent_type` | Cannot block. `additionalContext` injects at the subagent start |
| SubagentStop | Subagent finished | Agent type name | `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, `background_tasks`, `session_crons` | Same as Stop: block keeps the subagent running and delivers `reason` as its next instruction |
| PreCompact | Before compaction | Trigger: `manual`, `auto` | `trigger`, `custom_instructions` | Exit 2 or `decision: "block"` blocks compaction. `systemMessage` and `continue` are discarded |

Sources: [SessionStart](https://code.claude.com/docs/en/hooks#sessionstart), [SessionEnd](https://code.claude.com/docs/en/hooks#sessionend), [UserPromptSubmit](https://code.claude.com/docs/en/hooks#userpromptsubmit), [PreToolUse](https://code.claude.com/docs/en/hooks#pretooluse), [PostToolUse](https://code.claude.com/docs/en/hooks#posttooluse), [Notification](https://code.claude.com/docs/en/hooks#notification), [Stop](https://code.claude.com/docs/en/hooks#stop), [SubagentStart](https://code.claude.com/docs/en/hooks#subagentstart), [SubagentStop](https://code.claude.com/docs/en/hooks#subagentstop), [PreCompact](https://code.claude.com/docs/en/hooks#precompact).

## Host coverage today

### Packages studied

| Package                              | Version    | Checkout path                      | Installed                                                             |
| ------------------------------------ | ---------- | ---------------------------------- | --------------------------------------------------------------------- |
| `@deepseek-ai/dsh-hook-protocol`     | 0.2.0-rc.2 | `packages/hooks/hook-protocol`     | `node_modules/.pnpm/@deepseek-ai+dsh-hook-protocol@0.2.0-rc.2_*/`     |
| `@deepseek-ai/dsh-hooks-claude-code` | 0.2.0-rc.2 | `packages/hooks/hooks-claude-code` | `node_modules/.pnpm/@deepseek-ai+dsh-hooks-claude-code@0.2.0-rc.2_*/` |

Correction to the task premise: the supported event list holds seven events, not six. `CLAUDE_EVENTS` in the checkout lists SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart, and SubagentStop (`packages/hooks/hooks-claude-code/src/config.ts:11-19`). The installed bundle carries the same seven (`lib/index.js` inside the pnpm store path above, `CLAUDE_EVENTS` array). SubagentStart is easy to miss because it shares the `subagent/start` listener with SubagentStop (`packages/hooks/hooks-claude-code/src/index.ts:287-301`).

### Supported events and decision mapping

The host bridge registers one listener per interception point and injects `shell` and `sessionProjections` (`packages/hooks/hooks-claude-code/src/index.ts:48`):

- SessionStart: `agent/created` runs SessionStart with the source from `SessionStartSource`, which is `startup`, `resume`, `clear`, or `compact` (`packages/hooks/hooks-claude-code/src/index.ts:209-221`; `packages/core/agent/src/runtime-types.ts:125`). `additionalContext` is injected into the agent. The matcher on source is honored because the parser discards matchers only for UserPromptSubmit and Stop (`packages/hooks/hooks-claude-code/src/config.ts:109-111`).
- UserPromptSubmit: `agent/pre-step` maps a deny decision to `{ kind: 'reject' }` and appends `additionalContext` to an enter decision (`packages/hooks/hooks-claude-code/src/index.ts:225-241`). The reject arm of `PreStepDecision` carries no reason field, so the block reason cannot reach the user (`packages/core/agent/src/runtime-types.ts:112-119`).
- PreToolUse: `tools/pre-execute` maps deny to `{ kind: 'deny', reason }` and ask to `{ kind: 'ask', reason }` (`packages/hooks/hooks-claude-code/src/index.ts:244-250`). An allow decision delegates through `next()`, so it does not pre-approve. The decision union has no input-rewrite arm by design: "Input rewriting is excluded because arguments are already logged and presented" (`packages/core/tools/src/index.ts:604-611`).
- PostToolUse: `tools/post-execute` maps deny to block feedback with reason and folds `additionalContext` onto the downstream decision (`packages/hooks/hooks-claude-code/src/index.ts:253-271`).
- Stop: `agent/turn-stopping` steers a user message on deny, which forces another turn (`packages/hooks/hooks-claude-code/src/index.ts:276-283`). `stop_hook_active` is always `false` and no continuation cap exists (`TODO(stop-loop-guard)`, `packages/hooks/hooks-claude-code/src/index.ts:275`).
- SubagentStart: `subagent/start` injects `additionalContext` into a live local child (`packages/hooks/hooks-claude-code/src/index.ts:287-296`).
- SubagentStop: `subagent/end` runs hooks for observation only (`packages/hooks/hooks-claude-code/src/index.ts:297-301`).

### Shared protocol behavior

- Matcher: absent, empty, and `*` match all. A pattern of letters, digits, underscore, and pipe is a literal alternation. Any other pattern compiles as an unanchored regex (`packages/hooks/hook-protocol/src/matcher.ts:13-18`, `matcher.ts:57-65`).
- Codec: exit 2 becomes a block decision with stderr as reason. Exit 0 parses stdout as JSON only when it starts with `{`. A `hookSpecificOutput` block applies only when its `hookEventName` matches the firing event (`packages/hooks/hook-protocol/src/codec.ts:59-89`, `codec.ts:97-134`).
- Merge: deny over ask over allow, the first `continue: false` is sticky, reasons of the winning rank join (`packages/hooks/hook-protocol/src/merge.ts:62-100`).
- Runner: hooks run through `ctx.shell` with a 600,000 ms default timeout, a per-hook `timeoutSec` override, the session cwd, and `CLAUDE_PROJECT_DIR` in the environment (`packages/hooks/hook-protocol/src/runner.ts:20`, `runner.ts:67-105`; `packages/hooks/hooks-claude-code/src/index.ts:151-179`).
- Durable records: `hook/invoked` and `hook/result` session events pair by `handlerId` and must stay turn-enclosed (`packages/hooks/hook-protocol/src/events.ts:1-7`, `events.ts:75-104`).

### Documented gaps

The bridge README lists 23 unsupported events, including SessionEnd, PreCompact, and Notification, and names the official reference as the baseline (`packages/hooks/hooks-claude-code/README.md`, "Known Limitations and Deferred Work"). Per-event partials from the same section:

- SessionStart lacks plain stdout context, `initialUserMessage`, `sessionTitle`, `watchPaths`, `reloadSkills`, and `CLAUDE_ENV_FILE`.
- UserPromptSubmit lacks plain stdout context, `sessionTitle`, and `suppressOriginalPrompt`, and keeps the 600-second default instead of the 30-second event default.
- PreToolUse lacks allow-pre-approve, defer, `additionalContext`, and `updatedInput`.
- PostToolUse lacks `updatedToolOutput` and flattens `tool_response` to text.
- Stop lacks `stop_hook_active` truth, `last_assistant_message`, `background_tasks`, `session_crons`, and the continuation cap.
- Subagent hooks report a constant `agent_type` of `general-purpose`, so a matcher on a specific type never fires (`packages/hooks/hooks-claude-code/src/index.ts:304-310`).
- Common payload fields omit `prompt_id`, `permission_mode`, and `effort`. `transcript_path` stays the empty string because the persistence seam exposes no artifact path (`packages/hooks/hooks-claude-code/src/index.ts:327-336`).
- `updatedInput`, `systemMessage`, and `continue: false` decode but do not apply. The bridge warns (`packages/hooks/hooks-claude-code/src/index.ts:181-186`, `index.ts:195`).

### Our runtime surface

`packages/market-runtime/src/runtime/surfaces/extension-hooks.ts:37-45` records the same gaps for the market bridge: "input rewrites, systemMessage and run-level halt are not applied; SubagentStop is observation-only." The class runs the same seven points (`packages/market-runtime/src/runtime/surfaces/extension-hooks.ts:27`) with the same decision mapping (`packages/market-runtime/src/runtime/surfaces/extension-hooks.ts:63-148`) and the same warn on unapplied fields (`packages/market-runtime/src/runtime/surfaces/extension-hooks.ts:285-286`). `packages/market-catalog/src/scanning/project-hooks.ts:6` validates the same seven events and merges settings documents additively with deduplication (`packages/market-catalog/src/scanning/project-hooks.ts:34`). The mount creates one `ExtensionHooks` per agent inside a `shell` plus `sessionProjections` scope and disposes it on teardown (`packages/market-runtime/src/runtime/host/scoped-contributors.ts:116-118`).

## Gap matrix

Status legend: **host-supported** means the host seam exists and the semantics map today, with the partials listed above. **plugin-extendable-today** means a plugin-side bridge can deliver it on existing seams without any host change. **needs-host-change** means delivery is impossible without upstream work, and the required seam is named.

| Event and capability | Status | Notes and required seam |
| --- | --- | --- |
| SessionStart: run hooks, source matcher, `additionalContext` | host-supported | Source vocabulary lacks `fork` because `SessionStartSource` has four values (`packages/core/agent/src/runtime-types.ts:125`) |
| SessionStart: plain stdout as context | plugin-extendable-today | Our runner keeps `output.stdout`. Treat non-JSON stdout as context, per the spec rule for this event |
| SessionStart: `initialUserMessage`, `sessionTitle`, `watchPaths`, `reloadSkills`, `CLAUDE_ENV_FILE` | needs-host-change | No session-rename API, no file-watch registration, no environment-file handoff exists on the interception points. Parts are approximable plugin-side with explicit divergence, but the honest seam is a host capability |
| UserPromptSubmit: block | host-supported | Maps to `reject` (`packages/hooks/hooks-claude-code/src/index.ts:229-231`) |
| UserPromptSubmit: block reason visible to the user | needs-host-change | `PreStepDecision` reject carries no reason (`packages/core/agent/src/runtime-types.ts:112-119`). Required seam: a reason field on the reject arm |
| UserPromptSubmit: `additionalContext`, plain stdout, 30-second default | plugin-extendable-today | JSON context works on the host. Plain stdout and the event-specific timeout are ours to add in `ExtensionHooks` |
| PreToolUse: deny and ask with reason | host-supported | Maps onto `PreToolDecision` (`packages/hooks/hooks-claude-code/src/index.ts:244-250`) |
| PreToolUse: allow pre-approve, defer | needs-host-change | Allow delegates to `next()`, so the permission flow still runs. Defer has no resume-pause seam. Required seam: decision arms or an approval-service integration |
| PreToolUse: `updatedInput` | needs-host-change | Input rewrite is deliberately excluded from `PreToolDecision` (`packages/core/tools/src/index.ts:604-611`). Required seam: an optional rewrite arm with audit |
| PreToolUse: `additionalContext` | plugin-extendable-today | The codec parses it, but both bridges drop it at this point. Our bridge can fold it as the PostToolUse path does |
| PostToolUse: block feedback, reason, `additionalContext` | host-supported | Maps onto the block arm with `additionalContexts` (`packages/hooks/hooks-claude-code/src/index.ts:253-271`) |
| PostToolUse: `updatedToolOutput` | plugin-extendable-today | `PostToolDecision` accept already replaces the projection through `content` or `value` (`packages/core/tools/src/index.ts:614-620`). Neither bridge maps it today. Shape validation stays our duty, matching the spec rule that a mismatched shape is ignored |
| PostToolUse: structured `tool_response` | plugin-extendable-today | Both bridges flatten to text. The result carries `ContentBlock[]` before flattening |
| Notification: `permission_prompt` | plugin-extendable-today | The `approval/request` waterfall exists (`packages/interaction/user-approval/src/types.ts:87-92`) and `approval/asked` session events exist (`packages/core/session/src/known-event-types.ts:25`). Timing differs: the spec defers six seconds on idle heuristics, the host event fires immediately |
| Notification: `idle_prompt` | plugin-extendable-today | `agent/status` reports `idle` and `running` (`packages/core/agent/src/runtime-types.ts:109`, `:280`). A sixty-second timer after idle approximates it. Keystroke-activity deferral has no seam |
| Notification: `terminalSequence`, quota, elicitation, `agent_completed` types | needs-host-change | The desktop and web clients own the notification channels. No host events represent the quota and elicitation types |
| Stop: block forces continuation | host-supported | Steer at the stopping boundary (`packages/hooks/hooks-claude-code/src/index.ts:276-283`) |
| Stop: `additionalContext` as non-error feedback | plugin-extendable-today | Both bridges drop it. `agent.steer` with a context message delivers the continuation, as the block path already steers |
| Stop: 8-continuation cap | plugin-extendable-today | Our bridge can count consecutive forced continuations per turn and stop forcing at eight. `stop_hook_active` truth stays host-owned |
| Stop: `stop_hook_active` truth, `background_tasks`, `session_crons` | needs-host-change | The flag requires host tracking of hook-caused continuations. No background-task enumeration seam was found. `last_assistant_message` is plugin-extendable from the session log |
| SubagentStart: run hooks, inject context | host-supported | Local in-process children only (`packages/hooks/hooks-claude-code/src/index.ts:287-296`) |
| SubagentStart: matcher on true agent type | needs-host-change | The seam carries no per-kind label, so the bridge reports `general-purpose` (`packages/hooks/hooks-claude-code/src/index.ts:304-310`). Partial plugin extension: when the subagent comes from our own catalog, we know the requested role at spawn |
| SubagentStop: observe | host-supported | Runs for observation only (`packages/hooks/hooks-claude-code/src/index.ts:297-301`) |
| SubagentStop: block keeps the subagent running | needs-host-change | `subagent/end` is an emit-only notification whose listeners return void and are contained (`packages/subagent/subagent/src/lifecycle.ts:86-100`). Required seam: an interceptable end edge or a child-steer API on the subagent service |
| PreCompact: observe and run hooks | plugin-extendable-today | `session/event` is a post-commit feed (`packages/core/session/src/index.ts:77`). `compaction/start` carries `turn` and `sourceCommandId` (`packages/compaction/compaction/lib/types/types.d.ts:20-25`). Manual compaction passes a `sourceCommandId` through `compactNow` (`packages/compaction/command-compact/src/index.ts:12`, `:67`). Automatic compaction enters through `compactIfNeeded` with a trigger (`packages/compaction/compaction/src/index.ts:36-37`, `:136`). Trigger derivation is therefore possible, with `custom_instructions` unmapped |
| PreCompact: block compaction | needs-host-change | `compaction/start` is appended after the run began, so no pre-start interception exists. Required seam: a vetoable waterfall before `compactNow` or `compactIfNeeded` commits. Registering our own `CompactionEngine` would replace the host engine, which is a change of host responsibility, not a bridge |
| SessionEnd: run hooks with reason | plugin-extendable-today | `agent/disposed` fires with the agent payload (`packages/core/agent/src/runtime-types.ts:270`), `session/disposed` fires when a session leaves the store (`packages/core/session/src/index.ts:65`), and `workspace/session-stop` fires on archive (`packages/workspace/workspace/src/index.ts:147`, `:482`). Reason mapping is approximate: `clear` and `resume` map to host lifecycle edges, `logout` and `prompt_input_exit` have no host equivalent and report `other`. The spec discards output, so no decision mapping is needed |
| SessionEnd: 1.5-second budget | plugin-extendable-today | Our runner owns `defaultTimeoutMs` per invocation |
| Cross-cutting: `systemMessage` | needs-host-change for the transcript channel | No user-visible message channel exists on the interception points. A plugin-client toast is possible today but diverges from the spec channel and needs labeling |
| Cross-cutting: `continue: false` run halt | needs-host-change | Host TODO with no seam (`packages/hooks/hooks-claude-code/src/index.ts:195`) |
| Cross-cutting: `transcript_path` | needs-host-change | The persistence seam exposes no artifact path (`packages/hooks/hooks-claude-code/src/index.ts:327-336`) |
| Cross-cutting: parallel hook execution, handler dedup | plugin-extendable-today | Serial execution is a bridge choice documented as deliberate. Our bridge owns its own scheduling |
| Cross-cutting: `http` and `mcp_tool` handler types | plugin-extendable-today | We can POST ourselves, and we already ship an MCP client (`src/runtime/mcp/bridge/`) |
| Cross-cutting: layered settings discovery and merge | plugin-extendable-today | Our catalog already merges documents additively and deduplicates (`packages/market-catalog/src/scanning/project-hooks.ts:34`) |

## Recommendation

### Ship now, plugin-side

All items below stay inside the market plugin. None touches the host.

1. SessionEnd bridge, effort S. Register listeners on a plugin-level scope filtered by agent, because the per-agent hook fiber tears down at teardown and the ordering against `agent/disposed` is not guaranteed (`packages/market-runtime/src/runtime/host/scoped-contributors.ts:116-118`). Run hooks detached through the existing drain machinery. Skip the `hook/invoked` and `hook/result` pair because disposal happens outside any open turn and the protocol requires turn enclosure (`packages/hooks/hook-protocol/src/events.ts:1-7`). Log outcomes instead. Extend the event set in `packages/market-catalog/src/scanning/project-hooks.ts:6` and the point union in `packages/market-runtime/src/runtime/surfaces/extension-hooks.ts:27`. State the partial reason vocabulary in the suite scan notes.
2. PreCompact observation bridge, effort S. Listen for `compaction/start` on `session/event`, derive the trigger from `sourceCommandId` presence and `turn`, run hooks detached, and discard block decisions with a diagnostic that names the host limitation. Do not claim blocking in any user-facing text.
3. Notification bridge for `permission_prompt` and `idle_prompt`, effort M. Use the `approval/request` waterfall for permission prompts and an idle timer on `agent/status` for idle prompts. Document the timing divergence from the six-second idle gate. Leave the other matcher types unsupported with a scan note.
4. PostToolUse `updatedToolOutput` mapping, effort S. Map onto `PostToolDecision` accept with `content` after shape validation, and fall back to plain accept on mismatch, mirroring the spec rule.
5. PreToolUse `additionalContext` mapping, effort S. Fold parsed context into the downstream decision as the PostToolUse path already does.
6. Stop `additionalContext` and continuation cap, effort S. Steer context as non-error feedback. Cap consecutive forced continuations per turn at eight.
7. Plain stdout as context on SessionStart and UserPromptSubmit, effort S. The runner already retains `output.stdout`.

Items 4 through 7 are small fidelity fixes inside `ExtensionHooks`. Items 1 through 3 add new points. Each ships with scan notes, so a suite that uses an unsupported capability fails legibly instead of silently.

### Upstream proposals

Follow the convention of `docs/developer/upstream-proposal/desktop-host-child-path.md`: state the gap, reproduce it against a checkout hash, name the seam, and propose the change. The repository rule stands: never implement a feature by editing the host (`AGENTS.local.md`). Candidates in priority order:

1. PreToolUse input rewrite (`updatedInput`). The host excludes it deliberately (`packages/core/tools/src/index.ts:604-611`). Propose an optional rewrite arm on `PreToolDecision` with audit logging. Effort L, because of design and security review.
2. Run-level halt for `continue: false`. Propose a halt decision or a loop-level abort seam. Effort M.
3. PreCompact veto. Propose a vetoable waterfall before compaction commits. Effort M.
4. SubagentStop blocking. Propose an interceptable subagent end edge or a child-steer API. Effort M to L.
5. `systemMessage` surfacing. Propose a user-visible message channel on the interception points. Effort S to M.
6. UserPromptSubmit block reason visibility. Propose a reason field on the reject arm of `PreStepDecision`. Effort S.
7. `stop_hook_active` truth and a `fork` source for SessionStart. Propose host tracking of hook-caused continuations and an extension of `SessionStartSource`. Effort S to M.
8. `transcript_path` artifact exposure. Propose an artifact path on the persistence seam. Effort M.

### Not recommended

- A custom `CompactionEngine` registration to intercept compaction. It replaces the host engine and changes core behavior. It is a takeover of host responsibility, not a bridge.
- `prompt` and `agent` handler types. They embed model calls, duplicate host LLM seams, and rarely appear in marketplace suites. Effort L for low demand. Revisit on request.

## Essential files

- `packages/market-runtime/src/runtime/surfaces/extension-hooks.ts` — the market hooks bridge and its documented gaps.
- `packages/market-catalog/src/scanning/project-hooks.ts` — event validation, settings merge, and deduplication.
- `packages/market-runtime/src/runtime/host/scoped-contributors.ts` — the per-agent mount lifecycle.
- `packages/hooks/hooks-claude-code/src/index.ts` in the harness checkout — the host bridge reference implementation.
- `packages/hooks/hooks-claude-code/src/config.ts` in the harness checkout — the supported event list.
- `packages/hooks/hook-protocol/src/matcher.ts`, `codec.ts`, `merge.ts`, `runner.ts`, `events.ts`, `types.ts` in the harness checkout — the shared protocol.
- `packages/core/agent/src/runtime-types.ts` in the harness checkout — the interception event contracts.
- `packages/core/tools/src/index.ts` in the harness checkout — the tool decision unions.
- `packages/compaction/compaction/src/index.ts` in the harness checkout — the compaction service seam.
- The official reference: https://code.claude.com/docs/en/hooks
