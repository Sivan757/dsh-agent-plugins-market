# Agent Note: Frame, escape and attribute every injected prompt block

Status: implemented

## Problem

The owner asked whether every feature injects into the host prompt in line with best practice: is there a `<system-reminder>`, are there XML emphasis blocks. An audit found two producers that do not answer that question the same way as the host.

Suite instructions reached the system prompt as one unattributed blob (`runtime/host/scoped-contributors.ts` joined `mount.instructions` with blank lines). Two suites that disagree were indistinguishable, and no precedence line said which wins. No installed suite declares `systemPrompt` today, so the defect was latent rather than live.

Hook context reached the transcript as bare user prose (`runtime/surfaces/extension-hooks.ts` `contextFrom`). A suite hook delivers its whole instruction payload this way: the real `learning-output-style` and `explanatory-output-style` suites on this machine push a 3208-byte mode instruction through a `SessionStart` hook, and it arrived looking like something the user typed.

Nothing escaped. The only escaper in the repository was a local copy inside `subagent-catalog.ts`, used in one file. A suite body containing `</system-reminder>` could close a frame it did not open.

## Decision

One module owns framing, escaping and attribution: `packages/market-runtime/src/runtime/surfaces/prompt-frame.ts`. It exports the frame constants, `escapeFrameBody`, `frame`, `attribute`, and `escapeEntry`. Every producer-framed site calls it.

The host's own decisions define the rules, and they are written down in `docs/reference/prompt-injection-conventions.md`:

- R1 the producer frames its own content, because the session surface passes injected content through verbatim.
- R2 `<system-reminder>` is for durable, session-stable instruction content only.
- R3 no tag that no model was trained on.
- R4 escape `</system-reminder>` in every framed body, before byte accounting.
- R5 attribute contributors, one heading each, plus one precedence line.
- R6 user input stays unframed.
- R7 a system prompt section takes a Markdown heading, never a frame.

Applied:

- The suite instruction section is now `## Agent plugin instructions`, a precedence sentence, and one `### <suite>` heading per contributor. A suite that contributes both a system prompt and a startup skill reads as one block. `renderPrompt` joins sections with blank lines and adds no heading (`packages/core/system-prompt/src/index.ts:290-295`), which is why the structure has to be inside the section.
- Hook context is split by durability. `SessionStart` and `UserPromptSubmit` context is durable session instruction, so it becomes one framed message with an intro, a precedence sentence, and one heading per contributing suite. `PreToolUse`, `PostToolUse`, `PostToolUseFailure` and `SubagentStart` context stays plain, one block per contributor. `Stop` steering and corrective feedback stay plain.
- Attribution needed the identity the merge discards, so `collect` now returns each decoded output with its suite label, and `PointOutcome` carries the attributed contexts beside the merged decision.
- `subagent-catalog.ts` imports `escapeEntry` instead of keeping a private copy, and that helper delegates to the host's published `escapeText` from `@deepseek-ai/dsh-skill`, the same function the host skill catalog uses on every entry.
- `team-coordination.ts`, `role-composition.ts`, `extension-session-state.ts` and `commands-mounts.ts` already conform. They are unchanged and pinned by tests.

## Why not the alternatives

- **Frame everything, including steering.** Rejected: the harness recorded a transcript where a model read a labeled `<steering>` note as third-party metadata and refused it. That is the exact failure mode, and it is why the surface-level envelope was deleted upstream.
- **Frame the system prompt section too.** Rejected by R7. The section is already system weight, so a frame adds weight to weight and gains nothing that a heading does not.
- **Invent an `<agent-plugins-instructions>` tag to mark plugin content as distinct.** Rejected by R3. A tag no model was trained on adds tokens with no reliable effect, which is the reason the upstream envelopes were removed.
- **HTML-escape every framed body.** Rejected: it would corrupt Markdown a suite deliberately wrote, such as a heading or a code fence. Only the closing marker is escaped, which is exactly what the host producer does.
- **Keep one escaper per caller.** Rejected: that is how the repository ended up with a private copy in `subagent-catalog.ts` and nothing anywhere else.
- **Preserve the old plain text and add the frame beside it.** Rejected: the point is to change the shape once, not to ship both.

## Consequences

- A framed suite instruction now reads as injected context with a stated precedence, and two suites stay separable.
- The added cost is the frame itself. Measured on the real `learning-output-style` `SessionStart` payload: 3208 bytes of hook text became 3530 bytes, so 322 bytes more, about 10 percent. 256 of those bytes are the intro sentence, the rest are the frame markers and the suite heading.
- Content, gating and timing are unchanged. The only new bytes are the frame, the intro and the attribution headings.
- A suite whose body contains a closing marker sees it rendered as `<\/system-reminder>`. That is a visible change to text no installed suite writes today.
- The system prompt section gains headings. A suite that reads its own position in the prompt by counting blank lines would notice, and no suite does that.
- Escaping and framing live in one module, so a future producer cannot reintroduce the private-copy defect without deleting the import.

## Testing

`packages/market-bundle/test/integration/prompt-frame.test.ts` covers the module: a closing marker is escaped, an already escaped one is idempotent, the frame markers sit on their own lines, sole closing marker after framing means one, an empty section contributes nothing, a heading stays on one line, and entry escaping matches the host.

`packages/market-bundle/test/integration/prompt-injection-conventions.test.ts` maps one case to each rule:

| Rule  | Case                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1    | a hook `SessionStart` context arrives framed                                                                                                            |
| R2    | a user prompt context is framed and a `Stop` reason is not, and a `PreToolUse` context stays plain                                                      |
| R3    | the only angle-bracket tags in section and catalog text are the frame, `<available_skills>`, `<available_subagents>` and `<skill_content>`              |
| R4    | a closing marker inside suite hook context is escaped                                                                                                   |
| R5    | two hook suites are separable by heading, and two instruction suites carry headings plus a precedence line                                              |
| R6    | a user-authored command body reaches the model with no frame and no heading                                                                             |
| R7    | the instruction section starts with a Markdown heading and contains no frame, an empty section renders nothing, and a blank body contributes no heading |
| GAP D | the plain producers import no frame module, the team section keeps `## Team coordination`, and the session-state markers stay plain                     |
