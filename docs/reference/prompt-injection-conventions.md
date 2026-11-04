# Prompt injection conventions

This page states how this plugin frames the content it puts into a model request. One module owns the decision: `packages/market-runtime/src/runtime/surfaces/prompt-frame.ts`.

The host passes injected content through verbatim, so a producer owns all framing of its own text. The harness recorded that decision in [the injected-content-envelopes note](https://github.com/deepseek-ai/deepseek-harness/blob/main/.agents/notes/archived/simplification/2026-07-20-unwrap-injected-content-envelopes.md). It removed the arbitrary `<steering>` and `<context>` tags, because no model was trained on them, and one recorded transcript shows a model treating a `<steering>` instruction as third-party metadata and refusing it.

## The rules

| Rule | Statement |
| --- | --- |
| R1 Producer-owned framing | The plugin frames its own content. Never rely on the surface to wrap it. |
| R2 Frame durable instruction only | Use `<system-reminder>` for durable, session-stable instruction content. A transient notice, a steering reason, and a one-shot callback stay plain prose. |
| R3 No invented tags | Only the familiar frame and the emphasis tags the ecosystem already uses. No `<agent-plugins-...>` and no `<available_subagents>`. |
| R4 Escape before accounting | Escape `</system-reminder>` in every framed body, before any byte accounting. |
| R5 Attribute contributors | Two suites in one block stay separable: one label per contributor naming its source and kind, plus one precedence line. |
| R6 User input stays unframed | A user-authored command body and a user command panel entry are never wrapped in a frame. Command metadata around the body is allowed. |
| R7 A section is system weight | A system prompt section takes a Markdown heading, never a frame. `renderPrompt` joins sections with blank lines and adds no heading of its own. |

## Injection sites

| Site | Mechanism | Form | Why |
| --- | --- | --- | --- |
| `runtime/host/scoped-contributors.ts` `agentInstructionSection` | `systemPrompt.section` | Markdown section: `## Agent plugin instructions`, the precedence sentence, then `Instructions from: <suite> (<kind>):` and the body | R7 and R5. It is already system weight, so a frame would add weight to weight while `renderPrompt` adds no structure of its own. The contributor label matches the host's own `Instructions from: <path>` shape, and the kind separates a startup skill from a system prompt. |
| `runtime/surfaces/extension-hooks.ts` `contextFrom(…)` for `SessionStart` and `UserPromptSubmit` | `agent.inject` or the entering step messages | Framed, led by `<Event>[:<matcher>] hook additional context:`, one `### <suite>` per contributor, escaped | R2, R4, R5. Durable session instruction, and the label is what tells a session-start rule from a mid-turn callback. |
| `extension-hooks.ts` `contextFrom(…)` for `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart` | `agent.inject` or the downstream decision | Plain, led by `<Event>[:<tool>] hook additional context:`, one block per contributor | R2. A per-call callback is not standing instruction, but unlabelled text from a hook is what a model reads as user speech. |
| `extension-hooks.ts` `contextFromReason` | `agent.inject` | Plain, led by `<Event> hook error:` | R2. A blocked call keeps the label because that is when a model must not mistake a hook for its user. |
| `extension-hooks.ts` the `Stop` steering | `agent.steer` | Plain and labelled `Stop hook feedback:\n<text>`, or `Stop hook additional context: <text>` for context | R2 forbids a frame on steering, because a framed steering note is what the recorded transcript refused. A plain label is not a frame, and it tells the model the text came from a hook. |
| `runtime/agents/subagent-catalog.ts` `renderCatalogText` | `agent.inject` | Framed, one unquoted `- <name>: <description>` line per role, no nested tag, escaped through `prompt-frame.ts` | Matches the reference agent list. The nested `<available_subagents>` wrapper and the inner heading were a second naming system for one block. |
| `runtime/agents/team-coordination.ts` | `systemPrompt.section` | `## Team coordination` Markdown section | R7. The pattern the instruction section follows. |
| `runtime/agents/role-composition.ts` `roleChildNotice` | `inject` on the child | Plain, two sentences stating the binding | R2. It states what directs the child, never the persistence mechanism the child cannot act on. |
| `runtime/host/extension-session-state.ts` selection, intent and wake markers | `agent.inject`, `agent.steer` | No content blocks at all, with the source kind carrying the record | They record a durable event and are removed before a request. An empty carrier cannot be read if the filter ever misses. |
| `runtime/surfaces/commands-mounts.ts` and `runtime/panels/user-commands.ts` command body | `agent.followup` | Plain user message wrapped in `<command-message>`, `<command-name>`, optional `<command-args>`, then a rule, the body and an optional `ARGUMENTS:` line | R6. The body keeps user weight, so no frame. The metadata tells the model a slash command ran and which element holds the argument. |
| `runtime/agents/agent-role-router.ts` and `teammate-role-tool.ts` tool descriptions | Tool schema | A purpose line, one blank line, then `-` bullets and an optional `## Writing the prompt` section | The measured Claude Code tool-description shape. A single paragraph of rules gets skimmed, and its skip rules are the part a model needs. |

## The frame

The frame is the one the harness's workspace-instruction producer emits, at `packages/context/agent-instructions/src/render.ts:304-317`:

```text
<system-reminder>
<escaped body>
</system-reminder>
```

The body opens with a lead line, then one heading per contributor. The lead line names the injection source: an event name for hook output, an intro sentence for standing instruction.

The skill catalog at `packages/skill/tool-skill/src/index.ts:256-310` uses the same frame plus `<available_skills>`, and escapes every entry it prints. That entry escaper is `escapeText` from `@deepseek-ai/dsh-skill`, which this plugin now calls instead of keeping its own copy.

Measured against Claude Code 2.1.308 (see `docs/scratch/prompt-research/wire-captures.md`): the wrapper is `<system-reminder>` then the body then `</system-reminder>` with no blank line the wrapper itself inserts, a first user message carries one reminder per content block rather than one joined string, and every tag the model sees is a wrapper around content rather than a name invented for it.

## Escaping

`escapeFrameBody` replaces a closing marker with `<\/system-reminder>`. The escaped form reads the same and cannot close the frame. An already escaped marker is left alone, so the function is idempotent and no text gains backslashes.

Escaping runs inside `frame`, after the caller assembles the body. Any byte accounting the caller does on the framed result therefore includes the escaped bytes.

## Related

- [Host foundation map](host-foundation-map.md) lists the host packages this plugin rides.
- `.agents/notes/implemented/feature/2026-10-26-prompt-injection-conformance.md` records why the frame stops where it does.
