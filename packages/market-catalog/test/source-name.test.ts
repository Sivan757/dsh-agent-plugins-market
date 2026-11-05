/**
 * The name a reader recognizes a source by.
 *
 * A source id is a key, not a label: it comes from the URL's basename, so two
 * repositories called `skills` collide and the second is stored as `skills-2`.
 * The qualified display name answers with the path the repository lives at
 * (`jeecgboot/skills`) without moving that key — the id, the persisted state
 * and every `market:<sourceId>/<suiteId>` resource id depend on it.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { defaultCatalogPorts } from '../../market-contracts/src/ports/ports.js'
import type { Suite, SuiteLayoutKind } from '../../market-contracts/src/model/types.js'
import { CatalogContext } from '../src/application/catalog-context.js'
import { SourceStore } from '../src/application/source-store.js'
import type { CatalogSnapshot } from '../src/application/snapshot-cache.js'
import { deriveSourceIdCandidates } from '../src/scanning/paths.js'
import { qualifiedSourceName } from '../src/scanning/source-name.js'

/** One discovered suite, in the layout a source read it under. */
function suite(sourceId: string, id: string, layout: SuiteLayoutKind): Suite {
  return {
    sourceId,
    id,
    root: join('/checkouts', sourceId, id),
    manifest: { layout, path: '', id, name: id },
    skills: [],
    surfaces: { skills: 1, mcp: 0, hooks: 0, commands: 0, agents: 0, lsp: 0 },
    dimension: 'user',
    enabled: false,
    activeSurfaces: { skills: true, mcp: false, hooks: false, commands: false, agents: false, lsp: false },
    errors: []
  }
}

/** One snapshot holding a single source and the suites it contributed. */
function snapshotOf(source: { id: string; url: string; local?: boolean }, suites: Suite[]): CatalogSnapshot {
  return {
    revision: 1,
    sources: [{ id: source.id, url: source.url, kind: 'git', ...(source.local === true ? { local: true } : {}) }],
    suites,
    enabledSuites: []
  }
}

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** A store over a throwaway user root, so a checkout probe never reaches a real one. */
async function storeOverTemporaryRoot(): Promise<SourceStore> {
  const userRoot = await mkdtemp(join(tmpdir(), 'market-source-name-'))
  temporaryRoots.push(userRoot)
  const context = new CatalogContext({ userRoot, dataRoot: userRoot, agentsRoot: userRoot, onChanged: () => {} })
  return new SourceStore(context, defaultCatalogPorts)
}

describe('qualified source name', () => {
  it('names a remote skills-only source by its owner and its repository', () => {
    const name = qualifiedSourceName({ id: 'skills', url: 'https://github.com/jeecgboot/skills' }, [suite('skills', 'alpha', 'skill-collection')])
    expect(name).toBe('jeecgboot/skills')
  })

  it('names a collided source too, because its id says nothing about the owner', () => {
    const name = qualifiedSourceName({ id: 'skills-2', url: 'https://github.com/jeecgboot/skills' }, [suite('skills-2', 'alpha', 'skill-collection')])
    expect(name).toBe('jeecgboot/skills')
  })

  it('reads the owner from an scp-style remote too', () => {
    const name = qualifiedSourceName({ id: 'skills', url: 'git@github.com:jeecgboot/skills.git' }, [suite('skills', 'alpha', 'skill-collection')])
    expect(name).toBe('jeecgboot/skills')
  })

  it('says nothing when the id already names the owner', () => {
    const name = qualifiedSourceName({ id: 'jeecgboot-skills', url: 'https://github.com/jeecgboot/skills' }, [suite('jeecgboot-skills', 'alpha', 'skill-collection')])
    expect(name).toBeUndefined()
  })

  it('says nothing for a source that ships a plugin marketplace', () => {
    const name = qualifiedSourceName({ id: 'skills', url: 'https://github.com/jeecgboot/skills' }, [suite('skills', 'alpha', 'claude-code')])
    expect(name).toBeUndefined()
  })

  it('says nothing for a source that mixes skills with a plugin marketplace', () => {
    const name = qualifiedSourceName({ id: 'skills', url: 'https://github.com/jeecgboot/skills' }, [
      suite('skills', 'alpha', 'skill-collection'),
      suite('skills', 'beta', 'claude-code')
    ])
    expect(name).toBeUndefined()
  })

  it('says nothing for a local source, which has no owner to add', () => {
    const name = qualifiedSourceName({ id: 'skills', url: '/Users/sivan/skills', local: true }, [suite('skills', 'alpha', 'skill-collection')])
    expect(name).toBeUndefined()
  })

  it('leaves the id candidates alone', () => {
    // The id is persisted state: the candidates a new source is named by must not
    // move, or every stored source would change key.
    expect(deriveSourceIdCandidates('https://github.com/jeecgboot/skills')).toEqual(['skills', 'jeecgboot-skills'])
    expect(deriveSourceIdCandidates('git@github.com:jeecgboot/skills.git')).toEqual(['skills', 'jeecgboot-skills'])
    expect(deriveSourceIdCandidates('/Users/sivan/skills')).toEqual(['skills'])
  })
})

describe('the market overview row', () => {
  it('carries the qualified name and keeps the id exactly as it was', async () => {
    const store = await storeOverTemporaryRoot()
    const rows = await store.overviewRows(snapshotOf({ id: 'skills', url: 'https://github.com/jeecgboot/skills' }, [suite('skills', 'alpha', 'skill-collection')]))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('skills')
    expect(rows[0]!.displayName).toBe('jeecgboot/skills')
    expect(rows[0]!.suiteIds).toEqual(['alpha'])
  })

  it('reports no qualified name for a marketplace source, and still keeps the id', async () => {
    const store = await storeOverTemporaryRoot()
    const rows = await store.overviewRows(snapshotOf({ id: 'skills', url: 'https://github.com/jeecgboot/skills' }, [suite('skills', 'alpha', 'claude-code')]))
    expect(rows[0]!.id).toBe('skills')
    expect(rows[0]!.displayName).toBeUndefined()
  })
})
