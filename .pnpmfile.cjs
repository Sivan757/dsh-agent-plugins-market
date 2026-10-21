/**
 * Dev-tree resolution only. Nothing in this file ships: pnpm reads it from the
 * repository root, and `package.json` `files` does not list it, so the packed
 * tarball never contains it.
 *
 * The host does not ship the hook packages. This repository installs
 * `@deepseek-ai/dsh-hooks-claude-code` at the build baseline for its bridge
 * tests, and that package imports `selectHookGroups` from
 * `@deepseek-ai/dsh-hook-protocol`, a name that exists only on the 0.2.1 line.
 * The plugin self-provisions the protocol with the support window, and semver
 * resolves that window to its floor `0.2.0-rc.2`, which is the copy a profile
 * install receives: a prerelease comparator matches only its own
 * `major.minor.patch` tuple, so no `0.2.1-rc.*` version satisfies the window.
 * The sibling therefore needs its own nested copy of the exact version it
 * declares, or it fails to evaluate that import.
 *
 * This rewrites that one peer edge into a dependency edge, taking the version
 * from the sibling's own `peerDependencies` entry rather than naming it here,
 * so a baseline bump needs no edit to this file. It changes no file the plugin
 * publishes, and a consumer profile never installs the sibling, so a profile
 * resolves exactly one copy: the floor.
 */
const BRIDGE = '@deepseek-ai/dsh-hooks-claude-code'
const PROTOCOL = '@deepseek-ai/dsh-hook-protocol'

/** @param {{ name?: string, dependencies?: Record<string, string>, peerDependencies?: Record<string, string> }} pkg */
function readPackage(pkg) {
  if (pkg.name !== BRIDGE) return pkg
  const version = pkg.peerDependencies?.[PROTOCOL]
  if (version === undefined) return pkg
  delete pkg.peerDependencies[PROTOCOL]
  pkg.dependencies = { ...pkg.dependencies, [PROTOCOL]: version }
  return pkg
}

module.exports = { hooks: { readPackage } }
