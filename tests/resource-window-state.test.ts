import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { resolveFavoriteInput, RESOURCE_FACE_ORDER } from '../packages/market-contracts/src/contracts/resource-window.js'
import { allFiltersOn, loadResourceFilters, resolveOffEntries, saveResourceFilters } from '../packages/market-runtime/src/application/state/resource-filters.js'
import { loadSurfaceToggles, saveSurfaceToggles, surfaceTogglesPath } from '../packages/market-runtime/src/application/state/surface-toggles.js'
import { ALL_SURFACES_ON } from '../packages/market-contracts/src/contracts/surface-toggles.js'
import { deleteResourceFavorite, loadResourceFavorites, resourceFavoritesPath, saveResourceFavorite } from '../packages/market-runtime/src/application/state/resource-favorites.js'

describe('resolveOffEntries', () => {
  it('keeps string arrays on known faces and drops everything else', () => {
    expect(resolveOffEntries(undefined)).toEqual({})
    expect(resolveOffEntries('nope')).toEqual({})
    expect(
      resolveOffEntries({
        mcp: ['mcp:alpha__db', 42, ''],
        lsp: 'not-a-list',
        mystery: ['x']
      })
    ).toEqual({ mcp: ['mcp:alpha__db'] })
  })
})

describe('resource filter state roundtrip', () => {
  it('persists per workspace beside the surface toggles and loads both together', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'resource-filters-'))
    const workspace = '/ws/resource-window'
    await saveResourceFilters(dataRoot, workspace, {
      toggles: { ...ALL_SURFACES_ON, mcp: false },
      offEntries: { mcp: ['mcp:alpha__db'], skills: ['skills:dsh-doc'] }
    })
    const loaded = await loadResourceFilters(dataRoot, workspace)
    expect(loaded.toggles.mcp).toBe(false)
    expect(loaded.offEntries).toEqual({ mcp: ['mcp:alpha__db'], skills: ['skills:dsh-doc'] })
    // Same file as the v1 toggles: one document answers both reads.
    expect(await loadSurfaceToggles(dataRoot, workspace)).toEqual({ ...ALL_SURFACES_ON, mcp: false })
  })

  it('reads all-on defaults for a workspace with no document', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'resource-filters-'))
    expect(await loadResourceFilters(dataRoot, '/nowhere')).toEqual(allFiltersOn())
  })

  it('keeps the entries section when a single surface toggle flips', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'resource-filters-'))
    const workspace = '/ws/shared-document'
    await saveResourceFilters(dataRoot, workspace, { toggles: { ...ALL_SURFACES_ON }, offEntries: { lsp: ['lsp:direct/json'] } })
    // The surface-toggle writer must not drop the entry filters.
    await saveSurfaceToggles(dataRoot, workspace, { ...ALL_SURFACES_ON, agents: false })
    const reloaded = await loadResourceFilters(dataRoot, workspace)
    expect(reloaded.offEntries).toEqual({ lsp: ['lsp:direct/json'] })
    expect(reloaded.toggles.agents).toBe(false)
  })

  it('degrades a hand-edited malformed entries record to the known faces', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'resource-filters-'))
    const workspace = '/ws/hand-edited'
    await saveResourceFilters(dataRoot, workspace, { toggles: { ...ALL_SURFACES_ON }, offEntries: { mcp: ['mcp:alpha__db'] } })
    const path = surfaceTogglesDocumentPath(dataRoot, workspace)
    const document = JSON.parse(await readFile(path, 'utf8')) as { entries: Record<string, unknown> }
    document.entries.mcp = 'corrupted'
    document.entries.unknown = ['x']
    await writeFile(path, JSON.stringify(document, null, 2) + '\n')
    const loaded = await loadResourceFilters(dataRoot, workspace)
    expect(loaded.offEntries).toEqual({})
  })
})

/** The shared document path both writers target (the v1 toggles path). */
function surfaceTogglesDocumentPath(dataRoot: string, workspace: string): string {
  return surfaceTogglesPath(dataRoot, workspace)
}

describe('resource favorites storage', () => {
  it('normalizes data-root separators in every persisted resource path', () => {
    const dataRoot = join(tmpdir(), 'resource-paths') + sep
    const togglePath = surfaceTogglesPath(dataRoot, '/workspace')
    expect(resourceFavoritesPath(dataRoot)).toBe(join(dataRoot, 'resource-favorites.json'))
    expect(togglePath).toBe(join(dataRoot, 'surface-toggles', basename(togglePath)))
  })

  it('roundtrips a favorite in the global data-root file', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'resource-favorites-'))
    const stored = await saveResourceFavorite(dataRoot, {
      name: '前端开发',
      surfaces: { ...ALL_SURFACES_ON, lsp: false },
      offEntries: ['skills:database', 'mcp:hcs-api']
    })
    expect(stored.id).not.toBe('')
    const loaded = await loadResourceFavorites(dataRoot)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.name).toBe('前端开发')
    expect(loaded[0]!.surfaces.lsp).toBe(false)
    expect(loaded[0]!.offEntries).toEqual(['skills:database', 'mcp:hcs-api'])
    // The file lives under the data root, never inside a project.
    expect(resourceFavoritesPath(dataRoot)).toBe(join(dataRoot, 'resource-favorites.json'))
  })

  it('shares favorites across workspaces and deletes by id', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'resource-favorites-'))
    const a = await saveResourceFavorite(dataRoot, { name: 'A', surfaces: { ...ALL_SURFACES_ON }, offEntries: [] })
    const b = await saveResourceFavorite(dataRoot, { name: 'B', surfaces: { ...ALL_SURFACES_ON }, offEntries: ['mcp:x'] })
    expect((await loadResourceFavorites(dataRoot)).map(favorite => favorite.name)).toEqual(['A', 'B'])
    await deleteResourceFavorite(dataRoot, a.id)
    const remaining = await loadResourceFavorites(dataRoot)
    expect(remaining.map(favorite => favorite.id)).toEqual([b.id])
    // Deleting a missing id is a no-op.
    await deleteResourceFavorite(dataRoot, 'not-there')
    expect(await loadResourceFavorites(dataRoot)).toHaveLength(1)
  })

  it('drops malformed rows from a hand-edited file', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'resource-favorites-'))
    await saveResourceFavorite(dataRoot, { name: 'good', surfaces: { ...ALL_SURFACES_ON }, offEntries: [] })
    const path = resourceFavoritesPath(dataRoot)
    const document = JSON.parse(await readFile(path, 'utf8')) as { favorites: unknown[] }
    document.favorites.push({ id: 42 }, { name: 'no-id' }, null)
    await writeFile(path, JSON.stringify(document, null, 2) + '\n')
    const loaded = await loadResourceFavorites(dataRoot)
    expect(loaded.map(favorite => favorite.name)).toEqual(['good'])
  })
})

describe('resolveFavoriteInput', () => {
  it('accepts a well-formed snapshot and normalizes unknown surface keys to on', () => {
    const resolved = resolveFavoriteInput({ name: '  daily  ', surfaces: { mcp: false, bogus: false }, offEntries: ['skills:x', 7] })
    expect(resolved).toEqual({ name: 'daily', surfaces: { ...ALL_SURFACES_ON, mcp: false }, offEntries: ['skills:x'] })
  })

  it('rejects a missing or blank name', () => {
    expect(resolveFavoriteInput(undefined)).toBeUndefined()
    expect(resolveFavoriteInput({ name: '   ', surfaces: {}, offEntries: [] })).toBeUndefined()
  })

  it('covers the six window faces in contract order', () => {
    expect(RESOURCE_FACE_ORDER).toEqual(['market', 'skills', 'commands', 'agents', 'mcp', 'lsp'])
  })
})
