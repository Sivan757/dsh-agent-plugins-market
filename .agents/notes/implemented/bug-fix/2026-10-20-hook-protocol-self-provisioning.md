# Agent Note: Self-provision the hook protocol so the plugin can activate

Status: implemented

## Problem

The plugin entry imports `@deepseek-ai/dsh-hook-protocol` for value at module evaluation ([the hooks executor](../../../../packages/market-runtime/src/runtime/surfaces/extension-hooks.ts)). The manifest declared that package as a required peer, and a dsh profile sets `autoInstallPeers: false`, so no peer is ever installed. The host does not supply it either: the desktop host 0.2.1-rc.2 ships 307 `@deepseek-ai` packages and none of their names matches `/hook/`. The import therefore threw `ERR_MODULE_NOT_FOUND` before the plugin registered anything, and every surface was lost, not only the hooks surface. Local runs hid the defect because a devDependencies mirror put the package in this repository's own tree.

The alignment gate accepted that tree. It derives peer versus dependency from the shape of the import and never asks whether the host actually ships the peer, so a required peer the host cannot satisfy passed the gate.

## Decision

`@deepseek-ai/dsh-hook-protocol` is a `dependencies` entry with the support window `>=0.2.0-rc.2 <0.3.0-0`. pnpm installs it into the consuming profile during the normal plugin install, so the static import resolves from the profile copy, and the source keeps its static import unchanged. The `peerDependencies` entry and the devDependencies mirror are both deleted, and the lockfile is regenerated.

The package fits the dependency section because it is a plain library. Its published `lib/index.js` has no import statement, it registers no cordis service, and it exports functions and types only, so a profile copy cannot shadow a host service. That is the condition [the plugin development standard](../../../../docs/reference/dsh-plugin-development-standard.md) names for self-provisioning, and the same shape the plugin already uses for the LSP packages.

The lockfile resolves the declared window to its floor, `0.2.0-rc.2`, because a prerelease range resolves to the lowest version inside it. That is the version a profile install receives, so it is also the version the repository now tests against. The two published bundles are identical for every function this plugin imports: the architect diffed `0.2.0-rc.2` against `0.2.1-rc.2` and the only addition is `selectHookGroups`. This plugin never calls it, but the dev-only bridge package does, which is the conflict the next section resolves. The shape is inert at runtime for the plugin, and it is recorded as an accepted consequence.

## The dev tree holds two copies, and a profile holds one

The declared window resolves to its floor, which puts the dev-only bridge package `@deepseek-ai/dsh-hooks-claude-code` in conflict with it. The bridge declares an exact protocol peer on the 0.2.1 line and imports `selectHookGroups` from it, and a prerelease comparator matches only its own `major.minor.patch` tuple, so no version inside the window can satisfy that peer. With one copy in the tree, the bridge fails to evaluate its own import, and the five bridge tests in `user-hooks.test.ts`, `mcp-mounts.test.ts` and `project-hooks.test.ts` fail with `the @deepseek-ai/dsh-hooks-claude-code package is not installed in this profile`.

The resolution is a root `.pnpmfile.cjs` whose `readPackage` hook rewrites that one peer edge on the bridge manifest into a dependency edge, at the exact version the bridge declares in its own `peerDependencies`. The hook reads the version from the manifest rather than naming it, so a baseline bump needs no edit. The resulting tree carries two copies: the plugin's declared dependency resolves the floor `0.2.0-rc.2`, and the dev-only bridge nests its own exact `0.2.1-rc.2`. Four other resolutions were measured against pnpm 11.17.0 and all failed: a scoped override on the peer edge, an override with a parent version selector, `dedupePeerDependents: false`, and `packageExtensions` adding a same-named dependency. pnpm does not re-resolve a peer edge while any version of the package is already present.

This is the one place where dev resolution deliberately differs from a profile install. A consumer profile never installs the bridge, because `@deepseek-ai/dsh-hooks-claude-code` stays an optional peer that no profile mounts, so a profile resolves exactly one copy: the floor. The pnpmfile is dev-tree material only. It is not in `package.json` `files`, and the packed tarball was checked: 340 entries with no `pnpmfile`, `pnpm-workspace.yaml` or `pnpm-lock.yaml` among them. The lockfile therefore records one entry for the plugin's declared dependency plus one nested copy for the dev-only bridge, and `pnpmfileChecksum` records that the hook was active when the lockfile was written.

The hook also fails loudly when it is removed. `pnpm install --frozen-lockfile` compares the recorded `pnpmfileChecksum` against the hook present on disk and exits 1 with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH: Cannot proceed with the frozen installation. The current "pnpmfileChecksum" configuration doesn't match the value found in the lockfile`, so nobody can delete the hook and keep a silently green tree. The hook is deleted when the protocol floor reaches the version the bridge declares, because one copy then serves both. `packages/market-bundle/test/repo/hook-protocol-lockfile.test.ts` reports exactly that state, with a message naming the hook as deletable, so the hook cannot outlive its reason.

A profile never receives the nested copy, and the reason is not that a host supplies the bridge. `@deepseek-ai/dsh-hooks-claude-code` is a `devDependencies` entry of this repository, so a consumer profile never installs it. The bridge reached a profile only through its optional peer contract, and a profile sets `autoInstallPeers: false`, which never installs an optional peer. The desktop host 0.2.1-rc.2 supplies neither package either: its payload carries 307 `@deepseek-ai` packages and none of them matches `/hook/`. A profile therefore sees neither the bridge nor a nested protocol copy, and the hooks surface keeps returning the diagnostic it already returns until a host or a profile supplies the bridge: a `{ suiteId, reason }` row whose reason reads `the @deepseek-ai/dsh-hooks-claude-code package is not installed in this profile`. That is the hooks surface's own message, not a diagnostic code; the `host-missing` code belongs to the LSP path and never describes hooks. When a host install does ship the bridge, that ship carries the matching protocol copy, so the nested copy stays unnecessary there too. The nested copy exists only in this repository's dev tree, where the bridge is a devDependency used by five tests.

Read the bridge tests with one caveat. `hooks-mounts.ts` wraps the bridge `import()` in a try/catch and reports any load failure as `the @deepseek-ai/dsh-hooks-claude-code package is not installed in this profile`. For a link failure such as the missing `selectHookGroups` export, that message is imprecise: the package is installed and its import fails. Tightening the diagnostic is a separate change and is not part of this one.

The lockfile evidence for that split:

```yaml
# pnpm-lock.yaml line 11, the hook was active when this lockfile was written
pnpmfileChecksum: sha256-LHVN6QEBhFh1ZGlBVZpIwdpzqBjyAPqZtJ7eUExsV6o=

# the plugin's own declaration resolves the floor
importers:
  .:
    dependencies:
      '@deepseek-ai/dsh-hook-protocol':
        specifier: '>=0.2.0-rc.2 <0.3.0-0'
        version: 0.2.0-rc.2(...)

# the dev-only bridge nests its own exact copy
packages:
  '@deepseek-ai/dsh-hook-protocol@0.2.0-rc.2': ...
  '@deepseek-ai/dsh-hook-protocol@0.2.1-rc.2': ...
```

The hook lives at the repository root because pnpm reads it there and no other location works; the root-file convention admits a file a platform tool consumes. `packages/market-bundle/test/repo/pnpmfile-hook.test.ts` drives the hook itself with a target manifest and an unrelated one, and asserts that only the target's protocol peer edge moves, so a broadened condition fails in review rather than changing resolution silently.

## Alternatives considered

- **Keep the peer and degrade the hooks surface with a diagnostic.** Rejected as the plan for this issue: it turns a total activation failure into a silent loss of a shipped capability, and reaching the diagnostic state costs a lazy-import refactor across about 15 call sites plus the `createDetachedRuns` field initializer. It stays the right shape for a future package that owns a cordis service and cannot be self-provisioned.
- **Delete the parallel executor and revive the host bridge.** Rejected for this issue: it takes eight to twelve engineer-days, removes per-hook selection and the plugin path environment that `ExtensionHooks` provides, and still does not make the plugin activate faster. The dead bridge at `reconciler.ts` needs its own change and its own decision record.
- **Vendor the protocol code into this package.** Rejected: it duplicates upstream logic and drops the versioned contract, which is exactly what the alignment gate exists to keep.
- **Ship a committed host inventory and a new gate rule in this change.** Rejected for this issue: the 307 names drift with every host release, and the fix does not need an inventory. The general guard belongs in a separate change.

## Consequences

- A profile install now places one package into the profile, and the static import resolves there. A profile that already carries the package keeps working, because the library is stateless and either copy satisfies the import.
- The declared window resolves to the floor `0.2.0-rc.2`, so a profile runs protocol code from the older candidate line while its host runs `0.2.1-rc.2`. The difference is inert for this package, and the gate forces the window, so the fix accepts it. The floor copy declares `@deepseek-ai/dsh-invariants` as a peer, and its `dsh-session` and `dsh-shell` peers name `0.2.0-rc.2` while the host runs `0.2.1-rc.2`, so a profile install prints unmet-peer warnings for those three. Its cordis peer is `~4.0.4`, which a host on 4.0.4 or 4.0.5 satisfies, so cordis is not among the warnings. The install exits 0 and the warnings are expected, not a failure.
- Deleting the dev mirror is deliberate, not an accident of cleanup. A probe with the repository-pinned pnpm 11.17.0 shows that declaring the package in both sections resolves one copy, at the dependency range, and drops the dev entry. The mirror was therefore inert, and keeping it would have made the manifest claim that the tests run on the `0.2.1-rc.2` baseline while they run on the floor copy a profile installs. Removing it closes that gap, and any test that assumed the newer copy now fails as information.
- The hooks executor is unchanged, so per-hook selection, the plugin path environment, and the durable `hook/invoked` and `hook/result` pairs keep working. No README edit is needed because the user-visible promise, hooks running at lifecycle events, does not change.
- The two packaging tests fail on the old manifest shape and pass on this one, so a future change that moves the package back to a required peer breaks a test instead of a user install.

## Testing

- `packages/market-bundle/test/repo/hook-protocol-provisioning.test.ts` reads the root manifest and requires a dependency with the support window, no required peer, no peer metadata entry, and no dev mirror. Its fixture cases cover the pre-fix shape and a drifted range.
- `packages/market-runtime/test/hook-protocol-exports.test.ts` reads the import list out of `extension-hooks.ts`, imports the installed copy, and requires every imported value to exist. A second case requires the resolved copy to be exactly the floor the declared range resolves to. That comparison catches a drifted declaration: with a range declared and a different copy resolved, it fails on the version. Against the pre-fix manifest it fails earlier for a different reason, because there is no declaration to read a floor from, so it throws `package.json no longer declares @deepseek-ai/dsh-hook-protocol as a dependency`.
- `packages/market-bundle/test/repo/hook-protocol-lockfile.test.ts` reads `pnpm-lock.yaml` and pins the split without a semver resolver: the root importer holds the declared floor, the bridge snapshot holds the bridge's own declared version, and exactly two protocol versions exist. Fixture cases cover the merged state that makes the hook deletable.
- `node scripts/check-host-alignment.mjs --host-version 0.2.1-rc.2` reports 36 packages checked and no violations.
- `rm -rf node_modules && CI=true pnpm install --frozen-lockfile` succeeds with the hook present, and removing the hook fails that same install.

## Related decisions

- [Force the host dependency baseline to one release line before it can ship](../process/2026-09-11-host-dependency-alignment-gate.md) owns the gate rules this change satisfies.
- [Self-provisioned LSP capability](../architecture/2026-09-11-self-provisioned-lsp-capability.md) is the precedent for installing a host capability from this package instead of requiring the profile to supply it.
