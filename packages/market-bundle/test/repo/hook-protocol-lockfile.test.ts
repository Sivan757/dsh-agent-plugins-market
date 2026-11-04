/**
 * The hook protocol resolved two copies until the support floor reached the bridge's line: the
 * plugin's self-provisioned dependency sat on the floor, and the dev-only bridge needed its exact
 * peer side by side, because a prerelease comparator matches only its own tuple and the floor was
 * a tuple behind. Root `.pnpmfile.cjs` kept them apart.
 *
 * Raising the floor to the tested baseline made both comparisons name the same version, so one
 * copy serves both, and the hook lost its reason. It was deleted in the same change. This file
 * guards that end state, so a second copy cannot come back unnoticed.
 */
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { HOST_SUPPORT_RANGE } from '../../../../scripts/host-support-window.mjs'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const PROTOCOL = '@deepseek-ai/dsh-hook-protocol'
const BRIDGE = '@deepseek-ai/dsh-hooks-claude-code'
const HOOK = '.pnpmfile.cjs'

interface Lockfile {
  importers: Record<string, { dependencies?: Record<string, { specifier: string; version: string }> }>
  packages: Record<string, unknown>
  pnpmfileChecksum?: string
}

/** The floor the support window starts at: the version a profile install receives. */
const floor = /^>=\s*([^\s]+)/.exec(HOST_SUPPORT_RANGE)?.[1] ?? ''

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
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

describe('hook protocol resolution', () => {
  it('resolves one copy, at the floor the window declares', () => {
    expect(manifest.dependencies[PROTOCOL]).toBe(HOST_SUPPORT_RANGE)
    expect(floor).not.toBe('')
    expect(versions).toEqual([floor])
    const importer = lockfile.importers['.']?.dependencies?.[PROTOCOL]?.version ?? ''
    expect(importer.split('(')[0]).toBe(floor)
  })

  it('carries the bridge on the same version, so it needs no nested copy', () => {
    expect(installedBridge.peerDependencies?.[PROTOCOL]).toBe(floor)
  })

  it('needs no dev-tree hook to keep a second copy alive', () => {
    expect(existsSync(join(ROOT, HOOK))).toBe(false)
    expect(lockfile.pnpmfileChecksum).toBeUndefined()
  })

  it('keeps the dev-only root files out of the published files list', () => {
    expect(manifest.files).not.toContain(HOOK)
    expect(manifest.files).not.toContain('pnpm-workspace.yaml')
    expect(manifest.files).not.toContain('pnpm-lock.yaml')
  })
})
