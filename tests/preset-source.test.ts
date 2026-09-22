/**
 * The source record this plugin presets: registered on activation so the market
 * lists the first-party collection without the user pasting a URL, and an
 * ordinary Git source in every other respect.
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { PRESET_SOURCE_ID, PRESET_SOURCE_URL, presetSourceRef } from '../src/model/preset-source.js'

/** A loaded catalog over a fresh user root, seeded the way activation seeds it. */
async function catalogWithPresetSource(): Promise<Catalog> {
  const userRoot = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-preset-'))
  const manager = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged: () => {} })
  await manager.load()
  await manager.mergeSources([presetSourceRef()])
  return manager
}

describe('the preset source record', () => {
  it('is a git registration for the first-party collection', () => {
    expect(presetSourceRef()).toEqual({ id: PRESET_SOURCE_ID, url: PRESET_SOURCE_URL, kind: 'git' })
    expect(PRESET_SOURCE_URL).toContain('dsh-agent-plugins')
  })

  it('registers without acquiring anything', async () => {
    const catalog = await catalogWithPresetSource()
    const source = catalog.sources.find(entry => entry.id === PRESET_SOURCE_ID)
    if (source === undefined) throw new Error('expected the preset source in the catalog')
    expect(source.kind).toBe('git')
    expect(source.local).toBeUndefined()
    // Registered, not cloned: the ordinary refresh path is what fetches the
    // suites, so no activation reaches the network.
    const row = (await catalog.overview()).sources.find(entry => entry.id === PRESET_SOURCE_ID)
    if (row === undefined) throw new Error('expected the preset source in the overview')
    expect(row.cloned).toBe(false)
  })

  it('keeps a registration the user already owns and stays idempotent', async () => {
    const catalog = await catalogWithPresetSource()
    const first = catalog.sources
    await catalog.mergeSources([presetSourceRef()])
    expect(catalog.sources).toEqual(first)
  })

  it('leaves an edited registration alone, like any configured seed', async () => {
    const catalog = await catalogWithPresetSource()
    await catalog.updateSource(PRESET_SOURCE_ID, { url: 'https://example.test/other.git' })
    await catalog.mergeSources([presetSourceRef()])
    expect(catalog.sources.find(entry => entry.id === PRESET_SOURCE_ID)?.url).toBe('https://example.test/other.git')
  })

  it('is removed by the ordinary source route', async () => {
    const catalog = await catalogWithPresetSource()
    await catalog.removeSource(PRESET_SOURCE_ID)
    expect(catalog.sources.some(entry => entry.id === PRESET_SOURCE_ID)).toBe(false)
  })
})
