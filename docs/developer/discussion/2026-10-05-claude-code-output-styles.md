# Claude Code output styles: implementation mechanism

- Date: 2026-10-05
- Subject: how Claude Code implements `output-style` / the `outputStyle` setting, and the design principles behind it.
- Why it is here: this repository declares `output-styles/` in the Claude Code dialect contract ([spec.md](../../../schemas/claude-code/spec.md)) but mounts no output-style surface at runtime. This note records what the upstream surface actually does, so a later decision to mount it (or not) starts from evidence.
- Evidence classes used below:
  - **BINARY** — read from the shipped Claude Code 2.1.284 bundle (`/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`), the authoritative implementation.
  - **LIVE** — captured from real Anthropic API request bodies by pointing Claude Code at a local mock endpoint and reading the JSON it sent.
  - **DOCS** — an official page on `code.claude.com`.

## Summary

An output style is a Markdown file with YAML frontmatter. Claude Code delivers it over **two channels**:

1. **System prompt, identity line only.** When any style other than `default` is active, the prompt's opening sentence is swapped for a fixed sentence that points at the style. The style's own text never enters the system prompt.
2. **Conversation, full instructions.** The style body is injected into the first user message as a `<system-reminder>` block titled `# Output Style: <name>`, followed by a short per-turn reminder naming the active style.

The style body **replaces** Claude Code's built-in software-engineering instructions unless the style sets `keep-coding-instructions: true`. Because the instructions travel in the conversation layer rather than the system prompt, switching styles mid-session does not invalidate the cached prompt prefix — which is the design's whole point.

## Design principles

- **A style is data, not a code path.** Styles are Markdown plus frontmatter parsed by the same loader and the same frontmatter normalizer that commands, agents, and skills use (BINARY). Built-in styles live in the same name-keyed table as user styles, so nothing downstream special-cases them.
- **Persona switching must be cache-stable.** The expensive, cached part of the prompt is left byte-identical; only the conversation grows. This is what lets a style change apply on the next message instead of requiring `/clear`.
- **Replace by default, keep by opt-in.** A style is assumed to be for work that is not software engineering, so it drops the coding instructions unless the author asks for them back.
- **Reinforce every turn.** A one-shot instruction fades over a long session, so the active style is re-asserted each turn, with a distinct wording for turns that are only waiting on background work.
- **Fail open on parsing, fail closed on selection.** A broken file still loads (minus its metadata) rather than taking the session down; an unrecognized style name resolves to `default` rather than erroring.

## Discovery and loading

### Locations

The CLI scans, in this order (BINARY, confirmed by a `--debug-file` trace showing the stat calls):

| Order | Directory                                                                                                         | Source label      |
| ----- | ----------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1     | `<managed settings dir>/output-styles` — on macOS `/Library/Application Support/ClaudeCode/.claude/output-styles` | `policySettings`  |
| 2     | `<config home>/output-styles` — normally `~/.claude/output-styles`                                                | `userSettings`    |
| 3     | `.claude/output-styles` from every directory between the working directory and the repository root                | `projectSettings` |
| 4     | each enabled plugin's `output-styles/`, or the path(s) its manifest `outputStyles` field names                    | `plugin`          |

The user-level directory is resolved through the same config-home logic as everything else, so a `CLAUDE_CONFIG_DIR` set in user or managed settings is honored (BINARY: the resolved path is also published to host UIs so they can write a user-level style to the right place).

Project scanning walks the ancestor chain and collects **every** `.claude/output-styles` it finds, not just the nearest one.

### File rules

- Only `.md` files are read; a plugin style file is skipped above **1 MiB** (`Npt=1048576`), and directory recursion is capped at depth 32 (BINARY).
- A style's name is its frontmatter `name`, else the filename with `.md` stripped. A plugin style is namespaced `<plugin>:<name>` (BINARY).
- Frontmatter is parsed with `normalizeKeys`, the same normalizer commands, agents, and skills use, so spelling variants such as `keepCodingInstructions` normalize onto the canonical `keep-coding-instructions` key (BINARY).
- Parse failure is non-fatal: the style still loads under its filename with no metadata, and the YAML error is logged for `claude --debug` (BINARY; the docs describe the same behaviour).

### Frontmatter fields

| Field                      | Type    | Meaning                                                                                 |
| -------------------------- | ------- | --------------------------------------------------------------------------------------- |
| `name`                     | string  | Picker label and selection key; defaults to the filename.                               |
| `description`              | string  | Shown in the picker.                                                                    |
| `keep-coding-instructions` | boolean | Keep the built-in software-engineering instructions alongside the style.                |
| `force-for-plugin`         | boolean | Plugin styles only. Apply without user selection, overriding the `outputStyle` setting. |

Frontmatter is validated against a closed shape. Two details differ from what the docs imply: `force-for-plugin` is marked `@internal — only meaningful for plugin-bundled styles; ignored for user styles` in the source, and the warning for setting it on a user style is unreachable, because a user style never carries the field in the first place (BINARY). Unknown keys are also quieter than "reports unknown keys" suggests — the strict parse emits a telemetry event naming each unrecognized key and otherwise proceeds (BINARY).

## Resolution

Two separate lookups happen, and conflating them is the usual source of confusion.

**Which definition wins for a name.** Definitions are merged into one name-keyed table in the order plugins → user → project → policy, so a later source overwrites an earlier one for the same name. The effective precedence is therefore **policy > project > user > plugin** (BINARY). Among nested project directories, the one closest to the working directory wins, which follows from the merge order (BINARY; DOCS state the rule).

**Which style is active.** A plugin style with `force-for-plugin: true` short-circuits everything: if one exists it is used, and the user's setting is never consulted. With several, the first loaded wins and a warning names them. Otherwise the `outputStyle` setting is read through the normal settings stack and looked up by name — and that lookup is **exact and case-sensitive**, so `explanatory` silently yields the default style (BINARY for the exact lookup; DOCS state the case-sensitivity). The `/output-style` command ignores case, so the command and the settings file disagree about `explanatory` (DOCS).

`default` is a real entry that maps to `null`, meaning "no style". There is no `--output-style` CLI flag; the CLI path is `--settings` or a settings file (BINARY and DOCS agree).

## Delivery: what actually reaches the model

This was verified by capturing request bodies, not by reading prose.

**Channel 1 — the system prompt identity line.** The prompt is assembled from a set of blocks. Exactly one line is style-dependent:

```text
no style:   You are an interactive agent that helps users with software engineering tasks.
any style:  You are an interactive agent that helps users according to your "Output Style",
            which describes how you should respond to user queries.
```

Everything else in the system prompt is unchanged. The style's own text is not there.

**Channel 2 — the conversation.** The style body arrives as a `<system-reminder>` in the first user message:

```text
<system-reminder>
# Output Style: Probe Style
MARKER-ALPHA-9377: Always end every reply with the exact token ZQ7.
</system-reminder>
```

followed by a per-turn reminder:

```text
<system-reminder>
Probe Style output style is active. Remember to follow the specific guidelines for this style.
</system-reminder>
```

For a built-in style the reminder carries that style's own one-line summary instead of the generic sentence — the captured Concise run sent `Concise output style is active. Be concise: lead with the result, skip preamble and narration, keep only what the user needs.`, which is the exact `turnReminder` string in the bundle. Proactive additionally has a `waitingTurnReminder` used when the only outstanding work is a background task, telling the model to end its turn rather than poll (BINARY and LIVE agree).

Two guards sit on the reminder: the style name is length-capped at 256 characters, and a name over the cap suppresses the reminder with an error log (BINARY).

**Cache behaviour.** The two cached system blocks are byte-identical across the default, custom, and built-in runs captured here; only the conversation differs. The style instructions sit in the conversation, so a mid-session switch appends rather than rewrites the cached prefix (LIVE; DOCS state the consequence).

### Two tiers of steering

The reminder is a second, independent channel — and built-in styles get a strictly stronger version of it than custom styles do.

A style's `turnReminder` field is populated only in the built-in table. The loader for file-based styles never reads one, so every custom style falls through to the generic sentence. The practical consequence: a user who writes rules stricter than `Concise` still receives weaker per-turn reinforcement than `Concise` does, with nothing in the UI indicating why. That asymmetry is reported upstream in anthropics/claude-code issue #88189.

The two channels are genuinely independent code paths, which is why a style can be half-applied: issue #88592 reports a custom agent suppressing the style body while the per-turn reminder still asserts the style is active. Anything reasoning about "is the style in effect" has to consider both.

### The replace/append rule, measured

Three runs, same prompt, system-prompt block 2 compared (LIVE):

| Configuration                                  | System prompt block 2 | Coding instructions present |
| ---------------------------------------------- | --------------------- | --------------------------- |
| no style                                       | 27,204 chars          | yes                         |
| custom style, no flag                          | 23,940 chars (−3,264) | **no**                      |
| custom style, `keep-coding-instructions: true` | 27,261 chars (+57)    | yes                         |

The `+57` is exactly the identity-line swap and nothing else. In the first case the diff removes the whole `# Doing tasks` section — the rules about scoping changes, not adding unrequested abstractions, not adding speculative error handling, defaulting to no comments, testing UI changes in a browser, and avoiding backwards-compatibility shims.

So "replace" is literal: the coding-instructions block is omitted from the assembled prompt. Note what this means in practice — a custom style that omits the flag removes a substantial amount of engineering discipline, not just tone.

## Built-in styles

Five selectable names: `default` plus four built-ins. All four set `keep-coding-instructions: true`, i.e. they layer on top of the coding instructions rather than replacing them.

| Style | Description | Per-turn reminder |
| --- | --- | --- |
| `default` | No style; standard software-engineering prompt. | — |
| `Proactive` | Executes immediately, minimizes interruptions, prefers action over planning. | `Execute autonomously, minimize interruptions, prefer action over planning.` |
| `Concise` | Responds tersely, leads with results, skips preamble and narration. | `Be concise: lead with the result, skip preamble and narration, keep only what the user needs.` |
| `Explanatory` | Explains implementation choices and codebase patterns. | — |
| `Learning` | Pauses and asks the user to write small pieces of code for hands-on practice. | — |

Only `Proactive` and `Concise` define per-turn reminders; the other two fall back to the generic sentence.

Their prompt bodies (BINARY, verbatim) are each an identity sentence, a `# <Name> Style Active` heading, and a rule list. Proactive's rules end with two guardrails worth noting because they are the style's own restraint, not the permission system's: anything that deletes data or modifies shared or production systems still needs explicit confirmation, and routine messages must not be posted to chat platforms or tickets unless directed. Concise's rules end with a conflict-resolution clause — "Where these rules conflict with more general communication or formatting guidance elsewhere in your instructions, these rules win" — and an explicit carve-out that error reports, failing test output, security warnings, and destructive-action confirmations keep their full content.

Explanatory and Learning share an `Insight` block definition (a boxed 2–3 point explanation delivered in the conversation, explicitly not written into the codebase as comments). Learning adds a "Requesting Human Contributions" protocol: ask for 2–10 line pieces when generating 20+ lines involving design decisions, business logic, or key algorithms; insert exactly one `TODO(human)` marker; stop and wait for the human; then respond with one `Insight`.

## Lifecycle

The feature's history is a cache story (DOCS changelog):

| Version | Change                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------- |
| 1.0.81  | Output styles released, with the Explanatory and Learning built-ins.                                                  |
| 2.0.30  | Deprecated, with users pointed at `--system-prompt-file`, `CLAUDE.md`, and plugins.                                   |
| 2.0.32  | Un-deprecated after community feedback.                                                                               |
| 2.0.37  | `keep-coding-instructions` added to frontmatter.                                                                      |
| 2.0.41  | Plugin support for sharing and installing styles.                                                                     |
| 2.1.73  | `/output-style` deprecated in favour of `/config`, and the style pinned at session start "for better prompt caching". |
| 2.1.94  | `keep-coding-instructions` extended to plugin styles.                                                                 |
| 2.1.178 | Nested `.claude/` directories: the style closest to the working directory wins on a name collision.                   |
| 2.1.237 | `Concise` added.                                                                                                      |
| 2.1.238 | Fixed custom, project, and plugin styles drifting back to the default voice mid-session.                              |
| 2.1.251 | Mid-session switches start applying from the next message.                                                            |
| 2.1.269 | `/output-style [name]` restored, including in headless and Remote Control sessions.                                   |

The 2.1.73 → 2.1.251 → 2.1.269 arc is the instructive part: pinning the style at session start was a caching workaround, and once the conversation-layer delivery made mid-session switching cache-safe the command came back. Proactive has no changelog entry of its own.

### The delivery channel changed, and the docs did not follow

The launch-day documentation described the original design in the opposite terms to today's (archived 2025-08-14, the day 1.0.81 shipped):

> "Output styles directly modify Claude Code's system prompt. Non-default output styles exclude instructions specific to code generation and efficient output normally built into Claude Code (such as responding concisely and verifying code with tests). Instead, these output styles have their own custom instructions added to the system prompt."
>
> "Output styles completely 'turn off' the parts of Claude Code's default system prompt specific to software engineering. Neither CLAUDE.md nor --append-system-prompt edit Claude Code's default system prompt."
>
> "You can think of output styles as 'stored system prompts' and custom slash prompts as 'stored prompts'."

At launch the style body really was a system-prompt section, and the docs said so. In 2.1.284 it is not — it travels in the conversation while only the identity line changes. The style body therefore moved from the system-prompt layer to the conversation layer, which is what made mid-session switching cache-safe and allowed the command to return. The glossary's "aren't part of the system prompt" is accurate about the current build and was not accurate at launch.

`# Output Style: <name>` survives as the renderer for the section in the code path that still assembles it; in the requests this investigation captured, the heading appeared only inside the conversation reminder, and no style body appeared in any system block.

Proactive has no changelog entry of its own, and the mid-session delivery change has no changelog entry either — the docs' "Before v2.1.251" sentence is the only record of it.

## Where the official documentation is incomplete

- The docs describe the style's effect in prose and never say how the replace step is performed. The measured answer is above: the coding-instructions block is omitted at assembly time and the identity line is swapped.
- The glossary states the instructions "aren't part of the system prompt", which is true of the style body and misleading about the identity line — a style does change the system prompt, by one sentence.
- The docs give the nested-project and project-over-user rules but never state the full four-source order; the code settles it as policy > project > user > plugin.
- The literal text of the built-ins is unpublished; it is in this note because it is in the binary.

## How the ecosystem works around it

Two observations from outside the binary shape what a mount would have to cope with.

**Anthropic's own plugins do not use the plugin surface.** In `anthropics/claude-plugins-official`, the two plugins named for built-in styles — `explanatory-output-style` and `learning-output-style` — contain no `output-styles/` directory at all. Each ships a `SessionStart` hook whose handler injects the style text as `additionalContext` (verified against the repository tree). Their READMEs describe them as recreating "the deprecated Explanatory output style as a SessionStart hook", and note that "output styles that involve tasks besides software development are better expressed as subagents, not as SessionStart hooks". The first-party catalog therefore routes around the documented plugin surface, which users separately report as unreliable.

**Nobody else has this surface.** Codex (`AGENTS.md`), Cursor (`.cursor/rules/*.mdc`), and OpenCode (`AGENTS.md`) all use additive instruction files — they append, they do not swap the prompt identity. Kimi is the nearest neighbour, with a system file that overrides the main agent's system prompt, but no named, listable, switchable registry. The gap is visible in the porting: `PerryLink/dsh-output-styles` (13 stars) implements exactly this surface for dsh — session-scoped, runtime-switchable, with a `/style` command and a system-prompt injection — which is a working precedent for the decision this repository faces.

A recurring third-party convention is worth recording because it mirrors what the binary does: real-world styles copy the built-in shape (identity line, `# <Name> Style Active`, then rules) rather than reading like documentation, and at least one collection independently rediscovered the per-turn-reminder asymmetry described above and added a `UserPromptSubmit` hook to close it.

## What this means for this repository

`output-styles/` is already part of the Claude Code dialect contract ([spec.md](../../../schemas/claude-code/spec.md) lists it as a replaced-by-manifest component directory), and the Qoder and Zcode dialects declare the same directory. No runtime surface mounts it: a search of `src/` finds no output-style handling. A suite shipping output styles therefore has its files recognized by the scanner and its styles inert in a dsh session.

Whether to mount it is a separate decision, and the upstream mechanism sets the constraints: a mount has to pick a delivery channel (the style body is conversation-layer text, while the identity line is a system-prompt edit that dsh has no equivalent slot for), decide what to do about the per-turn reminder, and treat `force-for-plugin` as an override the user cannot see in a picker. A style body is instruction text aimed at the model — the same trust question every other injected surface already answers. `PerryLink/dsh-output-styles` is the existing precedent to evaluate against before building anything.

## Evidence index

- Shipped binary: `@anthropic-ai/claude-code` 2.1.284, `bin/claude.exe`; strings extracted to a working file and read with windowed search.
- Live capture: a local mock endpoint (`ANTHROPIC_BASE_URL`) logging request bodies, driven by `claude -p` with `--settings` supplying `outputStyle` and an `env` block. Runs: no style, custom style without the flag, custom style with `keep-coding-instructions: true`, `Concise`, `Proactive`.
- Docs: [output-styles](https://code.claude.com/docs/en/output-styles), [settings-reference](https://code.claude.com/docs/en/settings-reference), [prompt-caching](https://code.claude.com/docs/en/prompt-caching), [glossary](https://code.claude.com/docs/en/glossary), [plugins-reference](https://code.claude.com/docs/en/plugins-reference), [sub-agents](https://code.claude.com/docs/en/sub-agents), [changelog](https://code.claude.com/docs/en/changelog).
