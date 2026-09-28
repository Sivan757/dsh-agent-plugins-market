# Agent Note: bare commands resolve through the user's login shell

Status: implemented

## Problem

Marketplace suites declare stdio MCP servers the portable way — `npx --prefix ${PLUGIN_DATA} chrome-devtools-mcp@1.10.1`, `uvx …` — and LSP declarations name their executable the same way (`typescript-language-server`, `pyright-langserver`). Every one of those names has to be resolved against the process `PATH`.

The desktop app is launched from Finder/Dock, so the Host's `PATH` comes from launchd: `/usr/bin:/bin:/usr/sbin:/sbin`, with none of the directories a user's toolchain lives in (Homebrew, `~/.local/bin`, pnpm, bun, cargo). The app bundle carries a node shim and pnpm but no npm/npx, the `.env` layer refuses `PATH` (`BOOTSTRAP_NAMES`), and no setting exposes it. The result was `spawn npx ENOENT` for the most ordinary suite in the catalog; six of the six stdio declarations cached on this machine are bare names.

The host does not cover this: `dsh-mcp-client` hands `command` to the MCP SDK untouched — no resolution, no `PATH` handling, no `ENOENT` wording, and its own README example is a bare `npx` — and the desktop README states that `runtime/bin` is added only to package-installation processes. `dsh-lsp-stdio` does pre-resolve, but only against the same short `PATH`, so it reports the miss clearly and still cannot mount. Official MCPs built into the harness sidestep the problem by resolving their own package to an absolute entry (`process.execPath` plus `import.meta.resolve`), which a third-party suite's `npx <pkg>` cannot use.

## Decision

- **`src/runtime/host/shell-path.ts` asks the user's login shell once.** `/bin/zsh -ilc` prints a marker line and then `$PATH`; the module parses only what follows the marker, keeps absolute entries in order, and de-duplicates them. The probe is `darwin`-only, lazily started, memoized as a promise so concurrent first callers share it, and bounded by a three-second timeout. `-i` is required: Homebrew's `shellenv` line lives in `.zshrc`, which a login-but-non-interactive `zsh -lc` never reads.
- **Resolution is surgical.** `resolveDeclaredCommand` first resolves the declared command against the environment a spawn would inherit, through the host's own `ctx.subprocess.resolveExecutable`. Only a genuine `SubprocessExecutableNotFoundError` earns the extra step; then the login shell's directories are **appended** to the current `PATH` (never prepended, so no existing precedence changes) and resolution is retried.
- **A declaration is never rewritten.** The bare name stays the command and only the child's `PATH` grows. An explicit `env.PATH` from the suite or the user is left exactly as declared and does not even trigger the probe.
- **Every outcome leaves a fact.** An extension reports `PATH extended from the login shell: <directories>`; a lookup that still fails reports the command and the `PATH` finally searched; a probe that cannot produce a usable `PATH` says so. Nothing fails silently, and a failure falls back to the environment as it is today.
- **Two consumers.** The MCP bridge resolves in `apply` (not in `buildChildEnv`, which is synchronous and has no context) and writes the extension into `config.env.PATH`, which the transport already merges last; the LSP registry resolves each suite and direct server before handing the config to `dsh-lsp-stdio`, injecting `env.PATH` only when the server declares none.

## Alternatives considered

- **A static list of candidate directories** (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`…). Rejected: it guesses which toolchain is the user's, and this machine already shows why that fails — its `/usr/local/bin/npx` is a dangling symlink from a 2023 install. The login shell is the user's own statement of where their tools are.
- **Rewriting the declared command to an absolute path.** Rejected: it edits what the suite or the user wrote, and it does not even work alone — Homebrew's `npx` starts with `#!/usr/bin/env node`, so an absolute path without `node` on `PATH` still fails (verified: exit 127).
- **Routing every stdio spawn through a login shell.** Rejected: it would pay the probe and the profile's noise on every mount, and change the environment of services that resolve perfectly well today.
- **Waiting for the host to fix it.** Rejected as the only answer: the desktop README treats the short `PATH` as design, so the user stays blocked. The gap is filed as an upstream proposal instead, and the plugin keeps working if the host later grows the capability.
- **Probing on every reconcile pass.** Rejected: the shell environment does not change within one Host process, so the probe is cached and the LSP fingerprint (which includes the injected `PATH`) stays stable rather than forcing remounts.

## Consequences

- A bare command that cannot be found costs one ~200 ms shell probe per Host process; a healthy environment pays nothing, because the probe only runs after a real lookup miss.
- The absolute-path edge remains: a declaration like `/opt/homebrew/bin/npx` resolves as a file, so no probe runs, and its `#!/usr/bin/env node` shebang still needs `node` on `PATH`. It is a different failure with its own message, and no suite in the catalog declares an absolute path today.
- The success fact lands in the plugin log rather than on the status row: a mounted row has no wire field for a note, and the contracts stay untouched by this change.

## Verification

- `tests/shell-path.test.ts` (21 cases) pins marker parsing, banner noise, relative-entry filtering, de-duplication, the single probe, non-darwin no-op, timeout, missing shell, and each `resolveDeclaredCommand` branch — base resolution, append-and-retry, still-failing, probe failure, explicit `PATH`, missing seam, and non-lookup errors.
- `tests/mcp-bridge.test.ts` and `tests/lsp-mounts.test.ts` add 10 cases: a healthy environment keeps its `PATH` byte-identical, an extension reaches the mount env and the log, an explicit `PATH` is passed through untouched, a failure fact reaches the cause chain, and non-stdio transports never resolve.
- Live probe from the host's own short `PATH`: 194 ms, 30 entries, `/opt/homebrew/bin` among them, 26 directories appended in order.
- Real spawn with the resolver's own output: `npx --prefix … chrome-devtools-mcp@1.10.1` starts (status 0, npm reporting the run) where the same spawn with the host `PATH` fails with `ENOENT`.
- Full gates green: typecheck, eslint, prettier, dependency-cruiser, and 98 files / 881 cases.
