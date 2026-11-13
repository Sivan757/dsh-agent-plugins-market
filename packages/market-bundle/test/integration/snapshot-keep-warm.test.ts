/** User snapshots never schedule discovery; mutable working trees are observed by the next expired read. */
import { fileURLToPath } from 'node:url'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Catalog } from '../../src/application/catalog.js'
import * as discovery from '../../../market-catalog/src/scanning/source-catalog.js'
import { removeTempRoot } from './helpers/temp-root.js'

const fixture = fileURLToPath(new URL('./fixtures/v1-suite', import.meta.url))
const roots: string[] = []
const catalogs: Catalog[] = []
const TTL = 1_000

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(catalogs.splice(0).map(catalog => catalog.dispose()))
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(removeTempRoot))
})

async function setup(now?: () => number): Promise<Catalog> {
  const root = await mkdtemp(join(tmpdir(), 'market-snapshot-freshness-'))
  roots.push(root)
  const checkout = join(root, '.sources', 'demo')
  await cp(fixture, checkout, { recursive: true })
  const catalog = new Catalog({
    userRoot: root,
    dataRoot: join(root, 'data'),
    agentsRoot: join(root, 'agents'),
    onChanged: () => {},
    userSnapshotTtlMs: TTL,
    ...(now === undefined ? {} : { now })
  })
  catalogs.push(catalog)
  await catalog.load()
  await catalog.mergeSources([{ id: 'demo', url: checkout, local: true }])
  return catalog
}

async function edit(catalog: Catalog): Promise<void> {
  const dir = join(catalog.userRoot, '.sources', 'demo', 'skills', 'late')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '---\nname: late-skill\ndescription: Added locally\n---\n')
}

describe('on-demand snapshot freshness', () => {
  it('does no background discovery after a user read, regardless of idle duration', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let now = 0
    const catalog = await setup(() => now)
    const scan = vi.spyOn(discovery, 'scanSourceCheckout')
    await catalog.readUserCatalog()
    expect(scan).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    await edit(catalog)
    now = 3_600_000
    await vi.advanceTimersByTimeAsync(now)
    expect(scan).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    const refreshed = await catalog.readUserCatalog()
    expect(refreshed.suites[0]?.skills.map(skill => skill.name)).toContain('late-skill')
    expect(scan).toHaveBeenCalledTimes(2)
    expect(await catalog.readUserCatalog()).toBe(refreshed)
  })

  it('retains mutable content within the bound and sees an edit on the next expired read', async () => {
    let now = 0
    const catalog = await setup(() => now)
    const seeded = await catalog.readUserCatalog()
    await edit(catalog)
    now = TTL - 1
    expect(await catalog.readUserCatalog()).toBe(seeded)
    now = TTL
    const refreshed = await catalog.readUserCatalog()
    expect(refreshed.suites[0]?.skills.map(skill => skill.name)).toContain('late-skill')
  })

  it('does not extend a mutable source bound when a second query scope derives its view', async () => {
    let now = 0
    const catalog = await setup(() => now)
    await catalog.install('demo', 'v1-suite')
    await catalog.readUserCatalog()
    await edit(catalog)
    now = TTL - 1
    const before = await catalog.readInstalledCatalog()
    expect(before.suites[0]?.skills.map(skill => skill.name)).not.toContain('late-skill')
    now = TTL
    const after = await catalog.readInstalledCatalog()
    expect(after.suites[0]?.skills.map(skill => skill.name)).toContain('late-skill')
  })

  it('uses the process clock when no clock is injected', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(0)
    const catalog = await setup()
    await catalog.readUserCatalog()
    await edit(catalog)
    vi.setSystemTime(TTL)
    const refreshed = await catalog.readUserCatalog()
    expect(refreshed.suites[0]?.skills.map(skill => skill.name)).toContain('late-skill')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('joins a discovery in flight before disposal completes and refuses later reads', async () => {
    const catalog = await setup()
    let release!: () => void
    const blocked = new Promise<void>(resolve => {
      release = resolve
    })
    let signalStarted!: () => void
    const started = new Promise<void>(resolve => {
      signalStarted = resolve
    })
    const original = discovery.scanSourceCheckout
    vi.spyOn(discovery, 'scanSourceCheckout').mockImplementation(async (...args) => {
      const result = await original(...args)
      signalStarted()
      await blocked
      return result
    })
    const read = catalog.readUserCatalog()
    await started
    let finished = false
    const disposal = catalog.dispose().then(() => {
      finished = true
    })
    try {
      await Promise.resolve()
      expect(finished).toBe(false)
      release()
      await Promise.all([read, disposal])
      expect(finished).toBe(true)
      await expect(catalog.readUserCatalog()).rejects.toThrow('disposed')
    } finally {
      release()
      await Promise.allSettled([read, disposal])
    }
  })
})
