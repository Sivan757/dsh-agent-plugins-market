# Agent Note: the instructions page reads the host chain instead of reimplementing it

Status: implemented

## Problem

The owner asked for a page that manages `AGENTS.md` and `AGENTS.local.md` across `$DSH_HOME`, `$DSH_AGENTS_HOME` and the session project chain, following the host scanning rules.

Those rules are not simple, and every one of them changes what the model reads. Two user-global roots form one candidate group, so identical content renders once and the harness home wins. The project chain climbs to the first directory holding a `.git` entry and then walks back down. Within one directory the base files load before the local overlays. Identical trimmed content inside a group collapses. A whole-baseline byte budget omits broader files before truncating the most specific one, and a separate per-file cap can drop a file from every observable array at once.

A second implementation would drift from the first. The obvious drift is silent: the page would show a file as loaded while the prompt omitted it, and the user would edit the wrong file.

## Decision

The page calls `@deepseek-ai/dsh-agent-instructions`, the module that owns the rules, through a lazy `import(...)`. Discovery, load order, deduplication, rendering and both byte budgets are that module's answer, returned unchanged.

Three host exports carry the answer. `discoverBaselineInstructionFiles` returns the candidates that exist, in load order, with the display path the prompt uses. `loadBaselineInstructions` returns the rendered text with its `omitted` and `truncated` arrays. `renderAgentInstructions` is available and unused, because the loaded answer already carries exactly what it would produce.

Each row's status is read off that answer, in a fixed precedence:

1. In `truncated` means truncated. This comes first because the renderer falls back to a notice-only line when nothing fits, so a truncated file can be absent from the text while still being listed in `truncated`.
2. An `Instructions from: <displayPath>` header in the text means loaded.
3. In `omitted` means over budget.
4. Otherwise the file exists and contributed nothing. Its size decides between two reasons: over the per-file cap, which no array reports, or a duplicate of an earlier represented candidate in its group.

Deduplication is never re-derived from content. A file that exists and appears in none of the three places is explained in two steps. Its size comes first: over the per-file cap names the cap, because the host drops such a file while reading it and reports it nowhere. Otherwise the host's remaining rule for that state is deduplication within the candidate group, so the row is reported as repeating the earliest existing candidate in its group. With no earlier candidate in the group there is nothing to repeat, and the row stays a neutral "not injected".

The per-file cap is named from the file's size rather than reported as a duplicate. The host reads bytes under the cap and drops the file without adding it to any array (`packages/context/agent-instructions/src/files.ts`, the `readBounded` guard and its caller), so the size is the only evidence the page has. Naming it is worth one `stat`: a user who sees "over the file limit" can act, and a user who sees "not injected" cannot.

Two rules are mirrored because the host does not export them, and only to offer creation rows. `findProjectRoot` is not exported, so `projectRootOf` repeats the `.git` climb, treats a marker as present whether it is a directory or the file a linked worktree writes, and returns `cwd` when nothing matches. The display escape that prefixes a project path whose first segment collides with a namespace name (`./agents-global/AGENTS.md`) is repeated for synthesized rows only. A discovered row always carries the host's own `displayPath`.

Discovery can throw, so every call is wrapped. A marker probe that fails for any reason other than `ENOENT` or `ENOTDIR` propagates, and a `.git` symlink loop throws `ELOOP`. The payload carries that message as an error state, and the page renders it instead of taking the surface down.

Writes are addressed by candidate, never by path. `saveInstruction` and `deleteInstruction` re-derive the chain server side and accept only a `{ scope, directory, candidate }` triple that is in it, so a request cannot create a file this session does not load. An absolute directory is refused, the parent directory is created only for that location, the write is atomic, and text over the per-file cap is refused because it would never load. A delete reports the other chain names that stat to the same file and whether the removed entry was a link, because a chain can carry two names for one file.

The two byte caps are plugin configuration fields, `instructionMaxBytes` (65536) and `instructionMaxSourceBytes` (1048576), documented as "keep equal to the host agent-instructions row". The page reads the chain the model receives only if they are the host's values.

## Alternatives considered

**Reimplement discovery and rendering in this plugin.** It would be testable against hand-written expectations and would need no optional peer. It would also diverge the moment the host changed a rule, and the divergence would be invisible: the page would report a chain the model does not receive. The owner asked for the host rules exactly, and the host exports the functions that own them.

**Send the read payload from the host renderer directly, without a per-row status.** Correct, and useless for the page: the user needs to know which of the listed candidates did not make it into the prompt, and why, before deciding what to edit.

**Render once per candidate to detect duplicates, using the renderer as an oracle.** Accurate for the duplicate question but N renders per read, each re-reading every file. The rendered answer already names what it kept, and one extra `stat` answers the per-file-cap question, so the per-candidate renders buy nothing.

**Report a file absent from all three arrays as a duplicate, without the size check.** Wrong for a file over the per-file cap, which the host drops silently. The page would tell the user their file repeats another one when the real reason is that it is too large.

**Offer `CLAUDE.md` and a local overlay in the two user-global roots.** Those names are not candidates there. A row that offers them would create a file the host never loads, which is worse than offering nothing.

**Write through `ctx.fs` instead of the filesystem directly.** The host filesystem service would carry version guards and its own provider rules. The page edits user-owned files outside any provider's workspace, the harness atomic-write helper already gives the crash-safe replacement this needs, and the plugin already writes user files that way for the panels.

**Give the page its own byte limits instead of configuration fields.** A constant would encode one deployment's choice into the plugin, and the page would then describe a budget the host row might not use. The host documents both caps as configuration.

## Testing

`packages/market-bundle/test/integration/instructions.test.ts` imports the published package and uses it as the oracle, never a hand-written expectation. Nine cases cover the chain, the truncation precedence, the per-file cap, a repeated local overlay, creation rows for a chain with no files, a `.git` file as a marker, a marker-less tree, a probe failure, a disabled budget and a session-scoped read. Six more cover the writes: creation with parents, a user-global write, absolute and unknown targets, an oversize body, and both delete directions of the symlink case.

`packages/market-ui/test/client-instructions-panel.test.ts` renders the panel in jsdom: chain order with one chip per status, the budget bar at two totals, the unavailable state, the preview with its omitted and truncated lines, an edit round trip that reaches the save route, a create on a missing row, and the alias notice after a delete.

`packages/market-ui/test/client-workspace-tabs.test.ts` moves to eight tabs and asserts the instructions tab renders its own panel.

## Consequences

The page reports the host's answer, so a host rule change needs no change here. The cost is an optional peer: `@deepseek-ai/dsh-agent-instructions` is declared as an optional peer with an exact dev mirror, and a profile without it gets a named notice instead of the page. The alternative, a required peer, would make the whole plugin uninstallable in a profile that lacks it, for one tab.

The plugin's own `@deepseek-ai/dsh-home-paths` dependency resolves to 0.2.1-rc.3 through a pnpm override. The support range cannot match a 0.2.1 prerelease, because node-semver only admits a prerelease of the same major.minor.patch a comparator names, and the host package peers on 0.2.1-rc.3 exactly. The dependency keeps its range for consumers, and the override resolves this repository's own tree to the baseline it builds against.

The read carries each existing file's text so the editor opens on what is on disk. That is one file read per existing row, bounded by the per-file cap, and it is the same read the host already performed for each file it rendered.

The page reads the chain for the session's directory when one is named and for the host process directory otherwise. No client surface supplies a session id today, so the settings page reports the process directory and says so under the path. The route and its test already accept a session, so wiring one later is a prop, not a redesign.

## Related

The page is the read-and-edit surface for the loading rules owned by `packages/context/agent-instructions` in the harness, and its two byte caps mirror that row's `maxBytes` and `maxSourceBytes`. It follows the reuse rule stated in [the repository instructions](../../../../AGENTS.md): the host capability is used before one is built here.
