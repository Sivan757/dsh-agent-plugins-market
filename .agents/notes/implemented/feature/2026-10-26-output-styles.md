# Agent Note: output styles are captured text, never a program run on read

Status: implemented

## Problem

The owner asked for an Output Styles tab. An output style is a named block of instruction text that changes how the model answers: concise, explanatory, teaching by asking. In Claude Code it is a setting whose text joins the system prompt.

Three things make this more than a text field.

First, the sources differ in trust. A style this repository ships is reviewed here. A style a person writes is their own. A style a market suite delivers arrives as the output of a program the suite supplies, run when a session starts.

Second, a suite style cannot be read without running that program, and a page must not run a suite's program while someone scrolls a list.

Third, whatever is chosen changes every answer in the workspace, so a person has to be able to see exactly what enters their prompt before it does.

## Decision

A style is a record: `{ id, label, description, body, source }` with `source` one of `builtin`, `user`, `suite`. Exactly one is selected per workspace, stored in its own document, and injected as one system-prompt section. The default style carries an empty body and renders no section at all, so turning styles off is a selection rather than a separate switch.

**Builtin styles ship as Markdown** under `plugins/output-styles/styles/`, inside the Agent Plugins v1 plugin the first-party collection already lists. The runtime reads them through the same package-root walk the vendored schemas use, and `plugins/output-styles` is a `files` entry so a tarball carries them. A guard test fails when the shipped directory or the `files` coverage drifts, because the default style lives there and losing it would leave the page without the way to turn styles off.

**User styles are Markdown files** under `<Agent layout root>/output-styles/<name>.md`, carried by frontmatter `description:` and the body below it. The name is validated as a file stem, and the resolved path is checked to stay inside the style directory, so a create can never write outside it.

**Suite styles are captured, never run on read.** The tab lists every enabled suite that declares a SessionStart command, with a fingerprint of its address, manifest version, root and exact commands. Selecting one requires a capture, and a capture runs those commands once through the existing bounded dry run: home directory, declared timeout capped at 60 seconds, 32 KB per stream. The text is parsed from `hookSpecificOutput.additionalContext`, or accepted as plain prose when a hook prints prose.

The capture is stored with the fingerprint it came from. A suite that changes no longer matches, so the row reports the capture as stale, injects nothing, and offers to capture again. Replay of text nobody re-approved is the failure this prevents, and it is why the fingerprint exists rather than a simple "captured once" flag.

The fingerprint deliberately does not hash the hook script's own bytes. That would mean reading arbitrary executables on every list read, and a suite that edits a script without changing its declaration or version is caught the next time a person captures, which the page always offers. The trade is stated here so nobody adds a content hash believing it was an oversight.

**The section is per agent, never global.** A selection belongs to a workspace, each agent runs in one workspace, and a child can run in another, so a global section would hand a child its parent's style. `agent/created` installs one section on that agent's own scope and `agent/disposed` releases it.

The section is registered with `interpolate: false`. A style is authored text: the host resolves `{{...}}` by default and fails assembly on a name it does not know, which a style quoting a prompt variable would trigger.

Its order is a fixed 490. The host allocates 0 to the deployment persona prefix, 500 to plan policy and 600 to team policy, so a style belongs with those behavioural instructions and ahead of the tool descriptions that start at 1000. Ten below the nearest named slot keeps it off that value, because an equal order falls back to code-unit name order, which would make a style's position depend on its name.

**The rendered text is a heading plus the body verbatim:**

```text
## Output style: <label>
<body>
```

The heading is part of the text because the host joins sections with a blank line and adds no heading of its own, so without it two blocks of instructions would run together. The body is escaped for `</system-reminder>` even though a system prompt has no such frame: the escape costs one substitution and removes a class of injection from any future reuse of the same text inside a user-role frame.

The body is not wrapped in `<system-reminder>`. That frame belongs to durable workspace-instruction messages, where the model is told the text is context rather than a standing instruction. A system-prompt section already carries system weight, and wrapping it would say the opposite of what the section is.

The rendering lives in `market-contracts`, imported by both the server and the page, so the preview is byte for byte the text the prompt receives rather than a second implementation of the same idea.

**State is its own document** at `output-style/<sha256(workspace).slice(0,24)>.json`, holding `{ version, workspace, styleId, captured? }`, read-modify-write under the host file lock and written atomically. A sibling of the tab layout rather than a section of it: one writer per file is what keeps two surfaces from clobbering each other. The read is tolerant: an unparsable document or an id that no longer names a style resolves to the default selection, because that is the safe direction for prompt contribution nobody can see.

## Alternatives considered

**Run the suite's SessionStart hook on every read, so the text is always current.** It would remove the stale state and the capture action entirely. It would also run a third party's program whenever a page is opened, with no user action and no bound on how often, and the text that shapes every answer would be whatever the last run printed. The explicit capture is the whole safety property.

**Treat any session whose hooks include SessionStart as an output style.** Simpler to justify, and wrong: most SessionStart hooks load context for the session, not a style, and the page would invite people to inject a project's setup notes as their answer style. Only suites a person captures become styles, and the preview shows what they agreed to.

**Store the selection inside the workspace policy document.** Fewer files. It would make one document serve two owners, so a policy write and a style selection would race on the same bytes and one would be lost. The tab layout made the same call for the same reason.

**Register one global section and read the workspace per assembly.** One registration instead of one per agent. It breaks for any child agent that runs in a different workspace, and the host assembles a prompt without awaiting a disk read, so the workspace has to be fixed when the section is installed.

**Hash the hook script's bytes into the fingerprint.** Catches an edited script without a version bump. It would read an arbitrary executable on every list read, for a case the always-available capture action already covers, and it would make a suite's own cache files count as a style change.

**Wrap the body in `<system-reminder>` for consistency with workspace instructions.** It reads as the plugin being cautious about text it is already putting into the system prompt. The frame tells the model the text is context, which would weaken the instruction it is meant to be.

**Let the page run a capture implicitly when a suite style is selected.** One click instead of two. It hides a program run inside a selection and lets text reach the prompt that no one read in the preview, which is the thing this feature is for.

## Testing

`packages/market-runtime/test/output-styles.test.ts` covers the section rendering (heading plus body, empty default contributing nothing, the reminder-tag escape, the order placing it clear of the named slots), the document (round trip, unparsable read, a capture kept only while its own suite stays selected, two concurrent writers serialized), the list (unknown id falling back to the default, trust order across the three sources, the file-stem rule), suite styles (capture bound to a fingerprint, staleness after the suite changes, an unknown suite refused, payload parsing), user styles (round trip, deletion restoring the default) and the per-agent registration and disposal.

`packages/market-bundle/test/integration/output-style-routes.test.ts` covers the read, the select, an unknown style id, a cross-origin write, a capture of a suite that does not exist, capture then select, a suite style with no capture, user style create and delete, an invalid user name, and an unknown session.

`packages/market-bundle/test/repo/published-output-styles.test.ts` guards the shipped builtin directory against the `files` entries.

`packages/market-ui/test/client-output-styles-panel.test.ts` renders the panel in jsdom: the grouped rows and the marked selection, selecting a style and seeing the injected text, the empty default preview, the capture action and the stale notice, a suite row enabled only once its capture is current, the user-style editor round trip, and creation from the header action.

The tab row gains one key, and the existing stow and workspace suites move with it to nine tabs.

## Consequences

The page can promise what the prompt receives, because the preview and the prompt share one function and the preview is the server's answer rather than a client-side recomputation.

A suite style costs one explicit action, and a person who never captures one never gets suite text in their prompt. A suite that changes stops contributing until someone captures again, which is the intended direction: the workspace loses a style rather than gaining an unreviewed one.

The fingerprint does not catch a script edited without a version or declaration change until the next capture. The page always offers that capture, and the row cannot claim currency for a suite it has not seen change.

Nothing here runs at request time except a capture a person requested. The builtin directory is read per page read, which is three small files, and the document read happens per page read and per agent creation.

## Related

The section stacking follows the host's own prompt order documented at `packages/core/system-prompt/src/index.ts` (`SECTION_ORDERS`), which the workspace instructions feature also reads. The per-agent registration follows the same shape as the role-instruction section in `packages/market-runtime/src/runtime/agents/role-composition.ts`, which registers on `agent.ctx` with `interpolate: false` for the same reason.
