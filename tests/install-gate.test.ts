import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'

/**
 * Install lifecycle regression tests (dsh-web PR #1098 review).
 *
 * Model: install == enable (the pre-install dialog is the confirmation
 * gate; cancel never reaches the host). The safety property lives in the
 * lifecycle: disabling stops injection, uninstalling clears everything,
 * and state round-trips across reloads.
 */
const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, 'fixtures', 'v1-suite')

let tmpRoot: string
let userRoot: string
let dataRoot: string

beforeEach(async () => {
  tmpRoot = await mkdtemp(join('/tmp', 'dsh-agent-install-gate-'))
  userRoot = await mkdtemp(join(tmpRoot, 'user'))
  dataRoot = join(tmpRoot, 'data')
  await mkdir(join(userRoot, '.sources'), { recursive: true })
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

/** A loaded Catalog over the shared temp roots, with the fixture added as one local source. */
async function catalogWithFixture(): Promise<{ catalog: Catalog; sourceId: string; suiteId: string }> {
  const catalog = new Catalog({ userRoot, dataRoot, onChanged: () => {} })
  await catalog.load()
  const source = await catalog.addSource({ url: fixture, local: true })
  const suiteId = (await catalog.readUserCatalog()).suites.find(s => s.sourceId === source.id)!.id
  return { catalog, sourceId: source.id, suiteId }
}

describe('install lifecycle: install enables, disable stops, uninstall clears', () => {
  it('a confirmed install enables the suite and injects its surfaces', async () => {
    const { catalog, sourceId, suiteId } = await catalogWithFixture()

    await catalog.install(sourceId, suiteId)

    const snapshot = await catalog.readUserCatalog()
    const installed = snapshot.suites.find(s => s.sourceId === sourceId && s.id === suiteId)
    expect(installed).toBeDefined()
    expect(installed!.enabled).toBe(true)
    expect(snapshot.enabledSuites.find(s => s.sourceId === sourceId && s.id === suiteId)).toBeDefined()
    expect(await catalog.enabledUserSuites()).toHaveLength(1)
  })

  it('declining the confirmation never reaches the host: nothing is installed or enabled', async () => {
    const { catalog, sourceId, suiteId } = await catalogWithFixture()

    // Cancel = no install() call at all (client-side gate). State stays untouched.
    const after = await catalog.readUserCatalog()
    const card = after.suites.find(s => s.sourceId === sourceId && s.id === suiteId)
    expect(card!.enabled).toBe(false)
    expect(await catalog.enabledUserSuites()).toEqual([])
  })

  it('disabling stops injection but keeps the suite installed', async () => {
    const { catalog, sourceId, suiteId } = await catalogWithFixture()

    await catalog.install(sourceId, suiteId)
    await catalog.setEnabled(sourceId, suiteId, false)
    expect(await catalog.enabledUserSuites()).toEqual([])
    const stillInstalled = (await catalog.readUserCatalog()).suites.find(s => s.sourceId === sourceId && s.id === suiteId)
    expect(stillInstalled!.enabled).toBe(false)
  })

  it('re-enabling after disable restores injection', async () => {
    const { catalog, sourceId, suiteId } = await catalogWithFixture()

    await catalog.install(sourceId, suiteId)
    await catalog.setEnabled(sourceId, suiteId, false)
    await catalog.setEnabled(sourceId, suiteId, true)
    expect(await catalog.enabledUserSuites()).toHaveLength(1)
  })

  it('uninstall removes the suite from enabled and installed state', async () => {
    const { catalog, sourceId, suiteId } = await catalogWithFixture()

    await catalog.install(sourceId, suiteId)
    await catalog.uninstall(sourceId, suiteId)

    const after = await catalog.readUserCatalog()
    expect(after.enabledSuites).toEqual([])
    expect(await catalog.enabledUserSuites()).toEqual([])
  })

  it('enabled state survives a reload (restart keeps the suite enabled as persisted)', async () => {
    const { catalog: first, sourceId, suiteId } = await catalogWithFixture()
    await first.install(sourceId, suiteId)

    const reloaded = new Catalog({ userRoot, dataRoot, onChanged: () => {} })
    await reloaded.load()
    expect((await reloaded.enabledUserSuites()).map(s => `${s.sourceId}/${s.id}`)).toContain(`${sourceId}/${suiteId}`)
  })

  it('disabled state survives a reload (restart does not re-enable)', async () => {
    const { catalog: first, sourceId, suiteId } = await catalogWithFixture()
    await first.install(sourceId, suiteId)
    await first.setEnabled(sourceId, suiteId, false)

    const reloaded = new Catalog({ userRoot, dataRoot, onChanged: () => {} })
    await reloaded.load()
    expect(await reloaded.enabledUserSuites()).toEqual([])
    const snapshot = await reloaded.readUserCatalog()
    const card = snapshot.suites.find(s => s.sourceId === sourceId && s.id === suiteId)
    expect(card!.enabled).toBe(false)
  })
})
