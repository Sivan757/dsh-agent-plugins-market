import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'

const fixture = join(process.cwd(), 'tests', 'fixtures', 'v1-suite')

/** A temp user root with the v1-suite fixture checked out as local source `demo`. */
async function seededUserRoot(prefix: string): Promise<string> {
  const userRoot = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(userRoot, '.sources', 'demo'), { recursive: true })
  await cp(fixture, join(userRoot, '.sources', 'demo'), { recursive: true })
  return userRoot
}

describe('Catalog application module', () => {
  it('reuses a coherent user snapshot until a mutation invalidates it', async () => {
    const userRoot = await seededUserRoot('dsh-agent-plugins-catalog-')
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged: () => {} })
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
    const userRoot = await seededUserRoot('dsh-agent-plugins-catalog-ttl-')
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged: () => {}, userSnapshotTtlMs: 10 })
    await catalog.load()
    await catalog.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])
    const before = await catalog.readUserCatalog()
    const [beforeSuite] = before.suites
    if (beforeSuite === undefined) throw new Error('expected the demo source to scan one suite before the refresh')
    expect(beforeSuite.skills.map(skill => skill.name)).not.toContain('late-skill')
    // Drop a new skill into the working tree out of band, then let the tiny
    // TTL lapse (a macrotask gap suffices for a 10ms window).
    await mkdir(join(userRoot, '.sources', 'demo', 'skills', 'late'), { recursive: true })
    await writeFile(join(userRoot, '.sources', 'demo', 'skills', 'late', 'SKILL.md'), '---\nname: late-skill\ndescription: late\n---\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    const after = await catalog.readUserCatalog()
    expect(after).not.toBe(before)
    const [afterSuite] = after.suites
    if (afterSuite === undefined) throw new Error('expected the demo source to still scan one suite after the refresh')
    expect(afterSuite.skills.map(skill => skill.name)).toContain('late-skill')
    await rm(userRoot, { recursive: true, force: true })
  })

  it('commits a mutation without waiting for the runtime change callback', async () => {
    const userRoot = await seededUserRoot('dsh-agent-plugins-catalog-await-')
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
    let passes = 0
    const catalog = new Catalog({
      userRoot,
      dataRoot: join(userRoot, 'data'),
      agentsRoot: join(userRoot, 'agents'),
      onChanged: async () => {
        passes++
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

    // The mutation resolves while the callback is still gated: its state is
    // durable, and the derived surfaces catch up behind it.
    await catalog.setEnabled('demo', 'v1-suite', false)
    await entered
    expect(callbackStarted).toBe(true)
    expect((await catalog.readUserCatalog()).enabledSuites).toEqual([])
    expect(await catalog.refreshSettled(0)).toBe(false)

    release()
    expect(await catalog.refreshSettled(1_000)).toBe(true)
    expect(passes).toBe(2)
  })

  it('keeps refreshing after a rejected pass', async () => {
    const userRoot = await seededUserRoot('dsh-agent-plugins-catalog-reject-')
    let passes = 0
    let fail = false
    const catalog = new Catalog({
      userRoot,
      dataRoot: join(userRoot, 'data'),
      agentsRoot: join(userRoot, 'agents'),
      onChanged: async () => {
        passes++
        if (fail) throw new Error('stage failed')
      }
    })
    await catalog.load()
    await catalog.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])
    fail = true
    await catalog.install('demo', 'v1-suite')
    expect(await catalog.refreshSettled(1_000)).toBe(true)

    // A failed pass must not wedge the queue: the next change still refreshes.
    fail = false
    await catalog.setEnabled('demo', 'v1-suite', false)
    expect(await catalog.refreshSettled(1_000)).toBe(true)
    expect(passes).toBe(2)
  })
})
