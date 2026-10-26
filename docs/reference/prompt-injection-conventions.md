# Prompt injection conventions

This page states how this plugin frames the content it puts into a model request. One module owns the decision: `packages/market-runtime/src/runtime/surfaces/prompt-frame.ts`.

The host passes injected content through verbatim, so a producer owns all framing of its own text. The harness recorded that decision in [the injected-content-envelopes note](https://github.com/deepseek-ai/deepseek-harness/blob/main/.agents/notes/archived/simplification/2026-07-20-unwrap-injected-content-envelopes.md). It removed the arbitrary `<steering>` and `<context>` tags, because no model was trained on them, and one recorded transcript shows a model treating a `<steering>` instruction as third-party metadata and refusing it.

## The rules

| Rule | Statement |
| --- | --- |
| R1 Producer-owned framing | The plugin frames its own content. Never rely on the surface to wrap it. |
| R2 Frame durable instruction only | Use `<system-reminder>` for durable, session-stable instruction content. A transient notice, a steering reason, and a one-shot callback stay plain prose. |
| R3 No invented tags | Only the familiar frame and the emphasis tags the ecosystem already uses. No `<agent-plugins-...>`. |
| R4 Escape before accounting | Escape `</system-reminder>` in every framed body, before any byte accounting. |
| R5 Attribute contributors | Two suites in one block stay separable: one heading per contributor, plus one precedence line. |
| R6 User input stays unframed | A user-authored command body and a user command panel entry are never wrapped. |
| R7 A section is system weight | A system prompt section takes a Markdown heading, never a frame. `renderPrompt` joins sections with blank lines and adds no heading of its own. |

## Injection sites

| Site | Mechanism | Form | Why |
| --- | --- | --- | --- |
| `runtime/host/scoped-contributors.ts` `agentInstructionSection` | `systemPrompt.section` | Markdown section: `## Agent plugin instructions`, one `### <suite>` per contributor | R7 and R5. It is already system weight, so a frame would add weight to weight while `renderPrompt` adds no structure of its own. |
| `runtime/surfaces/extension-hooks.ts` `contextFrom(…, true)` for `SessionStart` and `UserPromptSubmit` | `agent.inject` or the entering step messages | Framed, one `### <suite>` per contributor, escaped | R2, R4, R5. Durable session instruction, and it arrives looking like a user turn without a frame. |
| `extension-hooks.ts` `contextFrom(…, false)` for `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart` | `agent.inject` or the downstream decision | Plain, one block per contributor | R2. A per-call callback is not standing instruction. |
| `extension-hooks.ts` `contextFromReason` and the `Stop` steering | `agent.steer` | Plain | R2. Steering that is labeled is what the recorded transcript refused. |
| `runtime/agents/subagent-catalog.ts` `renderCatalogText` | `agent.inject` | Framed, with `<available_subagents>` entries escaped through `prompt-frame.ts` | Matches the host skill catalog. The local escaper was a second copy of the host's. |
| `runtime/agents/team-coordination.ts` | `systemPrompt.section` | `## Team coordination` Markdown section | R7. The pattern the instruction section follows. |
| `runtime/agents/role-composition.ts` `roleChildNotice` | `inject` on the child | Plain | R2. A one-sentence binding statement the model reads, not instruction content. |
| `runtime/host/extension-session-state.ts` wake and intent markers | `inject`, `steer` | Plain, `form: 'context'` | Metadata about the plugin's own state, not instructions. |
| `runtime/surfaces/commands-mounts.ts` command body | `agent.followup` | Plain user message | R6. The user authored it, so it keeps user weight. |

## The frame

The frame is the one the harness's workspace-instruction producer emits, at `packages/context/agent-instructions/src/render.ts:304-317`:

```text
<system-reminder>
<escaped body>
</system-reminder>
```

The body opens with an intro that says what the text is and its precedence. Each contributor starts with a heading. The skill catalog at `packages/skill/tool-skill/src/index.ts:256-310` uses the same frame plus `<available_skills>`, and escapes every entry it prints. That entry escaper is `escapeText` from `@deepseek-ai/dsh-skill`, which this plugin now calls instead of keeping its own copy.

## Escaping

`escapeFrameBody` replaces a closing marker with `<\/system-reminder>`. The escaped form reads the same and cannot close the frame. An already escaped marker is left alone, so the function is idempotent and no text gains backslashes.

Escaping runs inside `frame`, after the caller assembles the body. Any byte accounting the caller does on the framed result therefore includes the escaped bytes.

## Related

- [Host foundation map](host-foundation-map.md) lists the host packages this plugin rides.
- `.agents/notes/implemented/feature/2026-10-26-prompt-injection-conformance.md` records why the frame stops where it does.
