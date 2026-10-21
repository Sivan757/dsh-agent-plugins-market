/**
 * The hook in `.pnpmfile.cjs` is accepted on one condition: the plugin's own
 * dependency keeps resolving the copy a profile installs, and the nested copy
 * exists only for the dev-only bridge. That is a lockfile property, and it is
 * checked here without a semver resolver: read the declared range's floor,
 * read the bridge's own declaration, and require exactly those two versions.
 *
 * When the support floor eventually reaches the bridge's line, the two
 * versions coincide and the nested copy stops being needed. The predicate
 * below reports that state as one violation whose message names the hook as
 * deletable, so the hook cannot outlive its reason.
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const PROTOCOL = '@deepseek-ai/dsh-hook-protocol'
const BRIDGE = '@deepseek-ai/dsh-hooks-claude-code'
const HOOK = '.pnpmfile.cjs'

interface Lockfile {
  importers: Record<string, { dependencies?: Record<string, { specifier: string; version: string }> }>
  packages: Record<string, unknown>
  snapshots: Record<string, { dependencies?: Record<string, string> }>
}
interface Split {
  declaredRange: string
  importerVersion: string | undefined
  bridgeDeclared: string | undefined
  versions: string[]
}

/** A lockfile version value without its peer-suffix parentheses. */
const versionOf = (value: string | undefined): string => (value ?? '').split('(')[0] ?? ''

/**
 * Every way the two-copy resolution can stop being what the hook was accepted
 * for, in the words the next reader needs.
 *
 * The merged case is a failure on purpose: once the floor reaches the bridge's
 * line, one copy serves both, and keeping the hook would hide that the nested
 * copy is gone.
 */
function resolutionViolations({ declaredRange, importerVersion, bridgeDeclared, versions }: Split): string[] {
  const violations: string[] = []
  const floor = /^>=\s*([^\s]+)/.exec(declaredRange)?.[1]
  if (floor === undefined) return [`cannot read a floor out of the declared range ${declaredRange}`]
  if (importerVersion === undefined) violations.push(`the root importer no longer depends on ${PROTOCOL}`)
  else if (versionOf(importerVersion) !== floor) violations.push(`the root importer resolves ${versionOf(importerVersion)}, expected the declared floor ${floor}`)
  if (bridgeDeclared === undefined) {
    violations.push(`the dev bridge no longer declares a ${PROTOCOL} peer, so ${HOOK} has no reason to exist`)
  } else if (floor === bridgeDeclared) {
    violations.push(`the protocol floor ${floor} reached the bridge line ${bridgeDeclared}, so one copy serves both: delete ${HOOK} and the nested copy it creates`)
  } else {
    const expected = [floor, bridgeDeclared].sort()
    if (versions.length !== expected.length || versions.some((version, index) => version !== expected[index])) {
      violations.push(`expected exactly the floor ${floor} and the bridge declaration ${bridgeDeclared} in pnpm-lock.yaml, found ${versions.join(', ') || 'none'}`)
    }
  }
  return violations
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  files: string[]
}
const lockfile = parse(await readFile(join(ROOT, 'pnpm-lock.yaml'), 'utf8')) as Lockfile
const installedBridge = JSON.parse(readFileSync(createRequire(import.meta.url).resolve(`${BRIDGE}/package.json`), 'utf8')) as {
  peerDependencies?: Record<string, string>
}
/** Every distinct protocol version the lockfile records, from the package table. */
const versions = Object.keys(lockfile.packages)
  .filter(key => key.startsWith(`${PROTOCOL}@`))
  .map(key => key.slice(PROTOCOL.length + 1))
  .sort()
const bridgeSnapshot = Object.keys(lockfile.snapshots).find(key => key.startsWith(`${BRIDGE}@`))

describe('hook protocol resolution split', () => {
  it('resolves the plugin to the floor and the dev-only bridge to its own declared line', () => {
    expect(
      resolutionViolations({
        declaredRange: manifest.dependencies[PROTOCOL] ?? '',
        importerVersion: lockfile.importers['.']?.dependencies?.[PROTOCOL]?.version,
        bridgeDeclared: installedBridge.peerDependencies?.[PROTOCOL],
        versions
      })
    ).toEqual([])
    // The bridge snapshot is the only holder of the second copy.
    expect(versionOf(lockfile.snapshots[bridgeSnapshot ?? '']?.dependencies?.[PROTOCOL])).toBe(installedBridge.peerDependencies?.[PROTOCOL])
  })

  it('reports the merged state as one violation that names the hook as deletable', () => {
    expect(resolutionViolations({ declaredRange: '>=0.2.1-rc.2 <0.3.0-0', importerVersion: '0.2.1-rc.2()', bridgeDeclared: '0.2.1-rc.2', versions: ['0.2.1-rc.2'] })).toEqual([
      `the protocol floor 0.2.1-rc.2 reached the bridge line 0.2.1-rc.2, so one copy serves both: delete ${HOOK} and the nested copy it creates`
    ])
  })

  it('reports a drifted importer and a missing bridge as separate violations', () => {
    expect(
      resolutionViolations({ declaredRange: '>=0.2.0-rc.2 <0.3.0-0', importerVersion: '0.2.1-rc.2()', bridgeDeclared: undefined, versions: ['0.2.0-rc.2', '0.2.1-rc.2'] })
    ).toEqual([
      `the root importer resolves 0.2.1-rc.2, expected the declared floor 0.2.0-rc.2`,
      `the dev bridge no longer declares a ${PROTOCOL} peer, so ${HOOK} has no reason to exist`
    ])
  })

  it('reports a third copy and a missing copy', () => {
    expect(
      resolutionViolations({
        declaredRange: '>=0.2.0-rc.2 <0.3.0-0',
        importerVersion: '0.2.0-rc.2()',
        bridgeDeclared: '0.2.1-rc.2',
        versions: ['0.2.0-rc.2', '0.2.1-rc.2', '0.2.2-rc.1']
      })
    ).toHaveLength(1)
    expect(resolutionViolations({ declaredRange: '>=0.2.0-rc.2 <0.3.0-0', importerVersion: '0.2.0-rc.2()', bridgeDeclared: '0.2.1-rc.2', versions: ['0.2.0-rc.2'] })).toHaveLength(
      1
    )
  })

  it('keeps the hook out of the published files list', () => {
    expect(manifest.files).not.toContain(HOOK)
    expect(manifest.files).not.toContain('pnpm-workspace.yaml')
  })

  it('keeps the protocol off both peer sections, so a profile cannot need it supplied', () => {
    expect(manifest.peerDependencies?.[PROTOCOL]).toBeUndefined()
    expect(manifest.devDependencies?.[PROTOCOL]).toBeUndefined()
  })
})
