import { fileURLToPath } from 'node:url'
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Catalog } from '../../../../packages/market-bundle/src/application/catalog.js'
import * as discovery from '../../../../packages/market-catalog/src/scanning/source-catalog.js'
import { loadState } from '../../../market-catalog/src/application/state/state-store.js'
import { SuiteSkillProvider } from '../../../../packages/market-runtime/src/runtime/surfaces/skills-provider.js'
import { removeTempRoot } from './helpers/temp-root.js'

const roots: string[] = []
const catalogs: Catalog[] = []

async function setup(enabled = true, suiteId = 'v1-suite'): Promise<Catalog> {
  const userRoot = await mkdtemp(join(tmpdir(), 'market-runtime-'))
  roots.push(userRoot)
  for (const id of ['active', 'unused']) {
    await mkdir(join(userRoot, '.sources', id), { recursive: true })
    await cp(fileURLToPath(new URL('./fixtures/v1-suite', import.meta.url)), join(userRoot, '.sources', id), { recursive: true })
  }
  await writeFile(
    join(userRoot, 'state.json'),
    JSON.stringify({
      version: 1,
      sources: ['active', 'unused'].map(id => ({ id, url: join(userRoot, '.sources', id), local: true })),
      installed: { [`active/${suiteId}`]: { enabled, installedAt: new Date(0).toISOString() } }
    })
  )
  const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged: () => {} })
  catalogs.push(catalog)
  await catalog.load()
  return catalog
}

afterEach(async () => {
  await Promise.all(catalogs.splice(0).map(catalog => catalog.dispose()))
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(removeTempRoot))
})

describe('runtime catalog discovery', () => {
  it('does no discovery for a cold skill list with no enabled installs', async () => {
    const catalog = await setup(false)
    const scan = vi.spyOn(discovery, 'scanSourceCheckout')
    expect(await new SuiteSkillProvider(catalog).list({})).toEqual([])
    expect(await catalog.allMcpOverrides(await catalog.enabledUserSuites())).toEqual(new Map())
    expect(scan).not.toHaveBeenCalled()
  })

  it('coalesces cold runtime reads and leaves uninstalled sources to market discovery', async () => {
    const catalog = await setup()
    const scan = vi.spyOn(discovery, 'scanSourceCheckout')
    const results = await Promise.all(Array.from({ length: 20 }, () => catalog.enabledUserSuites()))
    expect(results.every(suites => suites.length === 1 && suites[0]?.sourceId === 'active')).toBe(true)
    expect(scan).toHaveBeenCalledTimes(1)
    const [scanCall] = scan.mock.calls
    if (scanCall === undefined) throw new Error('expected the coalesced read to scan the source list once')
    expect(scanCall[0].sourceId).toBe('active')
    await catalog.allMcpOverrides(results[0])
    expect(scan).toHaveBeenCalledTimes(1)
    expect((await catalog.readUserCatalog()).suites).toHaveLength(2)
    expect(scan).toHaveBeenCalledTimes(2)
    await catalog.setEnabled('active', 'v1-suite', false)
    expect(await catalog.enabledUserSuites()).toEqual([])
    await catalog.setEnabled('active', 'v1-suite', true)
    expect(await catalog.enabledUserSuites()).toHaveLength(1)
    expect(scan).toHaveBeenCalledTimes(2)
  })

  it('shares installed declarations and status reads while leaving uninstalled sources untouched', async () => {
    const catalog = await setup(false)
    const scan = vi.spyOn(discovery, 'scanSourceCheckout')
    const declarations = await catalog.installedSuiteDeclarations()
    expect(declarations).toHaveLength(1)
    expect(declarations[0]?.suite.enabled).toBe(false)
    const snapshot = await catalog.readInstalledCatalog()
    expect(await catalog.readInstalledCatalog()).toBe(snapshot)
    await Promise.all([catalog.installedOverview(), catalog.mcpStatus(true), catalog.lspStatus(true)])
    expect(scan).toHaveBeenCalledTimes(1)
    expect(scan.mock.calls[0]?.[0].sourceId).toBe('active')
  })

  it('retains and diagnoses an install whose identity no longer resolves', async () => {
    const catalog = await setup(false, 'old-id')
    const snapshot = await catalog.readInstalledCatalog()
    expect(snapshot.suites).toEqual([])
    expect(snapshot.scanNotes?.active).toEqual([expect.stringContaining('old-id')])
    const state = await loadState(join(catalog.userRoot, 'state.json'))
    expect(state.installed['active/old-id']).toMatchObject({ enabled: false })
  })

  it('keeps source notes separate from installation diagnostics across scopes and uninstall', async () => {
    const catalog = await setup(false, 'old-id')
    const original = discovery.scanSourceCheckout
    vi.spyOn(discovery, 'scanSourceCheckout').mockImplementationOnce(async (...args) => {
      const result = await original(...args)
      return { ...result, notes: ['source import diagnostic'] }
    })
    expect((await catalog.readInstalledCatalog()).scanNotes?.active).toHaveLength(2)
    expect((await catalog.readUserCatalog()).scanNotes?.active).toHaveLength(2)
    await catalog.uninstall('active', 'old-id')
    expect((await catalog.readUserCatalog()).scanNotes?.active).toEqual(['source import diagnostic'])
  })

  it('keeps a completed source refresh visible when a later source in the batch fails', async () => {
    const catalog = await setup()
    await catalog.readUserCatalog()
    const skill = join(catalog.userRoot, '.sources', 'active', 'skills', 'later')
    await mkdir(skill, { recursive: true })
    await writeFile(join(skill, 'SKILL.md'), '---\nname: later\ndescription: Refreshed before another source fails\n---\n')
    await rm(join(catalog.userRoot, '.sources', 'unused'), { recursive: true })
    await expect(catalog.refreshSource()).rejects.toThrow('local source directory')
    expect((await catalog.readInstalledCatalog()).suites[0]?.skills.map(entry => entry.name)).toContain('later')
  })

  it('invalidates both runtime and market discovery on a local source refresh', async () => {
    const catalog = await setup()
    await catalog.enabledUserSuites()
    await catalog.readUserCatalog()
    const skillDir = join(catalog.userRoot, '.sources', 'active', 'skills', 'later')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: later\ndescription: Added after scan.\n---\n')
    await catalog.refreshSource('active')
    const [activeSuite] = await catalog.enabledUserSuites()
    if (activeSuite === undefined) throw new Error('expected the refreshed source to remain enabled')
    expect(activeSuite.skills.map(skill => skill.name)).toContain('later')
    expect((await catalog.readUserCatalog()).suites.find(suite => suite.sourceId === 'active')!.skills.map(skill => skill.name)).toContain('later')
  })
})
