/**
 * Concurrent global favorite mutations.
 *
 * The favorites file is one global document that every save and delete rewrites
 * in full, so two operations that each read it before either writes replace one
 * another: one favorite disappears, or a deleted one comes back. These cases
 * drive the real filesystem through the module's own API — no delays, no mocks —
 * and hold the contract that each operation applies exactly once on top of the
 * committed document.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ALL_SURFACES_ON } from '../packages/market-contracts/src/contracts/surface-toggles.js'
import type { ResourceFavoriteInput } from '../packages/market-contracts/src/contracts/resource-window.js'
import { deleteResourceFavorite, loadResourceFavorites, resourceFavoritesPath, saveResourceFavorite } from '../packages/market-runtime/src/application/state/resource-favorites.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function newDataRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'resource-favorites-'))
  roots.push(root)
  return root
}

/** One favorite input; every save carries a distinct name and entry id. */
function favoriteInput(name: string, entryId: string): ResourceFavoriteInput {
  return { name, surfaces: { ...ALL_SURFACES_ON, mcp: false }, offEntries: [entryId] }
}

/** The stored names, order-insensitive: the document's whole observable content here. */
async function storedNames(root: string): Promise<string[]> {
  return (await loadResourceFavorites(root)).map(favorite => favorite.name).sort()
}

describe('concurrent favorite mutations', () => {
  it('keeps both favorites when two saves run concurrently', async () => {
    const root = await newDataRoot()

    await Promise.all([saveResourceFavorite(root, favoriteInput('alpha', 'skills:alpha')), saveResourceFavorite(root, favoriteInput('beta', 'mcp:beta__db'))])

    expect(await storedNames(root)).toEqual(['alpha', 'beta'])
  })

  it('replays every distinct favorite when several saves run concurrently', async () => {
    const root = await newDataRoot()

    await Promise.all(['one', 'two', 'three', 'four'].map(name => saveResourceFavorite(root, favoriteInput(name, 'skills:' + name))))

    expect(await storedNames(root)).toEqual(['four', 'one', 'three', 'two'])
  })

  it('applies a concurrent save and delete without resurrecting or dropping a favorite', async () => {
    const root = await newDataRoot()
    const doomed = await saveResourceFavorite(root, favoriteInput('doomed', 'skills:doomed'))
    await saveResourceFavorite(root, favoriteInput('keeper', 'skills:keeper'))

    await Promise.all([deleteResourceFavorite(root, doomed.id), saveResourceFavorite(root, favoriteInput('added', 'skills:added'))])

    // Both operations land: the deletion stands and the addition is kept.
    expect(await storedNames(root)).toEqual(['added', 'keeper'])
  })

  it('stores the caller values as they were at the call, not as they are after the await', async () => {
    const root = await newDataRoot()
    const input = favoriteInput('snapshot', 'skills:snapshot')

    const pending = saveResourceFavorite(root, input)
    // The caller keeps its own object; the stored row is already captured.
    input.surfaces.mcp = true
    input.offEntries.push('skills:added-later')
    await pending

    const [stored] = await loadResourceFavorites(root)
    expect(stored?.surfaces.mcp).toBe(false)
    expect(stored?.offEntries).toEqual(['skills:snapshot'])
  })

  it('releases the write lock when an operation fails, so the next one proceeds', async () => {
    const root = await newDataRoot()
    // A directory where the document belongs: the read inside the locked section
    // fails deterministically, with no permission tricks and no delays.
    await mkdir(resourceFavoritesPath(root), { recursive: true })

    await expect(saveResourceFavorite(root, favoriteInput('blocked', 'skills:blocked'))).rejects.toThrow()

    await rm(resourceFavoritesPath(root), { recursive: true, force: true })
    await saveResourceFavorite(root, favoriteInput('after-failure', 'skills:after-failure'))
    expect(await storedNames(root)).toEqual(['after-failure'])
  })
})
