/**
 * The plugin entry imports @deepseek-ai/dsh-hook-protocol for value at module
 * evaluation, so the package must be installed into the consuming dsh profile.
 * A profile sets `autoInstallPeers: false`, which makes a peer contract a
 * declaration the host can never satisfy: the import throws
 * ERR_MODULE_NOT_FOUND and the plugin registers no surface at all (issue #110).
 *
 * A self-provisioned `dependencies` entry is the shape pnpm installs, and the
 * host-alignment gate requires it to carry the support range. The exact dev
 * mirror of a peer is neither effective nor meaningful here: a package
 * declared in both sections resolves to the dependency range alone (measured
 * with the repository-pinned pnpm 11.17.0), so the mirror would only suggest
 * that the tests run on the 0.2.1-rc.2 baseline while they run on the floor
 * copy the profile installs.
 *
 * This test reads the real root manifest, so it fails on the pre-fix manifest,
 * which declared the package as a required peer with that dev mirror.
 */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const PACKAGE = '@deepseek-ai/dsh-hook-protocol'
/** The support window the gate forces on a self-provisioned host package. */
const SUPPORT_RANGE = '>=0.2.0-rc.2 <0.3.0-0'

interface Manifest {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  devDependencies?: Record<string, string>
}

/** Every way the hook protocol can fail to reach a consuming profile. */
function provisioningViolations(manifest: Manifest): string[] {
  const violations: string[] = []
  const dependency = manifest.dependencies?.[PACKAGE]
  if (dependency === undefined) violations.push(`${PACKAGE} is not a dependency, so pnpm installs it into no profile`)
  else if (dependency !== SUPPORT_RANGE) violations.push(`dependencies["${PACKAGE}"] is ${dependency}, expected ${SUPPORT_RANGE}`)
  if (manifest.peerDependencies?.[PACKAGE] !== undefined) violations.push(`${PACKAGE} is still a peer contract, and a profile sets autoInstallPeers: false`)
  if (manifest.peerDependenciesMeta?.[PACKAGE] !== undefined) violations.push(`${PACKAGE} still has a peerDependenciesMeta entry`)
  if (manifest.devDependencies?.[PACKAGE] !== undefined) violations.push(`devDependencies["${PACKAGE}"] mirrors a self-provisioned package and is inert`)
  return violations
}

describe('hook protocol provisioning', () => {
  it('declares the hook protocol as a self-provisioned dependency and nowhere else', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../../../package.json', import.meta.url), 'utf8')) as Manifest
    expect(provisioningViolations(manifest)).toEqual([])
  })

  it('reports the pre-fix shape, where a required peer was the only declaration', () => {
    const preFix: Manifest = {
      peerDependencies: { [PACKAGE]: SUPPORT_RANGE },
      devDependencies: { [PACKAGE]: '0.2.1-rc.2' },
      dependencies: {}
    }
    expect(provisioningViolations(preFix)).toEqual([
      `${PACKAGE} is not a dependency, so pnpm installs it into no profile`,
      `${PACKAGE} is still a peer contract, and a profile sets autoInstallPeers: false`,
      `devDependencies["${PACKAGE}"] mirrors a self-provisioned package and is inert`
    ])
  })

  it('rejects a dependency that drifts from the support range', () => {
    expect(provisioningViolations({ dependencies: { [PACKAGE]: '^0.2.1-rc.2' } })).toEqual([`dependencies["${PACKAGE}"] is ^0.2.1-rc.2, expected ${SUPPORT_RANGE}`])
  })
})
