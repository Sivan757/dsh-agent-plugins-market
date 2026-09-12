# Agent Note: plugin storage rides the harness file utilities

Status: implemented

## Problem

Everything this plugin persists — `state.json`, the MCP and LSP declarations under the Agent layout root, per-suite overrides, the LSP enable set, the feedback stamp, and the user-authored Markdown panels — was written with hand-rolled `node:fs` code, four sites with their own `writeFile` + `rename` pair. None of those renames retried, and Windows fails `rename` over an existing file transiently with `EACCES`, `EBUSY`, or `EPERM`; the plugin's durable state was therefore the least protected file path in a plugin that installs other people's code. Home resolution was hand-rolled too, and resolved a blank `$DSH_HOME` to the current working directory.

## Decision

Persistence writes go through `@deepseek-ai/dsh-atomic-write`'s `writeFileAtomic`, and home resolution delegates to `@deepseek-ai/dsh-home-paths`. Both are the harness's own utilities for this layer: `settings-file`, `credentials-local`, `agent-presets`, `llm-deepseek`, and `app-boot` depend on the former, and twelve harness packages on the latter. Each write states its mode explicitly — `0o600`/`0o700` for private plugin state, `0o644` for the Markdown panels other Agent tools read.

`ctx.fs` — the harness's abstract `FileSystem`, which does own atomic text writes — is deliberately not used:

- It is the **execution world's** filesystem, not this process's. `packages/fs/fs-sandbox` states the doctrine: `ctx.fs` and `ctx.subprocess` together define one world, and the E2B realization keeps "the host owns … plugin objects … session logs and persistence … skills" while "sandbox state is deliberately ephemeral: timeout and disposal delete the remote files and unmanaged state". Routing durable plugin state there would put it in a world that is deleted on disposal.
- The shipped profile mounts `fs-sandbox`, whose `workspace-write` mode admits only `[workspaceRoot, '/tmp', tmpdir()]`. Each of this plugin's roots sits outside that, so a bare `writeText` is denied and using it would require the plugin to name a policy wider than the session's — there is no harness-owned or plugin-owned mode.
- The contract has no binary write and no `mkdir`, delete, rename, or copy, so source acquisition and uninstall cleanup could never share the seam anyway.

## Consequences

Every persistence write is now one atomic publication with a Windows retry, a `wx` temp create that refuses a symlink planted at the temp path, and parent directories created by the call. Four divergent copies of that logic collapse into the shared one.

Two behavior changes come with it. A write that previously followed a symlinked target now replaces the link itself. And a blank `$DSH_HOME` or `$DSH_AGENTS_HOME` reads as unset instead of resolving the home against the current working directory, so a malformed override can no longer point the plugin's storage at whatever directory it was started in. A configured `$DSH_AGENTS_HOME` also expands a leading `~`, matching the rule the harness already applied to its own home.

## Alternatives considered

**Write through `ctx.fs.writeText`.** It would ride whichever backend the deployment mounted and would give `fs-local`'s stronger implementation — fsync, and `ReplaceFileW`-based DACL preservation on Windows. Rejected on the three grounds above; the E2B one is decisive, because the harness explicitly decided plugin state does not move into the execution world, and this plugin additionally shells out to host `git` and `tar`, so its files and its processes must share the host world.

**Keep the hand-rolled temp + rename and add a retry.** That reimplements what the harness already tested, in four places, and the copy would still lack the symlink-safe temp create.

**Call `fs-local`'s raw `writeFileAtomic` directly instead of the utility.** It is the strongest implementation — staging directory, fsync, Windows DACL copy — but `@deepseek-ai/dsh-fs-local` exports only its root and `./src/*`, so the raw module is TypeScript source rather than an importable runtime entry.

## Testing

`tests/state.test.ts` pins the properties the plugin now relies on: a write into two missing directory levels creates them, two successive writes leave exactly one file behind with the second content, and (on POSIX) the replacement carries `0o600`. `tests/paths.test.ts` covers the tilde forms the harness expands, a configured harness home, and the blank-override rule for both roots. The rest of the suite exercises the migrated call sites end to end: `mcp-direct-config`, `lsp-direct-config`, `mcp-overrides`, `storage-migration`, `user-store`, `panel-resources`, and `state` all read back what they wrote.
