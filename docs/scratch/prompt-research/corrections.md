# Corrections to the research reports

Findings that later measurement revised. Read these before acting on the reports they name.

## 1. `## ` headings are used by Claude Code, but never without a parent `# `

`conformance-gaps.md` item 8 and the ranked-fix note said every Claude Code system prompt section uses a single-level `# ` heading. That is too strong.

Measured in `captures/text/baseline.system.txt`:

```text
81:  # auto memory
89:  ## Types of memory
153: ## What NOT to save in memory
163: ## How to save memories
190: ## When to access memories
196: ## Before recommending from memory
208: ## Memory and other forms of persistence
215: # Environment
```

Six `## ` headings exist, and every one of them sits between `# auto memory` and the next `# ` section. Ten `# ` sections are siblings at the top level.

The rule, stated correctly:

- `# ` opens a top-level section.
- `## ` opens a subsection of the `# ` section immediately above it.
- No `# `-less `## ` appears **inside the system prompt**.

That last clause is narrower than it first looked. Measured in `007-03-plan.json` `messages[0]`, the plan-mode reminder holds `## Plan File Info:`, `## Plan Workflow` and five `### Phase N` with **zero** `# ` lines. A `## ` with no parent `# ` is shipped behaviour outside the system prompt, so there is no global nesting rule.

Consequence for our own prompt: **none.** Section 7 withdraws the promotion this paragraph used to recommend. `## Agent plugin instructions`, `## Team coordination` and `## Output style:` stay exactly as they are, and a `##` without a `#` parent is not drift either, since a shipped reminder does the same.

## 2. The `<system-reminder>` wrapper

`our-injection-inventory.md` and `conformance-gaps.md` disagree about whether the wrapper carries blank lines. The measured form, read from `captures/text/` and the raw bodies, is `<system-reminder>` then the content then `</system-reminder>` on its own line, with no blank line inserted on either side by the wrapper itself. A blank line inside a block comes from the content, not the wrapper.

## 3. The system prompt is three blocks, not one

`claude-code-prompt-architecture.md` describes one assembled prompt. At the wire it is three `system` blocks in the shipped build:

| Index | Content                                                                                 | Cache |
| ----- | --------------------------------------------------------------------------------------- | ----- |
| 0     | A billing header line: `x-anthropic-billing-header: cc_version=...; cc_entrypoint=...;` | no    |
| 1     | The identity line                                                                       | yes   |
| 2     | The whole assembled prompt, 26,995 characters in `003-00-empty.json`                    | yes   |

Block 2 is one block, so the internal blank lines are the only structure the model sees. Block 0 is not instruction at all and is worth knowing about only because it proves the harness can prepend metadata outside the prompt.

Related: several sections that `constants/prompts.ts` lists as separate rows arrive merged into block 2 rather than as separate array elements, because the host joins them before sending.

## 4. The first user message is one content block per reminder, not text joined by `---`

This is the largest correction. Earlier notes said several reminders share one user message, joined by a line containing only `---`. No such separator exists.

Measured: `message[0].content` is an ARRAY of text blocks. One block per reminder, in order, with the person's own text as the final block.

```text
003-00-empty.json  msg0 user blocks=10
   [0] text  789ch  <system-reminder>   # Environment
   [1] text  177ch  <system-reminder>   # model identity
   [2] text  446ch  <system-reminder>   # deferred tools
   [3] text 1880ch  <system-reminder>   # available agent types
   [4] text 6006ch  <system-reminder>   # available skills
   [5] text   86ch  <system-reminder>   # total_tokens
   [6] text  363ch  <system-reminder>   # codebase instructions (CLAUDE.md)
   [7] text   64ch  <system-reminder>   # today's date
   [8] text  582ch  <system-reminder>   # git attribution
   [9] text    5ch  hello                # the user
```

The same shape holds for a subagent (`011-06-subagent.json`, five blocks: environment, identity, role environment, date, task text) and for an appended-system-prompt session (`021-11-thinking.json`, ten blocks).

The `---` lines in `captures/text/*.messages.txt` come from the extractor that joined blocks for readability. They are not on the wire.

The rule, stated correctly: **the content-block array is the separator.** A producer that must add several independent facts to a user message adds several blocks, not one string with dividers.

Consequence for us: our `agent.inject` and `agent.steer` seams hand the host text, so a session-start context becomes one block however we format it. Where we already emit one block, the honest target is the reminder frame plus a labelled first line, not an invented divider.

## 5. Cache placement

Measured on `006-02-bash.json`:

| Position      | Content                           | `cache_control`   |
| ------------- | --------------------------------- | ----------------- |
| `system[0]`   | billing header                    | none              |
| `system[1]`   | identity line                     | `ephemeral`       |
| `system[2]`   | the assembled prompt              | `ephemeral`       |
| `messages[0]` | the nine reminders plus user text | none on any block |
| `messages[2]` | the tool result                   | `ephemeral`       |

So the breakpoint sits at the end of the system prompt and again at the newest tool result. Per-block cache markers inside the first user message are absent, which means that message is cached as part of the following segment rather than on its own.

## 6. One more heading detail, because it changes a summary line

`wire-captures.md` section 10 item 1 says every system prompt section is `# Name` and "no block contains two sibling `# ` headings". The second half is false, and the first half is true only per section.

The assembled system prompt is a single block (26,995 characters in `003-00-empty.json`; `004-01-memory.json` is one character shorter because its working directory path is), and it contains ten `# ` sections plus six `## ` subsections, all six under `# auto memory`. So a block can hold many `# ` siblings; it is the per-section pattern that stays consistent: one `# ` opens a section, `## ` only appears inside one.

Read item 1 together with section 1 of this file and the rule in section 1 above.

## 7. Withdrawn: promoting our sections to `# `

Section 1 of this file recommended promoting `## Agent plugin instructions`, `## Team coordination` and `## Output style:` to `# `. That recommendation is withdrawn. Do not change a heading level in our producers.

Claude Code authors its entire system prompt, so `# ` is top level there. Our plugin authors nothing of the sort: it contributes sections to a prompt the host assembles, and the host's own multi-paragraph contributions use `## `.

| Host producer                                               | Heading it emits                |
| ----------------------------------------------------------- | ------------------------------- |
| `packages/compaction/compaction-basic/src/summarizer.ts:37` | `## Primary Request and Intent` |
| `packages/mcp/mcp-resources/src/index.ts:66`                | `## MCP resource servers`       |
| `packages/typert/generator/src/cordis-catalog.ts:1021`      | `## Cordis API`                 |

The host's identity section is a bare sentence with no heading (`packages/core/system-prompt/src/index.ts:450-455`), and `joinContextSections` joins sections with a blank line (`:314-315`). The assembled prompt therefore has no single top-level document. A `# ` from us would outrank every host section beside it, which is worse than the level we use today.

The measured rule that transfers is level nesting, not absolute level: a subsection needs a parent one level above. Our sections already satisfy it, since `### <suite>` sits under `## Agent plugin instructions`.

So the accurate statement of the gap is narrower still: our heading levels match the host, and only the text inside our sections is out of step with Claude Code.

## 8. Withdrawn: the `IMPORTANT:` precedence rewrite

`conformance-gaps.md` ranked fix 4 proposed replacing our precedence sentence with Claude Code's `IMPORTANT: These instructions OVERRIDE ...`. Withdrawn.

Our sentence mirrors the host's own workspace-instruction intro, which sits in the same request:

```text
packages/context/agent-instructions/src/render.ts:18-20
const AGENT_INSTRUCTIONS_INTRO = 'The following workspace instructions may be relevant to your work. '
  + 'Use them as guidance when applicable. More specific instructions take precedence over broader ones. '
  + 'They do not override system, developer, or direct user instructions.'
```

The host uses no `IMPORTANT:` anywhere in injected instruction content: zero hits across `packages/`, excluding tests, libraries and experimental trees. Claude Code can assert an override because it authors every section of its own prompt and has nothing above it to defer to. We do not.

Two strength claims about the same content class in one request, one hedged from the host and one absolute from us, is worse for the model than a slightly softer phrase that agrees with its neighbour.

The shape still transfers, and both sources agree on it: name the source, blank line, body. The host writes `Instructions from: ${displayPath}` and Claude Code writes `Contents of ${path} (${type}):`. Either satisfies the measured convention.

Nothing else in this file is affected. The hook labelling, command metadata, notification, and invented-tag fixes stand.

## 9. Two more claims this file left standing, both false

An independent verification pass re-measured the reports and found two statements that survived the earlier corrections but should not have.

### The system prompt is not tag-free

`conformance-gaps.md:25` says the system prompt has no tags at all. Only the heading half of that sentence was ever retracted. Measured in `003-00-empty.json` `system[2]`: 59 tag occurrences across 40 lines, including a real XML taxonomy block (`<types>` -> `<type>` -> `<name>`, `<description>`, `<when_to_save>`, `<how_to_use>`, `<examples>`), a `<body_structure>` element, and a trailing `<total_tokens>15000000 tokens left</total_tokens>` as the last line of the prompt.

Corrected: the system prompt is mostly Markdown, with one XML taxonomy block and one trailing token counter. A tag anywhere in it is not automatically drift, but every tag in it describes structure inside the prompt rather than labelling injected content, which is the distinction our rules actually need.

### Nesting reaches four, not two

`wire-captures.md` section 10 item 7 says nothing in the capture set is three deep. Two counter-examples:

- `003-00-empty.json` `system[2]`: `<types>` -> `<type>` -> `<name>`, depth three.
- `013-06-subagent.json` `messages[2]`: `<system-reminder>` -> `<task-notification>` -> `<usage>` -> `<subagent_tokens>`, depth four.

Corrected: depth reaches at least four in shipped output.

## 10. Two of the withdrawn items were not actually withdrawn, and one was

`corrections.md` section 8 says three fixes were withdrawn. That count is wrong in both directions.

- **Withdrawn, confirmed:** the `# ` promotion and the `IMPORTANT:` rewrite. Both were re-verified: the host's own section contributions are mostly bare prose (`packages/core/system-prompt/src/index.ts:450-455` emits `'You are an AI agent powered by DeepSeek Harness.'`), and the host uses no `IMPORTANT:` anywhere outside tests.
- **Not withdrawn:** the `Contents of <path> (<type>):` shape. Section 8 closes by saying the shape still transfers, so the underlying fix stays open. Our producer still emits a bare `### <suite>` heading, which is neither the host shape nor the reference shape.

So the count to remember is one shape still open for a contributor label, one heading decision closed in favour of the status quo, and one precedence decision closed in favour of mirroring the host.
