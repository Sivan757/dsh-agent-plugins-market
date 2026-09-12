import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import * as discovery from '../src/catalog/source-catalog.js'
import { SuiteSkillProvider } from '../src/runtime/skills-provider.js'

const roots: string[] = []

async function setup(enabled = true): Promise<Catalog> {
  const userRoot = await mkdtemp(join(tmpdir(), 'market-runtime-'))
  roots.push(userRoot)
  for (const id of ['active', 'unused']) {
    await mkdir(join(userRoot, '.sources', id), { recursive: true })
    await cp(join(process.cwd(), 'tests/fixtures/v1-suite'), join(userRoot, '.sources', id), { recursive: true })
  }
  await writeFile(
    join(userRoot, 'state.json'),
    JSON.stringify({
      version: 1,
      sources: ['active', 'unused'].map(id => ({ id, url: join(userRoot, '.sources', id), local: true })),
      installed: { 'active/v1-suite': { enabled, installedAt: new Date(0).toISOString() } }
    })
  )
  const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
  await catalog.load()
  return catalog
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('runtime catalog discovery', () => {
  it('does no discovery for a cold skill list with no enabled installs', async () => {
    const catalog = await setup(false)
    const scan = vi.spyOn(discovery, 'discoverSourceListWithNotes')
    expect(await new SuiteSkillProvider(catalog).list({})).toEqual([])
    expect(await catalog.allMcpOverrides(await catalog.enabledUserSuites())).toEqual(new Map())
    expect(scan).not.toHaveBeenCalled()
  })

  it('coalesces cold runtime reads and leaves uninstalled sources to market discovery', async () => {
    const catalog = await setup()
    const scan = vi.spyOn(discovery, 'discoverSourceListWithNotes')
    const results = await Promise.all(Array.from({ length: 20 }, () => catalog.enabledUserSuites()))
    expect(results.every(suites => suites.length === 1 && suites[0]?.sourceId === 'active')).toBe(true)
    expect(scan).toHaveBeenCalledTimes(1)
    const [scanCall] = scan.mock.calls
    if (scanCall === undefined) throw new Error('expected the coalesced read to scan the source list once')
    expect(scanCall[0].map(source => source.id)).toEqual(['active'])
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
