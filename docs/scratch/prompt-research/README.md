# Prompt research: what Claude Code teaches a model

Claude Code 2.1.308 was installed, driven against a local mock of the Messages API, and every request body it sent was captured. Three studies ran against that evidence plus the restored 2.1.88 sources. This directory is the result.

## Read in this order

| File                                 | What it answers                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `captures/README.md`                 | How the bodies were captured, and which scenario shows which feature                                                     |
| `captures/text/`                     | The extracted system prompt, messages and tools of each capture                                                          |
| `wire-captures.md`                   | A field guide to the wire format: block order, every reminder kind verbatim, memory and hook framing, subagent envelopes |
| `claude-code-prompt-architecture.md` | The same questions answered from the restored 2.1.88 sources, with `file:line` citations                                 |
| `our-injection-inventory.md`         | Our 26 injection sites, with producer `file:line` and the exact text each emits                                          |
| `conformance-gaps.md`                | Site-by-site verdict against Claude Code, then 15 ranked fixes with the replacement strings                              |
| `corrections.md`                     | Where later measurement revised the reports. **Read this before acting on anything above**                               |

The captures outrank the sources where they disagree: the captures are what the shipped CLI sends.

## What the evidence says a model learns to recognize

Ten habits, all measured, all things a model would generalize from a large training corpus of Claude Code transcripts.

1. **The system prompt carries no tags at all.** It is Markdown: ten `# ` sections, six `## ` subsections all under `# auto memory`, bullets, prose paragraphs. The one tag-like element sits at the very end and is a token counter.
2. **Tags live in the conversation, not the instructions.** Environment facts, memory files, the skill list, the agent-type list, the token budget and the date all arrive as `<system-reminder>` blocks in a user message.
3. **The first user message is mostly not the user.** Its `content` is an array of text blocks: one `<system-reminder>` block per fact, and the person's own words as the last block. The block boundary is the separator; no divider line is sent.
4. **Bullets are a space, a dash, a space.** Nested items are two spaces then a dash. This prefix repeats across every list in the prompt.
5. **Hard rules start with `IMPORTANT:`.** Precedence is asserted, not hedged: `IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.` A contributor to someone else's prompt cannot copy this, because the host has already ranked the same content one notch lower.
6. **A file's content is named before it is shown:** `Contents of <path> (<type>):`, then a blank line, then the body.
7. **Hook output is always event-labelled:** `<Event>[:<matcher>] hook <status>: <content>`, with statuses `success`, `error`, and `additional context`.
8. **A subagent's prompt is the role text plus a scope paragraph plus a `Notes:` bullet list.** The scope paragraph says whose messages count as authority.
9. **Tool results come back labelled by call and version:** `[tool_result <id>]` carries the data, and a trailing reminder carries the budget. Background work reports through a `<task-notification>` envelope with `<task-id>`, `<status>`, `<result>` and `<usage>`.
10. **Emphasis is positional, not typographic.** No bold inside instructions, no emoji, no coloured prose. The only intensifier is the leading `IMPORTANT:` and the only structural marker is the heading.

## What we adopt

The rules below extend `docs/reference/prompt-injection-conventions.md`. Each one is measured, not asserted.

| Rule | Statement |
| --- | --- |
| M1 System sections stay structural | A `systemPrompt.section` is Markdown: a heading at the level its parent uses, `-` bullets, prose. A tag is not automatically drift: the reference prompt itself carries one XML block and a token tag (see `corrections.md` section 9) |
| M2 Reminders carry the non-instruction facts | Environment, memory, catalogs, budget and date go in `<system-reminder>` blocks in a user message |
| M3 One block per fact | Several reminders share one user message as separate content blocks, user text last. Never simulate this with a divider line |
| M4 Precedence is host-owned | The host states scope once, hedged, for workspace instructions. A contributor mirrors that sentence instead of asserting a stronger override in the same request |
| M5 Name then show | A file or a contributor is named before its body. Two measured shapes qualify: `Contents of <name> (<type>):` and the host's `Instructions from: <path>`. Our producers still emit a bare contributor heading |
| M6 Event-labelled hook output | `<Event>[:<matcher>] hook <status>: <content>`, never a bare paragraph. Measured statuses: `success`, `additional context`, `error` |
| M7 Nest, do not re-rank | A subsection needs a parent one level above it, where a parent exists. Our plugin contributes sections to a host prompt whose own sections are `## `, so we keep `## ` and never claim `# ` |
| M8 One list form | Catalogs render `- <name>: <description>`, unquoted, with no nested tag wrapper |

## What we deliberately keep

Three of our sites already match and must not be "fixed":

- A role card body as the persona section: a Claude Code subagent prompt is the role text with no heading and no wrapper.
- MCP tool descriptions passed through unchanged: Claude Code does the same.
- Skill candidate name and description rendered by the host: same shape as the host catalog.

## Method notes

This environment has no working upstream account, so the capture target is a mock. That measures what Claude Code builds, never how a model answers. The mock answers each request from a script, so tool results, hook context and subagent traffic all appear as they would in a real session.

Claude Code was installed at 2.1.292 and upgraded to 2.1.308 with `brew upgrade claude-code` before capturing, so the bodies match the current release rather than the restored 2.1.88 tree.
