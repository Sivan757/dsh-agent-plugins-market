import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'

const fixture = join(process.cwd(), 'tests', 'fixtures', 'v1-suite')

describe('Catalog application module', () => {
  it('reuses a coherent user snapshot until a mutation invalidates it', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-catalog-'))
    await mkdir(join(userRoot, '.sources', 'demo'), { recursive: true })
    await cp(fixture, join(userRoot, '.sources', 'demo'), { recursive: true })
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await catalog.load()
    await catalog.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])

    const first = await catalog.readUserCatalog()
    const second = await catalog.readUserCatalog()
    expect(second).toBe(first)
    expect(first.revision).toBe(1)
    expect(first.suites.map(suite => suite.id)).toEqual(['v1-suite'])

    await catalog.install('demo', 'v1-suite')
    const afterInstall = await catalog.readUserCatalog()
    expect(afterInstall).not.toBe(first)
    expect(afterInstall.revision).toBe(2)
    expect(afterInstall.enabledSuites.map(suite => suite.id)).toEqual(['v1-suite'])
  })

  it('expires the user snapshot after its TTL so out-of-band edits become visible', async () => {
    // Regression: the user snapshot was cached without a TTL, so a skill
    // dropped into a local source's working tree stayed invisible until the
    // next catalog mutation.
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-catalog-ttl-'))
    await mkdir(join(userRoot, '.sources', 'demo'), { recursive: true })
    await cp(fixture, join(userRoot, '.sources', 'demo'), { recursive: true })
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await catalog.load()
    await catalog.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])
    const before = await catalog.readUserCatalog()
    expect(before.suites[0]!.skills.map(skill => skill.name)).not.toContain('late-skill')
    // Drop a new skill into the working tree out of band, then wait out the TTL.
    await mkdir(join(userRoot, '.sources', 'demo', 'skills', 'late'), { recursive: true })
    await writeFile(join(userRoot, '.sources', 'demo', 'skills', 'late', 'SKILL.md'), '---\nname: late-skill\ndescription: late\n---\n')
    await new Promise(resolve => setTimeout(resolve, 30_200))
    const after = await catalog.readUserCatalog()
    expect(after).not.toBe(before)
    expect(after.suites[0]!.skills.map(skill => skill.name)).toContain('late-skill')
    await rm(userRoot, { recursive: true, force: true })
  }, 45_000)

  it('waits for the runtime change callback before a mutation resolves', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-catalog-await-'))
    await mkdir(join(userRoot, '.sources', 'demo'), { recursive: true })
    await cp(fixture, join(userRoot, '.sources', 'demo'), { recursive: true })
    let hold = false
    let callbackStarted = false
    let callbackEntered!: () => void
    const entered = new Promise<void>(resolve => {
      callbackEntered = resolve
    })
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const catalog = new Catalog({
      userRoot,
      dataRoot: join(userRoot, 'data'),
      onChanged: async () => {
        if (!hold) return
        callbackStarted = true
        callbackEntered()
        await gate
      }
    })
    await catalog.load()
    await catalog.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])
    await catalog.install('demo', 'v1-suite')
    hold = true

    const disabling = catalog.setEnabled('demo', 'v1-suite', false)
    await entered
    expect(callbackStarted).toBe(true)
    let settled = false
    void disabling.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    release()
    await disabling
    expect(settled).toBe(true)
  })
})
