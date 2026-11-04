# Our injection inventory

Everything the `dsh-agent-plugins-market` plugin puts in front of the model, with the producer, the trigger, the exact text, the delivery channel, the framing, and the caching character of each site.

Scope: `packages/market-runtime/src`, `packages/market-bundle/src`, and `plugins/`. Read on `dev` at `6cbd8af`. Every quoted string below is copied verbatim from source, including its own punctuation.

Method: the `read` and `grep` tools over the source tree. No source file was modified.

---

## How the plugin reaches the model

Five primitives carry content, and every site uses one of them:

| Primitive                     | Weight        | Where it lands                                  |
| ----------------------------- | ------------- | ----------------------------------------------- |
| `systemPrompt.section({...})` | System prompt | One named section of the assembled prompt       |
| `agent.inject(message)`       | User turn     | Model-facing inbox, delivered as a user message |
| `agent.steer(message)`        | User turn     | Model-facing inbox, mid-turn steering           |
| `agent.followup(message)`     | User turn     | A durable user-role follow-up message           |
| `tools.register(...)`         | Tool schema   | Tool description and parameter descriptions     |

Two consumers read a produced value and emit it themselves: the host skill registry renders `SkillCandidate.description` into its catalog, and the host bridge renders `ToolDefinition.description` into the tool schema. Both are listed below as external producers.

### The one framing module

`packages/market-runtime/src/runtime/surfaces/prompt-frame.ts` owns the decision. Two forms exist:

```text
<system-reminder>
<escaped body>
</system-reminder>
```

produced by `frame()` at `prompt-frame.ts:56-58`:

```ts
return [SYSTEM_REMINDER_OPEN, escapeFrameBody(body), SYSTEM_REMINDER_CLOSE].join('\n')
```

and plain prose with no frame at all. Contributor attribution inside a frame or section is `attribute()` at `prompt-frame.ts:69-74`:

```ts
.map(section => '### ' + singleLine(section.heading) + '\n\n' + section.body.trim())
.join('\n\n')
```

The written rule lives at `docs/reference/prompt-injection-conventions.md` and is pinned by `packages/market-bundle/test/integration/prompt-injection-conventions.test.ts`.

---

## Site table

| Id | Producer (file:line) | Trigger | Channel | Framing | Cache character |
| --- | --- | --- | --- | --- | --- |
| S1 | `scoped-contributors.ts:75-87`, registered `:189-197` | Agent scope gains `systemPrompt` and a suite is selected | System prompt section `agent-plugins:instructions`, order 500 | Markdown, no frame | Per request rendering of per-session state |
| S2 | `project-runtime.ts:64-103`, section `:83` | `mountSuiteInstructions` mounts, then `agent/created` refresh | System prompt section `agent-plugins:instructions`, order 500 | Markdown, no frame, no heading | Per request rendering of per-session state |
| S3 | `extension-hooks.ts:484-485` via `contextFrom(..., true)` `:800-807` | `SessionStart` hook contributes `additionalContext` or exit-0 plain stdout | `agent.inject` | `<system-reminder>` frame | Per session, once, durable |
| S4 | `extension-hooks.ts:242-243` | `UserPromptSubmit` hook contributes context | Enter-step messages | `<system-reminder>` frame | Per submitted prompt |
| S5 | `extension-hooks.ts:280-281` | `PreToolUse` hook contributes context and the call is allowed | `agent.inject` | Plain prose | Per tool call |
| S6 | `extension-hooks.ts:328-344` | `PostToolUse` or `PostToolUseFailure` hook contributes context | `additionalContexts` on the tool decision | Plain prose | Per tool call |
| S7 | `extension-hooks.ts:376-379` | `Stop` hook blocks or contributes context | `agent.steer` | Plain prose | Per stop attempt |
| S8 | `extension-hooks.ts:553-554` | `SubagentStart` hook contributes context | `child.inject` | Plain prose | Per child start |
| S9 | `extension-hooks.ts:728-737` | A hook denies, blocks, or stops | Denial reason or `block` feedback blocks | Plain prose | Per decision |
| S10 | `subagent-catalog.ts:188-211` | `subagent_role` tool registered, role entries change | `agent/pre-step` user message | Hand-built `<system-reminder>` plus `<available_subagents>` | Per session, republished on digest change |
| S11 | `subagent-catalog.ts:219-235` | `spawn_teammate_role` tool registered, role entries change | `agent/pre-step` user message | Hand-built `<system-reminder>` | Per session, republished when absent |
| S12 | `team-coordination.ts:32-56` | Agent is a Team lead or teammate | System prompt section `market:team-coordination`, order 601 | Markdown, no frame | Per request rendering of per-session state |
| S13 | `role-composition.ts:86-88` | Role child created or resumed | System prompt section `PERSONA_PREFIX_SECTION`, order 0 | Raw authored text, no heading, no frame | Per request rendering of durable binding |
| S14 | `role-composition.ts:140-142`, injected `:313-318` | Role child created | `agent.inject` | Plain prose | Once per child, durable |
| S15 | `teammate-role-runtime.ts:53-66`, injected `:190-195` | Role teammate created | `agent.inject` | Hand-built `<system-reminder>` | Once per member, durable |
| S16 | `output-style-render.ts:35-38`, section `output-style-section.ts:54-62` | `agent/created` with a workspace, a style is selected | System prompt section `market:output-style`, order 490 | Markdown heading, no frame | Per request rendering of per-workspace cache |
| S17 | `commands-mounts.ts:245-251`, `:262-268` | User runs a suite command | `agent.followup` | Plain user message, no frame, no heading | Once per invocation |
| S18 | `user-commands.ts:161-166` | User runs a panel command | `agent.followup` | Plain user message | Once per invocation |
| S19 | `extension-session-state.ts:862-868` | Every committed selection binding | `agent.inject` | Plain prose, `form: 'context'` | Every commit, filtered before the request |
| S20 | `extension-session-state.ts:790-795` | A selection is requested mid-turn | `agent.inject` then `inbox.remove` | Plain prose, `form: 'context'` | Once per request, removed from inbox |
| S21 | `extension-session-state.ts:840-845` | Recovery or busy retry restores readiness | `agent.steer` | Plain prose, `form: 'context'` | Once per recovery |
| S22 | `agent-role-router.ts:434-497` | Plugin mounts with tools, llm, subagents | Tool schema `subagent_role` | Tool description and parameters | Per request tool assembly |
| S23 | `teammate-role-tool.ts:19-49` | Plugin mounts with Team services | Tool schema `spawn_teammate_role` | Tool description and parameters | Per request tool assembly |
| S24 | `feedback-tool.ts:243-266` | Feedback switch is on | Tool schema `report_market_issue` | Tool description and parameters | Per request tool assembly |
| S25 | `bridge/tools.ts:121-168`, `:194-222` | An MCP server connects and lists tools | Tool schema `mcp__<server>__<tool>` | Caller-supplied description verbatim | Per mount, re-synced per generation |
| S26 | `skills-provider.ts:141-168` | Host skill registry lists candidates | Skill candidate `description` rendered by the host | Caller-supplied description verbatim | Per skill catalog digest |

---

## Per-site detail

### S1. Suite instruction section

Producer: `packages/market-runtime/src/runtime/host/scoped-contributors.ts:75-87`. Registered at `:189-197` with `name: 'agent-plugins:instructions'`, `order: 500`, `interpolate: false`.

Trigger: the agent scope injects `systemPrompt`, and `reconcile` collected instruction rows for selected suites (`:246-260`). A row is the suite `systemPrompt` (`project-runtime.ts:129`) or its startup skill body (`:137-140`).

The section body, in order:

```text
## Agent plugin instructions

Instructions from enabled plugin suites may be relevant to your work. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.

### <suite manifest name>

<suite authored text>

### <next suite manifest name>

<next suite authored text>
```

The heading and precedence line are literals at `:86` and `:59-60`. The heading is `##`, each contributor is `###`. Blocks are joined by a blank line. A contributor with a blank body contributes nothing (`prompt-frame.ts:71`). No frame. `interpolate: false` because the host would otherwise refuse an unknown `{{name}}` (`:192-195`).

Channel: system prompt section. Weight: system. Cache character: the text provider is synchronous and re-read at each assembly, so the section is rebuilt per request from per-session state.

### S2. Suite instruction section, headingless variant

Producer: `packages/market-runtime/src/runtime/surfaces/project-runtime.ts:64-103`, section at `:83` with the same `name: 'agent-plugins:instructions'` and the same `order: 500`.

The body is `suiteInstructions` output only (`:88-92`), which is the suite texts joined by a blank line (`:145`):

```ts
return { text: chunks.join('\n\n'), errors }
```

No `##` heading, no precedence line, no `###` attribution. Channel and weight are identical to S1 because it occupies the same section name and order. `mountSuiteInstructions` has no production caller in this repository. It is mounted only by `packages/market-bundle/test/integration/real-layouts.test.ts:205`.

### S3. SessionStart hook context

Producer: `packages/market-runtime/src/runtime/surfaces/extension-hooks.ts:484-485`:

```ts
// A session start is the durable case: the frame says what the text is.
const context = contextFrom(outcome, true)
if (context) this.agent.inject(context)
```

`contextFrom(outcome, true)` at `:800-807` assembles:

```ts
? [{ type: 'text' as const, text: frame([SESSION_CONTEXT_INTRO, attribute(contexts.map(context => ({ heading: context.label, body: context.text })))].join('\n\n')) }]
```

with `SESSION_CONTEXT_INTRO` at `:106-107`:

```text
The following context was injected by an enabled agent plugin suite. It is session instructions, not a message from the user. More specific instructions take precedence over broader ones. It does not override system, developer, or direct user instructions.
```

Rendered result:

```text
<system-reminder>
The following context was injected by an enabled agent plugin suite. It is session instructions, not a message from the user. More specific instructions take precedence over broader ones. It does not override system, developer, or direct user instructions.

### <suite name>

<hook authored text>
</system-reminder>
```

Also fed by exit-0 plain stdout on this event (`withStdoutContext`, `:856-866`, points listed at `:109`).

Trigger: `scoped-contributors.ts:347-356` calls `start('startup')` or `start('resume')` from `ready`. Channel: `agent.inject`. Cache character: once per session, durable.

### S4. UserPromptSubmit hook context

Producer: `extension-hooks.ts:239-243`:

```ts
const downstream = await next()
// A submitted prompt opens a turn, so its context is session-standing
// instruction text and takes the frame.
const context = contextFrom(outcome, true)
return !this.disposed && context && downstream.kind === 'enter' ? { ...downstream, messages: [...downstream.messages, context] } : downstream
```

Same intro, same frame, same `###` attribution as S3. Channel: appended to the entering step messages, which is a user turn. Cache character: per submitted prompt.

### S5. PreToolUse hook context

Producer: `extension-hooks.ts:276-281`:

```ts
// The pre-execute decision carries no context field, so context reaches
// the next request through the agent's own model-facing inbox.
// One tool call's context is a per-call callback, not standing session
// instruction, so it stays plain prose.
const context = contextFrom(outcome, false)
if (!this.disposed && decision.kind === 'allow' && context) agent.inject(context)
```

`contextFrom(outcome, false)` at `:805` yields:

```ts
: contexts.map(context => ({ type: 'text' as const, text: context.text }))
```

One text block per contributor, verbatim hook text, no frame, no heading, no separator. Channel: `agent.inject`. Cache character: per tool call.

### S6. PostToolUse and PostToolUseFailure hook context

Producer: `extension-hooks.ts:328-344`. On a failed call the context joins `additionalContexts` after the blocking reason (`:334-335`). On a successful call the context rides the downstream decision (`:344`). Plain text, no frame. A blocking hook reason becomes `feedback: [{ type: 'text' as const, text: reason }]` (`:337-342`).

### S7. Stop steering

Producer: `extension-hooks.ts:376-379`:

```ts
for (const message of [reason, ...merged.additionalContext]) {
  if (message === undefined || message.length === 0) continue
  agent.steer(createUserMessage({ content: [{ type: 'text', text: message }], source: CONTEXT_SOURCE }))
}
```

Plain text, one steer per message. No frame, by the R2 rule.

### S8. SubagentStart hook context

Producer: `extension-hooks.ts:553-554`:

```ts
const context = contextFrom(outcome, false)
if (context && child && this.children.get(info.runId) === child) child.inject(context)
```

Plain text, injected on the child.

### S9. Blocking reasons

Producer: `extension-hooks.ts:728-737`:

```ts
private blockReason(point: Point, outcome: PointOutcome): string {
  const { merged } = outcome
  if (merged.reason !== undefined && merged.reason.length > 0) return merged.reason
  if (merged.stopReason !== undefined && merged.stopReason.length > 0) return merged.stopReason
  if (outcome.denySystemMessages.length > 0) return outcome.denySystemMessages.join(REASON_SEPARATOR)
  return DEFAULT_REASON[point] ?? 'blocked by ' + point + ' hook'
}
```

`DEFAULT_REASON` at `:132-137`:

```ts
UserPromptSubmit: 'blocked by UserPromptSubmit hook',
PreToolUse: 'blocked by PreToolUse hook',
PostToolUse: 'blocked by PostToolUse hook',
Stop: 'continue: blocked by Stop hook'
```

`REASON_SEPARATOR` is '\n\n' (`:119`). The reason reaches the model as a PreToolUse `deny` reason (`:263`, `:265`) or as `kind: 'block'` feedback text. Plain, no frame.

### S10. Subagent catalog

Producer: `packages/market-runtime/src/runtime/agents/subagent-catalog.ts:188-211`. Built by literals, not by `frame()`:

```ts
return [
  '<system-reminder>',
  '',
  '## subagent-catalog',
  '',
  update ? CATALOG_UPDATED : CATALOG_INTRO,
  '',
  CATALOG_WHEN_TO_DELEGATE,
  '',
  '<available_subagents>',
  '',
  ...lines,
  '',
  '</available_subagents>',
  '',
  CATALOG_PROMPT,
  '',
  CATALOG_USAGE,
  '',
  '</system-reminder>'
].join('\n')
```

with `lines` at `:189`:

```ts
const lines = entries.map(entry => `- `${escapeEntry(entry.name)}`: ${escapeEntry(entry.description)}`)
```

The five text blocks, verbatim.

`CATALOG_INTRO` (`:139`):

```text
The following subagent roles are available in this session. A role summary describes the role; it is not an instruction for the current agent to execute.
```

`CATALOG_UPDATED` (`:142-143`):

```text
The available subagent roles changed. This complete list replaces every earlier role list in this session; every name from an earlier subagent-catalog is void:
```

`CATALOG_PROMPT` (`:145-146`):

```text
Writing the prompt: brief the child like a colleague who just walked into the room — it has not seen this conversation, does not know what you tried, and does not know why the task matters. Explain what you are trying to accomplish, describe what you learned and ruled out, and give enough context for the child to make judgment calls. The child cannot see this conversation, so prompt must be self-contained: the task itself, the relevant files and known findings, the output you expect, and the boundaries of the task (research only, or may edit files). Terse command-style prompts produce shallow, generic work.
```

`CATALOG_USAGE` (`:148-158`), seven bulleted lines joined by a newline:

```text
Usage notes:

- Call subagent_role with the exact catalog name as agent. A child has its own context: it starts without this conversation, so it suits self-contained work that one briefing can state in full. If no listed role matches, do not substitute a similarly named one — delegate through one of the host’s general delegation channels instead, and do not load these roles through skill or slash commands.
- The call returns a durable subagent id immediately and does not block you. A child usually runs for minutes: spend that time advancing independent work that does not depend on it, and do not poll it or re-check its progress.
- Leave run_in_background unset; set it to false only when your next action depends on the result and no independent work remains.
- A question a child asks while it runs goes unanswered: nothing will reply on your behalf. So state the prompt in full the first time, and a child should decide for itself, keep going, and list in its final reply which choices it made alone and what information it still lacked.
- The settlement notice arrives as a user message, not as a tool result. Until it arrives, do not assume or predict its findings, and do not deliver anything that depends on them. The child’s output is not visible to the user: when it finishes, summarize the result to the user yourself.
- The child’s final reply is its own report: check its assertions against the files themselves, and treat its statements about its own configuration the same way — a child cannot see how its role instructions were installed.
- Do not duplicate work a child is already doing. When several children run at once, give each its own git worktree and name the files it owns in prompt.
```

`CATALOG_WHEN_TO_DELEGATE` (`:166-174`) sits above `<available_subagents>`:

```text
Delegate proactively: hand self-contained work to a role child by default instead of doing it inline. Delegate when any of these holds:

- The task would burn many tool calls or file reads whose raw output would flood this conversation — codebase exploration, tracing behavior across files, digesting long logs or reports. The child reads everything and returns only the distilled result.
- The task is a complete unit one briefing can state: a scoped implementation, a review, an analysis, a document.
- Two or more such tasks are independent: start all the children in one message and let them run in parallel.

Decide by the briefing test: if you can state the task in full and it needs no further input from the user, delegate it and keep working.
```

Trigger: `mountSubagentCatalog` at `:83-131`, registered by `agent-role-router.ts:526-532` and `teammate-role-tool.ts:122-136`. Channel: a `user/message` appended to `agent/pre-step`. Cache character: per session, republished only when the entry digest changes (`:111-117`), with the previous message replaced in place (`:121-125`).

### S11. Team role catalog

Producer: `subagent-catalog.ts:219-235`. Same frame, shorter body:

```ts
return [
  '<system-reminder>',
  '',
  '## subagent-catalog',
  '',
  'Available roles for spawn_teammate_role. This complete list replaces every earlier subagent-catalog and its delegation guidance in this session.',
  '',
  ...entries.map(entry => '- ' + escapeEntry(JSON.stringify(entry.name)) + ': ' + escapeEntry(entry.description)),
  '',
  'A role from this list goes to spawn_teammate_role. Without a matching role, or when the member should inherit this conversation, use native spawn_teammate.',
  '',
  'Team authorization, coordination, waiting and shared-task practice: see the Team coordination section of your system prompt.',
  '',
  '</system-reminder>'
].join('\n')
```

No `<available_subagents>` block, no usage notes, no delegation triggers. Entries use `JSON.stringify(entry.name)` inside single quotes, not backticks.

### S12. Team coordination section

Producer: `packages/market-runtime/src/runtime/agents/team-coordination.ts:32-56`. Registered as `name: 'market:team-coordination'`, `order: prompt.getSectionOrder('TEAM_POLICY') + 1` (601, since `TEAM_POLICY` is 600 in the host `SECTION_ORDERS`), `interpolate: false`.

The section head is always (`:50-54`):

```text
## Team coordination

Follow the host Team authorization, tool contracts, workspace safety and permission rules. This guidance does not authorize creating members on its own.
```

For a lead, `LEAD_GUIDANCE` (`:7-14`) appends six paragraphs. First line:

```text
You are the Team Lead. Own clarification of user intent, scope and trade-offs, shared interfaces, direction changes, integration and final acceptance.
```

For a member, a three-line identity block (`:42-49`) replaces it:

```text
You are teammate <name>. Your Team Lead is addressed as "lead".
Use send_message({ target: "lead", message: "..." }) for Lead communication. Use list_agents({}) to identify peers, and their returned targets for peer messages.
<MEMBER_GUIDANCE, four paragraphs>
```

The name is interpolated through `JSON.stringify(membership.name)`, so it renders with double quotes. `MEMBER_GUIDANCE` (`:16-21`) opens:

```text
Work on the assigned execution or research unit within its boundaries; the Lead owns user clarification and cross-task decisions. Send important findings, conflicts and blockers early rather than narrating every tool call.
```

Channel: system prompt section. Renders nothing when the scope is not a live Team member (`:37-41`). Cache character: per request, stable while membership is unchanged.

### S13. Role child persona section

Producer: `packages/market-runtime/src/runtime/agents/role-composition.ts:85-88`:

```ts
export function installPersonaSection(prompt: SystemPrompt, persona: string): () => void {
  return prompt.section({ name: PERSONA_PREFIX_SECTION, order: prompt.getSectionOrder(`'DEPLOYMENT_PERSONA_PREFIX'`), text: persona, interpolate: false })
}
```

Text: the role card body exactly, from `parseAgentRole` (`application/agent-roles.ts:71`):

```ts
content: text.slice(match[0].length),
```

which is the file with its frontmatter removed and nothing added. No heading, no precedence line, no frame, no escaping. Channel: system prompt section at order 0. Cache character: per request, from a durable binding (`:294-297`).

### S14. Role child binding notice

Producer: `role-composition.ts:139-142`:

```ts
function roleChildNotice(role: string): string {
  return [`You are the role child "${role}".`, 'The role instructions from the delegation snapshot are applied to your system prompt and restored on resume.'].join('\n')
}
```

Rendered:

```text
You are the role child "<role>".
The role instructions from the delegation snapshot are applied to your system prompt and restored on resume.
```

Injected at `:313-318` with `source: { kind: ROLE_CHILD_SOURCE, form: 'context', binding }`. Plain prose, no frame, no heading. Cache character: once per child, durable.

### S15. Teammate member identity

Producer: `packages/market-runtime/src/runtime/agents/teammate-role-runtime.ts:52-66`:

```ts
return [
  '<system-reminder>',
  '',
  `You are teammate ${JSON.stringify(member)}.`,
  'Your Team Lead is addressed as "lead".',
  'Use list_agents({}) to find your teammates and their names.',
  'To message your Team Lead, use send_message({ target: "lead", message: "..." }).',
  'To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).',
  ...(role === '' ? [] : [`Your role is ${role}. The role instructions are applied to your system prompt.`]),
  '',
  '</system-reminder>'
].join('\n')
```

Rendered for a role member:

```text
<system-reminder>

You are teammate "<name>".
Your Team Lead is addressed as "lead".
Use list_agents({}) to find your teammates and their names.
To message your Team Lead, use send_message({ target: "lead", message: "..." }).
To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).
Your role is <role>. The role instructions are applied to your system prompt.

</system-reminder>
```

Note the blank line after the open tag and before the close tag, unlike `frame()`, which emits no blank line. Channel: `agent.inject` at `:190-195` with `source: { kind: TEAM_ROLE_SOURCE, form: 'context', binding }`. Cache character: once per member, durable.

### S16. Output style section

Producer: `packages/market-runtime/src/runtime/host/output-style-render.ts:29-39`:

```ts
export function renderOutputStyleSection(label: string, body: string): string {
  const trimmed = body.trim()
  if (trimmed === '') return ''
  return OUTPUT_STYLE_HEADING_PREFIX + label.trim() + '\n' + escapeFrameBody(trimmed)
}
```

`OUTPUT_STYLE_HEADING_PREFIX` is `'## Output style: '` at `packages/market-contracts/src/contracts/output-styles.ts:56`. Rendered:

```text
## Output style: <label>
<body, with any </system-reminder> escaped>
```

Registered per agent at `output-style-section.ts:54-62` as `OUTPUT_STYLE_SECTION_NAME` ( `'market:output-style'`) at `OUTPUT_STYLE_SECTION_ORDER` (490), `interpolate: false`.

Builtin bodies are Markdown files under `plugins/output-styles/styles/`. `default.md` has frontmatter and an empty body, so it contributes no section at all (`output-styles.ts:61-63`). `concise.md` body:

```text
Answer first. The first line is the result, the fix, or the direct answer, not a description of what you are about to do.

Stop there unless the reader needs more. Add detail only when it changes what they do next: a caveat that could bite, a step they must run, or a choice they have to make.

Delete the rest. No preamble, no restating the question, no summary of what you just did, no offer to help further. A short answer is a complete answer when it settles the question.

Name things exactly. Paths, commands, errors and identifiers stay verbatim, because shortening those makes an answer wrong rather than concise.
```

`explanatory.md` body:

```text
Answer the task, and teach while you do it.

Before you write code, say in one or two lines why this approach and not another. After you write it, say what it costs: what it assumes, what would break it, and where the next person should look.

Keep the insight tied to this codebase. Name the file, the function, or the constraint that makes the choice matter. General programming advice adds nothing a reader cannot find on their own.

Do not pad. One short paragraph at the point of decision is the whole contribution. A change with nothing interesting to say gets no insight at all.

Keep the task moving: explanations come beside the work, never instead of it.
```

Cache character: per request, read synchronously from `service.sectionText(workspace)` ( `output-style-service.ts:107-110`), refreshed at mount, on mutation, on page read, and on `agent/created`.

### S17. Suite command body

Producer: `packages/market-runtime/src/runtime/surfaces/commands-mounts.ts:225-268`. The body is the authored file with placeholders resolved, sent as:

```ts
agent.followup(
  createUserMessage({
    content: [{ type: 'text', text }],
    source: pluginMarketSource()
  })
)
```

Comment at `:206-210` states the constraint:

```text
// The template rides the agent verbatim apart from the placeholders
// its author wrote: a decorator line naming this plugin or the
// suite would be text the command author never wrote, and the
// follow-up's source already records provenance.
```

Plain user message. No frame, no heading, no prefix. Cache character: once per invocation.

The command `description` field carries the only generated text (`:202`): `[<suite name>] <command description>`.

### S18. Panel command body

Producer: `packages/market-runtime/src/runtime/panels/user-commands.ts:157-168`:

```ts
agent.followup(
  createUserMessage({
    content: [{ type: 'text', text: body.replaceAll('$ARGUMENTS', invocation.rawInput.trim()) }],
    source: pluginMarketSource()
  })
)
```

Plain user message. The description at `:125-126` is `[<localized source label>] <description>`, falling back to `[<label>] <call name>`.

### S19, S20, S21. Session state markers

Three plain text markers, all carrying `form: 'context'` and therefore filtered out of every request by the pre-step guard at `extension-session-state.ts:217` and `:227`:

- `extension-session-state.ts:866`: `Session extension selection metadata.`
- `extension-session-state.ts:793`: `Session extension selection request.`
- `extension-session-state.ts:843`: `Session extension readiness restored.`

They exist to make a durable record or to start a driver, not to instruct the model. S20 is removed from the inbox by `agent.inbox.remove` (`:797`). S21 arrives as a steer. No frame.

### S22. subagent_role tool schema

Producer: `packages/market-runtime/src/runtime/agents/agent-role-router.ts:434-497`. Description (`:436-441`):

```text
Delegate a task to a named role child from the session’s subagent-catalog: the role’s own instructions and its configured model apply, and the child starts without this conversation. Use it proactively for self-contained work — codebase exploration whose raw reads would fill this context, a scoped implementation, a review, or an analysis you can brief in one prompt — and start independent children together in one message. The child runs in the background by default and returns a durable subagent id at once, keeping the child available for later turns; when the run settles, the runtime sends the parent a notice carrying its outcome and final reply. A child usually runs for minutes, so continue with independent work instead of waiting. prompt must stand alone, since the child cannot see this conversation and a question it asks while it runs goes unanswered. When the notice arrives, verify its assertions against the files and relay the result to the user; the child’s output is not visible to them. The current subagent-catalog lists the available roles and the full usage guidance; when no listed role matches, use the host’s own subagent tools instead.
```

Parameter descriptions at `:443-468`, including `run_in_background`: `Defaults to true. Set false only when your next action depends on the result.`

Result render (`:492-497`): `started subagent <id>` for a continuable child, `subagent <runId> finished` for a foreground one.

### S23. spawn_teammate_role tool schema

Producer: `packages/market-runtime/src/runtime/agents/teammate-role-tool.ts:19-49`. Description (`:21-22`):

```text
Create a named Team member from a role in the current "subagent-catalog" message. Use only when the user explicitly requests Agent Teams or teammates; only the Team Lead can create members. The member starts fresh, without this conversation, with the role instructions applied to its system prompt. Returns the Team target immediately and the member runs asynchronously, so keep working instead of waiting on the call. Use the native Team tools to message, interrupt, list and assign tasks to it. Without a matching role, use spawn_teammate.
```

Result render (`:48`): `created role teammate <target> on <provider>/<model>`.

### S24. report_market_issue tool schema

Producer: `packages/market-bundle/src/platform/feedback-tool.ts:221-228` ( `FEEDBACK_DESCRIPTION`), registered at `:243-266. Result render (`:266`): `JSON.stringify(value)`.

### S25. MCP tool descriptions

Producer: `packages/market-mcp/src/runtime/mcp/bridge/tools.ts:121-168`. Each MCP tool own `description` becomes the definition description unchanged (`:207-209`, where `description` is `tool.description ?? ''` at `:140`). Public name at `:129`: `publicToolName(opts.serverName, tool.name)`, which is `mcp__<serverName>__<toolName>`. Channel: tool schema. Cache character: rebuilt per mount generation.

Result text is the server content rendered by `extractText` (`:238`, `:287`), with a `'(no output)'` fallback for a missing content array (`:274-275`).

### S26. Skill candidate descriptions

Producer: `packages/market-runtime/src/runtime/surfaces/skills-provider.ts:141-168`. The author `description` and `whenToUse` pass through untouched (`:144-146`):

```ts
// The author's description verbatim — the harness renders it into the
// model's skill catalog, where a suite-name prefix is our packaging.
description: entry.skill.description,
```

The host skill registry renders it as `- `<name>`: <escaped description>` inside its own `<system-reminder>` plus `<available_skills>`. This plugin contributes the entry fields only. Cache character: per skill catalog digest.

### External producers driven by this plugin

- The host skill catalog (host tree, `packages/skill/tool-skill`) publishes `<system-reminder>`, `<available_skills>`, and one `- `name`: description` line per skill. Entries come from S26 and from `UserPanelSkillProvider`.
- The host bridge renders `ToolDefinition.description` into the tool schema for S22, S23, S24, and S25.
- The host instruction loader (`packages/context/agent-instructions`) owns the `<system-reminder>` frame around workspace `AGENTS.md` files. This plugin writes those files through the instructions routes (`packages/market-bundle/src/routes-instructions.ts`) but does not produce the frame.

---

## Not present

Checked and absent from this plugin producers:

- **Plan mode.** No match for `plan mode` or `planMode` anywhere under `packages`. The host owns `PLAN_POLICY` at order 500.
- **Goal mode.** No producer. The single match for `goal` is prose inside a `LEAD_GUIDANCE` paragraph at `team-coordination.ts:10`.
- **Todo.** No producer. No match for `todo` under `packages`.
- **Compaction text.** `extension-hooks.ts:395-425` runs `PreCompact` hooks and reports a veto it cannot apply. It emits no model text. A `PreCompact` hook own `additionalContext` is discarded because the `runPoint` result is only inspected for `merged.decision` at `:419`.
- **Session start reminders beyond hooks.** The only session-start text is S3, from a suite `SessionStart` hook. `scoped-contributors.ts:350` skips the startup pass entirely for `clear`, `compact`, and undefined sources.
- **Injection code under plugins/.** The first-party collection ships skills, commands, agents, and workflows. It reaches the model only through S1, S17, S22, and S26. The `plugins/` tree holds no injection code.

---

## Inconsistencies

Each entry is two producers that format the same kind of content differently.

### I1. The precedence sentence uses a different pronoun

`scoped-contributors.ts:59-60`:

```text
Instructions from enabled plugin suites may be relevant to your work. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.
```

`extension-hooks.ts:106-107`:

```text
The following context was injected by an enabled agent plugin suite. It is session instructions, not a message from the user. More specific instructions take precedence over broader ones. It does not override system, developer, or direct user instructions.
```

`They do not override` against `It does not override`. Same rule, different subject and number.

### I2. Two producers register the same section name with different bodies

`scoped-contributors.ts:189-197` registers `name: 'agent-plugins:instructions'` with `agentInstructionSection(...)`, which opens with `## Agent plugin instructions` (`:86`).

`project-runtime.ts:83` registers `name: 'agent-plugins:instructions'` with plain `suiteInstructions` text, which has no heading and no precedence line (`:145`).

Same slot, same order 500, two unrelated body shapes. Only the first has a production caller.

### I3. Two frame producers, one escapes the assembled body and one does not

`extension-hooks.ts:804` builds its frame through `frame(...)`, which runs `escapeFrameBody` over the whole assembled body (`prompt-frame.ts:56-58`).

`subagent-catalog.ts:190-210` and `:220-234` write the `'<system-reminder>'` and `'</system-reminder>'` literals by hand. Entry text is escaped per field through `escapeEntry` ( `:189`, `:227`), but the assembled body never reaches `escapeFrameBody`. `teammate-role-runtime.ts:55` and `:64` do the same.

### I4. Two role catalogs format entries differently

`subagent-catalog.ts:189`:

```text
- `<name>`: <description>
```

`subagent-catalog.ts:227`:

```text
- '<name>': <description>
```

The first uses a Markdown code span. The second uses `JSON.stringify` inside single quotes. The host skill catalog uses the code span form, so S11 is the outlier among three catalogs.

### I5. Heading capitalization differs across the four headings this plugin emits

- `scoped-contributors.ts:86`: `## Agent plugin instructions` (sentence case)
- `team-coordination.ts:51`: `## Team coordination` (sentence case)
- `subagent-catalog.ts:193`, `:223`: `## subagent-catalog` (lowercase, hyphenated)
- `output-styles.ts:56`: `## Output style: ` plus a per-style label (sentence case, colon, variable label)

### I6. Contributor attribution uses one heading level, catalogs use none

`prompt-frame.ts:72` renders every contributor as `### <heading>` inside a section or frame. It is used by S1 (`scoped-contributors.ts:85`) and by S3 and S4 (`extension-hooks.ts:804`).

S10, S11, and S15 list the same kind of item, one contributor per line, with `- ` bullets and no heading (`subagent-catalog.ts:189`, `:227`, `teammate-role-runtime.ts:57-62`).

### I7. Two escaping regimes for authored contributor names

`prompt-frame.ts:69-74` applies `singleLine` (control-character and whitespace collapse) but not `escapeText`.

`subagent-catalog.ts:189` and `:227` apply `escapeEntry`, which is `escapeText` escaping `&`, `<`, and `>`.

A suite name containing `<` is neutralized in a catalog line and left raw in an instruction heading.

### I8. The persona section carries no heading

`role-composition.ts:87` installs the raw card body with no heading. Every other system prompt section this plugin registers opens with a heading: `scoped-contributors.ts:86`, `team-coordination.ts:51`, `output-styles.ts:56`.

### I9. Three intros for one case, three different subjects

- `scoped-contributors.ts:60`: `Instructions from enabled plugin suites may be relevant to your work.`
- `extension-hooks.ts:107`: `The following context was injected by an enabled agent plugin suite.`
- Host `packages/context/agent-instructions/src/render.ts:18-20` (quoted for comparison): `The following workspace instructions may be relevant to your work.`

The two plugin intros differ in what they call the content: `Instructions from enabled plugin suites` against `context was injected by an enabled agent plugin suite`.

### I10. Two bracket-prefix conventions on command descriptions

- `commands-mounts.ts:202`: `[<suite manifest name>] <description>`, the suite name in English from the manifest.
- `user-commands.ts:125-126`: `[<localized source label>] <description>`, the label through `this.t('userCommandSourceLabel')`.

One prefixes a plugin-supplied name, the other a translated constant.

### I11. Two child-creation result strings with different grammar and detail

- `agent-role-router.ts:495`: `started subagent <id>` and `subagent <runId> finished`.
- `teammate-role-tool.ts:48`: `created role teammate <target> on <provider>/<model>`.

The first omits the model route the second prints. One leads with a verb, the other with a verb plus a noun phrase (`created role teammate`).

### I12. Two copies of the member identity text

`team-coordination.ts:42-49` (system prompt section):

```text
You are teammate <name>. Your Team Lead is addressed as "lead".
Use send_message({ target: "lead", message: "..." }) for Lead communication. Use list_agents({}) to identify peers, and their returned targets for peer messages.
```

`teammate-role-runtime.ts:55-64` (framed user message):

```text
You are teammate <name>.
Your Team Lead is addressed as "lead".
Use list_agents({}) to find your teammates and their names.
To message your Team Lead, use send_message({ target: "lead", message: "..." }).
```

Three differences on the same facts: the sentences are merged against split one per line, `identify peers` against `find your teammates and their names`, and the send instruction comes first against last.

### I13. Three session state markers, two mechanisms, one wording pattern

- `extension-session-state.ts:866`: `Session extension selection metadata.` (inject, stays in the inbox until the pre-step filter)
- `extension-session-state.ts:793`: `Session extension selection request.` (inject, then `inbox.remove` at `:797`)
- `extension-session-state.ts:843`: `Session extension readiness restored.` (steer)

All three are plain `Session extension ...` sentences, but only the first is left for the request filter to remove, the second is removed immediately, and the third never enters the log as a pending message.

### I14. Two system prompt sections carry authored text, one escapes it

`output-style-render.ts:38` runs `escapeFrameBody` over the style body even though the section carries no frame, and says why at `:17-19`.

`role-composition.ts:87` passes the card body to `prompt.section` with no escaping at all.

A card body containing `</system-reminder>` reaches the prompt raw. A style body containing it does not.

### I15. Two catalogs open with a blank line after the frame tag, one does not

`frame()` at `prompt-frame.ts:57` joins the body directly after the open tag, so S3 and S4 render `<system-reminder>` on its own line followed immediately by the intro.

`subagent-catalog.ts:191-193`, `teammate-role-runtime.ts:55-57`, and `subagent-catalog.ts:221-223` insert an empty string after the open tag, so those frames open with a blank line.
