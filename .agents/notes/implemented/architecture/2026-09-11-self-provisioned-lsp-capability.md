# Agent Note: Self-provisioned LSP capability — the plugin installs and mounts its own seam

Status: implemented

## Problem

The plugin mounted one `dsh-lsp-stdio` provider per enabled suite but left the rest of the LSP capability to the deployment. That contract assumed something the dsh host does not do:

1. **A dsh profile never installs peers.** `initProfile` writes `nodeLinker: hoisted` and `autoInstallPeers: false` into the profile's `pnpm-workspace.yaml`, so a `peerDependencies` entry is a declaration, not an installation. `dsh plugin --profile <p> add <pkg>` forwards to pnpm in the profile directory, and pnpm installs `dependencies` only.
2. **The installation does not carry the LSP packages.** `$DSH_HOME/profiles/node_modules` mirrors the running `dsh` installation's dependency closure, which is why `dsh-llm`, `dsh-tools`, `dsh-mcp-client` and `dsh-hooks-claude-code` resolve with no profile step. The `lsp/` group reaches the tree only through the e2b bundle — measured on a live profile, the fallback held 249 packages and none of them LSP.
3. **Installing the packages is still not enough.** None of the three declares `dsh.bundle`, so `dsh plugin add` installs them as plain dependencies and `reconcilePlugins` never makes them layers; `ctx.lsp` and the `lsp` tool exist only if the deployment inserts those rows itself. The reference setup on this machine did exactly that by hand: three direct profile dependencies plus two `insert` rows in the profile's own `cordis.patch.yml`.

The result was a feature that advertised LSP servers and silently degraded to a `host-missing` diagnostic on every stock install.

## Decision

The plugin owns the whole capability chain: it installs the three packages and mounts the two missing seams itself.

**Provisioning is declared by dependency kind.** `@deepseek-ai/dsh-lsp`, `@deepseek-ai/dsh-lsp-stdio` and `@deepseek-ai/dsh-tool-lsp` move from optional peers to `dependencies` at the host baseline, so pnpm puts them in the profile when the user installs the plugin, with no second command and no confirmation step. The capability packages the installation already carries stay `peerDependencies` — shipping a copy of those would put a second instance of a host service in the profile and shadow the installation's own, which is the design the healed module fallback exists to prevent.

**Mounting is lazy.** `LspMountRegistry` mounts `@deepseek-ai/dsh-lsp` and then `@deepseek-ai/dsh-tool-lsp` when the first server becomes wanted, and disposes them when the last one goes away, so a profile that never enables an LSP suite never grows an `lsp` tool. Ordering is the contract: the tool injects `lsp`, and the stdio provider registers into it.

**Nothing asks what the profile already carries.** Provisioning is a property of the plugin, not of the deployment: this package's dependency declaration decides the version, so deferring to a seam another layer registered would silently run that layer's version instead. Both mounts are therefore unconditional, and a seam that is already taken comes back as a `seam-conflict` diagnostic naming the layer to remove — a manual `cordis.patch.yml` row, or a profile dependency on the package. Failing loudly is the only way the aligned copy becomes the one that runs.

**Failure stays a diagnostic, not a retry.** A capability package that cannot be loaded reports `host-missing` with the reinstall command and never enters the retry schedule; the failure is re-attempted on the next reconcile pass, so repairing a profile recovers without a restart of the plugin.

The alignment gate ([host dependency alignment gate](../process/2026-09-11-host-dependency-alignment-gate.md)) grew the matching rule: a `dependencies` entry must carry `^<baseline>`, a host package referenced from `src/` may be declared in either section, and `--fix` never moves a package between them.

## Alternatives considered

- **Defer to a seam the profile already registered** (`ctx.get('lsp') !== undefined` → skip the mount). Rejected: it makes the running version a property of the deployment, so a profile carrying an older manual pin keeps running that older copy while this package's declaration says otherwise — the exact drift this plugin exists to remove. A taken seam is reported as a conflict naming the layer to drop instead.
- **Keep the LSP packages as optional peers and print an install command in the diagnostic.** Rejected: it makes the feature work only for users who read a diagnostic. The capability is advertised as part of the plugin; provisioning it is the plugin's job.
- **Add the host's own service packages (`dsh-tools`, `dsh-llm`, `dsh-hooks-claude-code`, …) to `dependencies` as well**, so every host surface would be pinned to the tested version. Rejected: the installation already supplies them through the shared fallback, and a profile-local copy shadows it for every other plugin in that profile. That duplicate is what produced the observed `dsh-hooks-claude-code@0.1.2-rc.1` shadowing a `0.1.5-rc.1` installation — buying control at the cost of the shared-instance guarantee.
- **Insert the two rows through the plugin's own `cordis.patch.yml`.** Rejected: `insert` pushes entries unconditionally ([`vendor/include`](https://github.com/deepseek-ai/deepseek-harness)), so a fixed `id: lsp` would collide with the row a hand-composed profile already inserted and load the service twice. Runtime mounting with a `ctx.get()` guard has no such collision, and it can be conditional on an LSP suite actually being enabled.
- **Mount the seam at plugin startup instead of on demand.** Rejected: it would publish the model-facing `lsp` tool to every session even when no provider exists, turning a working surface into a tool that answers every call with `LSP_UNAVAILABLE`.
- **Install into the profile at runtime** (`pnpm add` spawned from the plugin). Rejected: the host exposes no install API, the plugin cannot discover its own profile name, writing another process's `node_modules` while the host runs needs a restart to take effect, and it would make an agent-driven install a silent side effect on the user's machine.

## Consequences

- LSP works on a stock install: installing the plugin is the only step, and the language-server executables remain the user's responsibility.
- The published package now installs three host packages into every consumer's profile. They are small, but the profile's `node_modules` grows for users who never enable an LSP suite.
- The capability's version is the plugin's declared baseline rather than the installation's. When a profile already carries an older manual pin, pnpm keeps that pin at the profile root and nests the plugin's copy, so the two coexist; the plugin mounts providers into whichever `ctx.lsp` the profile published.
- The plugin's own test suite needs stubs for the two additional loaders: the registry's context dependency is now `plugin` plus a service lookup, and the profile-provided case is the default in tests so the stdio behaviour stays covered unchanged.
