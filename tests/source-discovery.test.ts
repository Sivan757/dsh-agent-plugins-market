import { cp, mkdtemp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { discoverSourceList } from '../src/catalog/source-catalog.js'
import { Catalog } from '../src/application/catalog.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, 'fixtures', 'v1-suite')

describe('configured source discovery', () => {
  async function createUserRoot(): Promise<string> {
    const root = await mkdtemp(join('/tmp', 'dsh-agent-plugins-sources-'))
    await mkdir(join(root, '.sources'), { recursive: true })
    await cp(fixture, join(root, '.sources', 'configured'), { recursive: true })
    await cp(fixture, join(root, '.sources', 'stale-checkout'), { recursive: true })
    return root
  }

  it('does not count unmanaged checkout directories in the overview catalog', async () => {
    const root = await createUserRoot()
    const suites = await discoverSourceList([{ id: 'configured', url: 'https://example.test/configured.git' }], 'user', root)

    expect(suites.map(suite => suite.sourceId)).toEqual(['configured'])
  })

  it('reports source mutation progress without touching discovery state', async () => {
    const root = await createUserRoot()
    const manager = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), agentsRoot: join(root, 'agents'), onChanged: () => {} })

    expect(manager.sourceProgress()).toEqual({ active: false, sourceId: '', step: '' })
    manager.beginSourceState('configured', 'cloning', false)
    expect(manager.sourceProgress()).toEqual({ active: true, sourceId: 'configured', step: 'cloning' })
    manager.updateSourceStep('reading')
    expect(manager.sourceProgress()).toEqual({ active: true, sourceId: 'configured', step: 'reading' })
    manager.endSourceState()
    expect(manager.sourceProgress()).toEqual({ active: false, sourceId: '', step: '' })
  })

  it('keeps overview totals aligned with configured source rows', async () => {
    const root = await createUserRoot()
    const manager = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), agentsRoot: join(root, 'agents'), onChanged: () => {} })
    await manager.load()
    await manager.mergeSources([{ id: 'configured', url: 'https://example.test/configured.git' }])

    const overview = await manager.overview()
    expect(overview.totals.all).toBe(1)
    expect(overview.suites).toHaveLength(1)
    expect(overview.sources[0]?.suiteIds).toEqual(['v1-suite'])
  })
})
