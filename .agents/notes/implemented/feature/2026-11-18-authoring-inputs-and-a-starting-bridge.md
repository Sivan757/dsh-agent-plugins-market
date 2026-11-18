# Agent Note: authoring inputs are repaired on save, and a starting bridge says so

Status: implemented

## Problem

Recording the demo for the root READMEs put three surfaces in front of a reader who had never used them, and each one charged that reader for a fact the panel already knew.

The skills panel creates a draft holding a description and a body. The harness reader requires `name` and `description`, and `skillEntryRejection` mirrors it, so a skill created and left as it opens is listed disabled with a locked switch. The name is in the form's own name field, which the document does not receive.

The connector form stores whatever is typed into the command field. Every MCP server README shows one line — `npx -y @modelcontextprotocol/server-filesystem .` — and a stdio definition keeps the program and its arguments apart, so the mount tried to execute that whole line as a program name and reported a missing command.

A tool switch rewrites the mount config, because the filter is part of what the bridge is mounted with. The switch answers after its one-second budget, the dialog reads the status again, and that read catches the bridge between teardown and handshake. The row then reported `degraded`, which is the panel's word for a service that needs repair, for a service that was working and would be working again a moment later.

## Decision

- **A skill created in the panel takes the name field as its `name`.** `withSkillName` in `packages/market-catalog/src/scanning/skills-parse.ts` inserts the key after the opening `---` when the frontmatter declares none, gives a body-only document the block it was missing, and returns the text unchanged when a name is declared or the frontmatter cannot be parsed. The skills store runs it through the new `prepareCreate` option, so creation repairs and editing never rewrites a document the user authored.
- **A command line is split when it is stored.** `withSplitCommand` in `packages/market-mcp/src/application/mcp/mcp-command-line.ts` tokenizes on quotes and whitespace and moves everything after the program into `args`, appending to whatever the definition already declared. `prepareUserMcpServer` and `saveServerConfig` both run it, so the form, the JSON view and a declaration written by another tool all land on the split definition. A bare path that contains a space is left whole: cutting `C:\Program Files\app.exe` at its first space would break a service that works.
- **A starting bridge has its own state.** `McpStatusState` gained `connecting`, mapped from the supervisor's own `connecting` phase. The row carries no retry code, `retryable` is false and the panel offers no recovery action, because nothing failed yet. `mcpRuntimeState` maps the word to the shared `starting` state the preset manager and the extension inventory render, and the row label is 连接中 / Connecting. The panel's existing settle read already polls a connecting row, so the row clears itself when the handshake lands.

## Alternatives considered

- **Make a tool switch wait for the remount it schedules.** Rejected after implementing it and backing it out: `switchSettleMs` is a documented contract that a switch answers after at most its budget (`docs/user/resources.md`, `docs/user/sources.md`), and a server that hangs in startup would hold the switch for the longer budget — the case the budget exists to bound.
- **Re-filter the live bridge instead of remounting it.** Rejected for now: the filter reaches the bridge as mount config, and `MountPluginHandle` exposes only `await` and `dispose`. A live filter update needs a bridge seam that does not exist yet.
- **Split the command field on blur.** Rejected as the only path: a paste followed by the save button, and every edit in the JSON view, never blur that field. The split runs where the definition is stored, which covers both views.
- **Report a starting bridge as `connected`.** Rejected: the first handshake can still fail, and a green row that turns red is worse than one that says it is starting.
- **Fill `name` on edit as well as create.** Rejected: an edit is the user's document. Restoring a key they removed would hide the mistake the card already names, and the panel keeps the document as written.
- **Translate a name that is also an ordinary word.** Rejected as a defect to fix: the translation surface leaves identifiers alone, and `caveman` was translated inside the English sentence that uses it as a common noun. That is the correct output for that sentence.

## Consequences

- Creating a skill needs a description and nothing else; the document gains the `name` its card shows.
- A command line pasted into the form or written into JSON is stored split, so the file a reader opens shows the program and the arguments in their own fields. A path with a space stays one field and remains the one case the repair does not cover.
- A starting or restarting service reads 连接中 for the length of the handshake instead of 降级, and a service whose tools are all denied reads 已连接, because a live mount with no exposed tools is a supported configuration rather than a failure.
- `McpStatusState` grew a member. Every consumer that switches on it must handle `connecting`; the typechecker enforces it at both composition roots.

## Testing

`packages/market-catalog/test/skills-parse.test.ts` covers the name repair: a draft, a declared name, CRLF frontmatter, a body-only document, an empty block, unreadable YAML and a name outside the grammar. `packages/market-runtime/test/user-panels.test.ts` creates a skill from the editor's own draft and asserts the written file, asserts a command keeps its text, and asserts an edit leaves a stripped document stripped. `packages/market-mcp/test/mcp-command-line.test.ts` covers the split and its refusals; `packages/market-bundle/test/integration/mcp-direct-config.test.ts` asserts the file written by `addUserMcpServer` carries the split definition. `packages/market-bundle/test/integration/mcp-status.test.ts` pins a `connecting` observation as its own state with nothing to retry, and a live mount with every tool denied as connected.

`pnpm run check:quick` and `pnpm run format:check` pass, and the `market-mcp` and `market-ui` suites pass (65 files, 452 tests).
