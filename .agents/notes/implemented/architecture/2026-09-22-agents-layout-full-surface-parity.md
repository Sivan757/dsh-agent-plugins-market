# Agent Note: The .agents layout reads every surface it carries

Status: implemented

## Problem

`~/.agents/` and `<project>/.agents/` are the cross-tool Agent configuration locations this plugin reads in place. `~/.agents/skills/` and the project-level `.agents/skills/` are de-facto conventions shared by dozens of clients ([ecosystem research](../../../../docs/developer/discussion/2026-09-02-agent-config-compat-ecosystem.md)), and the plugin already keeps the resources a user authors in the user root. The two roots are read by different code paths — the user panels plus the direct MCP and LSP loaders, against the project-native synthetic suites — and that asymmetry left real content unread:

- `<project>/.agents/mcp.json` was read only through the ZCode project layout's empty-table fallback. Its servers were attributed to the `.zcode` suite, whose root directory may not exist, and the file was dropped entirely as soon as `zcode.json` or `.zcode/config.json` declared one server of its own.
- `~/.agents/hooks/hooks.json` and `~/.agents/hooks.json` had no reader. The project layout carried command hooks; the user root carried none.
- `~/.agents/commands/*.md` and `~/.agents/agents/*.md` were read as flat files only, while a project's same directories are read recursively.
- A hand-written `~/.agents/mcp.json` was rejected unless it carried a DSH-only `$schema` key, even though that file is documented as ordinary `mcpServers` JSON in the place other Agent tools look.
- The direct user suites declared every surface enabled while carrying one, so a `~/.agents/mcp.json` holding servers made the suite command registry read `~/.agents/commands/**` a second time beside the user commands panel.

## Decision

**`mcp.json` belongs to the `.agents` project layout.** `PROJECT_LAYOUTS` gives that entry `mcpFiles: ['.agents/mcp.json']`, and the ZCode empty-table fallback is gone. Two layouts no longer read one file: each native suite carries the declarations its own directory holds.

**Command hooks join the user root.** `~/.agents/hooks/hooks.json` and `~/.agents/hooks.json` use the same file names, order and additive merge the project `.agents` layout uses, and accept either the bare event table or a `hooks` key. `ProjectHooks.projectRoot` becomes optional: a project-level or suite-declared hook set carries its root and reaches the bridge as `projectDir`, while a user-level set carries none, so the bridge's own default resolves `${CLAUDE_PROJECT_DIR}` to the calling session's workspace rather than to a configuration directory. The user declaration is a synthetic direct suite beside the direct MCP suite, merged into `enabledUserSuites()` only when it declares events.

**User panel entries gain relative-path names.** The `commands/` and `agents/` panels read subdirectories at any depth, and an entry that declares no name of its own is addressed by its path relative to the kind directory (`git/commit`); a declared frontmatter `name` still wins, as it always has. Every segment keeps the existing entry grammar; `..`, absolute paths, backslashes and empty segments are rejected at every filesystem choke point rather than at the HTTP boundary only, and the walk never follows a symlinked directory. Creation still writes the flat `<name>.md` spelling, and deletion removes only the document the entry serves. The skills panel keeps its two top-level shapes, because the harness reader that also maps `~/.agents/skills` reads no deeper — a category-nested skill there would be dead content.

**A nested command registers under its callable name.** The host's command grammar is one segment, so `git/commit` registers as `git-commit` through the same `commandCallName` rule the suite and project-native command mounts already apply, and the panel renders that name. Two documents that flatten to one call name produce one registration and a diagnostic for the other, never a silent shadow.

**`~/.agents/mcp.json` no longer needs `$schema`.** The user's own file is validated against the baseline dialect when the key is absent, so every per-server rule still applies while a file another tool wrote stays readable. A suite's own `mcp.json` still requires the version it declares: that file is a distributable package.

**Direct user suites declare only the surfaces they carry.** The MCP suite enables `mcp`; the hooks suite enables `hooks`.

## Alternatives considered

**Keep the ZCode fallback and add a `.agents` reader beside it.** Rejected: the one file would be read and mounted twice under two suite ids, and the ownership question — which suite a server belongs to in the MCP status panel — would stay unanswered.

**Model user hooks as a fourth panel.** Rejected: a panel exists to author one document per entry with create/edit/delete; a hook file is a single shared event table that tools write as a whole, which is exactly the shape the direct configuration loaders already handle.

**Keep user commands and personas flat.** Rejected: a project's `.agents/commands/` is read recursively, so the same directory would mean one thing in a checkout and another in the home directory, and content another tool wrote there would be invisible.

**Require `$schema` in the user's `mcp.json` and document it.** Rejected: the user root is shared with tools that write plain `mcpServers` JSON, and the file's own contract already says so. Requiring a DSH key would make the plugin the only reader of the file it deliberately shares.

**Let the skills panel read nested skills too.** Rejected: `dsh-skill-filesystem` maps `~/.agents/skills` as a root and reads only immediate child directories and immediate `*.md` files, so a nested skill listed by the panel would be one no session can use.

## Consequences

The two `.agents` roots now cover the same surface set, and nothing in the shared directory is read by two owners.

The user hook mount has no project dir, so a hook command that names `${CLAUDE_PROJECT_DIR}` sees the session's workspace. A hook file that wanted its own directory names `${CLAUDE_PLUGIN_ROOT}`, which the bridge receives as the Agent layout root.

Path-named panel entries reach the HTTP layer as opaque strings, and the two client titles that render a command name flatten it with the same rule the registration uses. Entry names stay stable on disk: `git/commit` is the path, and the callable name is derived at each boundary rather than stored.

A `$schema`-less read is validated by the same ruleset the strict path uses, so a hand-written file is held to the same per-server rules; a document this client rejects contributes no server and reports its reason on the suite record, the empty-table branch this file has always taken. The trade is that an absent `$schema` is read as the baseline dialect rather than as an error.

Direct user suites keep reporting their own `surfaces` counts, and the disabled-surface default for an installed suite is unaffected.

## Testing

`tests/project-mcp.test.ts` pins the ownership split: `.agents/mcp.json` resolves to the `.agents` native suite, ZCode reads only its own files, both can declare servers without overlap, and a malformed `.agents/mcp.json` fails that suite closed. `tests/user-hooks.test.ts` covers normalization, merging, dedup, the fail-closed malformed case, the suite shape, and a `HooksMountRegistry` pass asserting the bridge receives `pluginRoot` with no `projectDir`. `tests/mcp-direct-config.test.ts` covers the `$schema`-less read, the named-server reason a rejected file reports, and the write-path rejection it keeps. `tests/user-panels.test.ts` and `tests/user-commands.test.ts` cover nested listing, addressing, creation, deletion, the name guard, and the flattened registration with its collision diagnostic.
