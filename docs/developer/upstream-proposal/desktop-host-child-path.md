# Desktop Host child `PATH`: the gap and what the harness could do

> 2026-09-26 · Upstream proposal for `deepseek-harness`. Findings were reproduced against checkout `477b4f4205` (the `0.1.7-rc.2` release point) and against the shipped desktop bundle (`0.1.7-rc.2`, `app.asar`).

## The gap

The macOS desktop app is launched from Finder/Dock, so the Host process inherits launchd's environment. Its `PATH` is the four system directories:

```
$ launchctl print gui/501/application.com.deepseek.dsh.<…> | grep -A2 'environment'
  default environment = { PATH => /usr/bin:/bin:/usr/sbin:/sbin }
  environment = { … PATH => /usr/bin:/bin:/usr/sbin:/sbin … }
```

Everything a user installs for agent tooling — Homebrew (`/opt/homebrew/bin`), `~/.local/bin`, pnpm, bun, cargo, pyenv, nvm — lives outside those directories. The bundle does not compensate: `Contents/Resources/runtime/bin` holds only a `node` shim and `node.cmd`, and that shim's own launcher reads `DSH_DESKTOP_NODE_EXECUTABLE`, which `scrubbedParentEnv()` strips as a `DSH_*` name. `find Contents/Resources -name 'npm*' -o -name 'npx*'` returns nothing.

Three code paths confirm the `PATH` is passed through unchanged, and none of them resolves a bare command:

| Path | Evidence |
| --- | --- |
| Host inherits the launcher environment | `apps/desktop/src/host-process.ts:199` passes `bin = undefined` to `desktopNodeEnvironment`; `apps/desktop/src/node-environment.ts:12-17` only prepends a directory when `bin` is given |
| The package-install PATH is scoped to one spec | `apps/desktop-host/src/index.ts:31-41` decorates the `packageManager` child only |
| MCP stdio spawns with the ambient `PATH` | `packages/mcp/mcp-client/src/transport.ts:31-46` → `StdioClientTransport({ command, args, env: { ...scrubbedParentEnv(), ...config.env }, cwd })`; the package contains no occurrence of `PATH`, `ENOENT` or `resolveExecutable` |
| LSP pre-resolves, but inside the same short `PATH` | `packages/lsp/lsp-stdio/src/index.ts:139-159` resolves through `ctx.subprocess.resolveExecutable` before registering, so the failure is legible (`command "npx" was not found on PATH`) yet the server still cannot mount |

`apps/desktop/README.md:57` states the position deliberately: the private `runtime/bin` "is added only to package-installation processes, not the Host PATH inherited by PTC and agent shells. This tool does not change PATH, environment variables or user package-manager configuration." The `.env` layer cannot help either — `PATH` is in `BOOTSTRAP_NAMES` (`packages/boot/app-boot/src/index.ts:132-153`), so a profile that sets it is refused rather than honoured.

## Who this hits

Every stdio MCP server and language server declared with a bare command, which is the portable convention the marketplace ecosystem uses. On one developer machine, all six cached stdio declarations are bare names: `npx` four times, `uvx` twice, across four unrelated sources. `computer-use-cua-driver-mcp` in this repository ships a bare `cua-driver` default and lands in the same place.

Counter-examples that keep working: HTTP/SSE transports, declarations that use an absolute self-contained binary, the harness's own MCPs (they resolve their own package with `process.execPath` plus `import.meta.resolve`), and a Host started from a terminal that already carries the login `PATH`. None of those help a third-party suite that wants to say `npx <package>`.

## Options for the harness

1. **Give the Host the login shell's `PATH` at startup.** One `path_helper`-style step, or asking the user's shell once (`/bin/zsh -ilc 'print -r -- $PATH'`, ~200 ms) in `apps/desktop/src/main.ts` before the Host is spawned, would fix the whole class — MCP, LSP, PTC, agent shells — with no per-package work. It is also what a terminal-launched `dsh` already enjoys, so the two launch paths would stop differing.
2. **Ship an npm/npx shim next to the existing node shim**, so `npx` exists inside `runtime/bin`. This covers the most common declaration but not `uvx`, `python`, or language-server binaries, and the shim must not depend on a `DSH_*` variable that `scrubbedParentEnv()` removes.
3. **Expose a supported child-`PATH` setting.** Today nothing can change it: `.env` refuses `PATH`, no settings key exists, and no CLI flag. A documented profile-level addition (appended, never replacing the system entries) would let users fix their own machines without a plugin in the loop.
4. **Let `dsh-mcp-client` resolve like `dsh-lsp-stdio` does.** `ctx.subprocess.resolveExecutable` already exists (`packages/subprocess/subprocess/src/index.ts:133`); running it before constructing the transport turns a bare `ENOENT` into a named, actionable diagnostic and gives a natural place to report which directories were searched. This does not make a missing command reachable, so it complements rather than replaces options 1–3.

## What the market plugin does meanwhile

`dsh-agent-plugins-market` cannot change the Host environment, so it closes the gap for the surfaces it owns, without touching the user's declarations: when a stdio MCP command or an LSP server command fails to resolve against the ambient `PATH`, it asks the user's login shell once (`darwin` only, memoized, 3 s timeout), appends the directories the current `PATH` lacks, and resolves again. An explicit `env.PATH` is never touched, the declared command is never rewritten, and both the extension and a still-failing lookup are reported in the plugin's diagnostics. The mechanism and its verification are recorded in [the bare-command resolution note](../../../.agents/notes/implemented/bug-fix/2026-09-26-bare-command-resolution.md).

This is a workaround for one plugin's surfaces. The four options above belong in the harness, where one change would cover every surface that spawns a command.
