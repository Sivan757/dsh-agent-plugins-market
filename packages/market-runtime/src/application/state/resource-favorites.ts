/**
 * Persisted cross-project resource favorites under the plugin data root.
 *
 * One global file (`resource-favorites.json`): a favorite is this user's
 * complete switch snapshot — six surface switches plus the per-entry filters —
 * captured once and applicable in any workspace. It is deliberately not
 * per-workspace state: the whole point is replaying one setup in another
 * project, and the entry ids it stores are workspace-independent (suite and
 * server identities, never absolute paths).
 *
 * @module application/state/resource-favorites
 */
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { readJsonFile, writeJsonDocument } from '../../../../market-catalog/src/index.js'
import { resolveFavoriteInput, type ResourceFavoriteInput, type ResourceFavoriteWire } from '../../../../market-contracts/src/contracts/resource-window.js'

/** The favorites file lives at the data root, beside the surface-toggles directory. */
export function resourceFavoritesPath(dataRoot: string): string {
  return join(dataRoot, 'resource-favorites.json')
}

interface FavoritesDocument {
  version: 1
  favorites: ResourceFavoriteWire[]
}

/** Parse one untrusted favorite wire record; malformed rows drop out. */
function resolveFavorite(row: unknown): ResourceFavoriteWire | undefined {
  const input = resolveFavoriteInput(row)
  if (input === undefined) return undefined
  if (typeof row !== 'object' || row === null) return undefined
  const record = row as Record<string, unknown>
  const id = typeof record.id === 'string' && record.id !== '' ? record.id : undefined
  const createdAt = typeof record.createdAt === 'string' && record.createdAt !== '' ? record.createdAt : new Date(0).toISOString()
  if (id === undefined) return undefined
  return { id, name: input.name, createdAt, surfaces: input.surfaces, offEntries: input.offEntries }
}

/** Load the global favorite list; absent or malformed means none. */
export async function loadResourceFavorites(dataRoot: string): Promise<ResourceFavoriteWire[]> {
  const value = await readJsonFile(resourceFavoritesPath(dataRoot))
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.favorites)) return []
  return record.favorites.flatMap(row => {
    const favorite = resolveFavorite(row)
    return favorite === undefined ? [] : [favorite]
  })
}

/**
 * Apply one mutation to the committed list and persist it as one transaction.
 *
 * The whole read-modify-write runs under the published host file lock, so two
 * operations can never each read the document before either writes it: the
 * second one re-reads what the first committed and applies its own change on
 * top. Readers stay lock-free — the atomic rename is what makes that safe — and
 * a failed operation releases the lock through the helper's own teardown.
 * @param dataRoot - the plugin's own storage root.
 * @param mutate - pure change applied to the freshly read list.
 * @returns the list as committed.
 */
async function mutateFavorites(dataRoot: string, mutate: (favorites: readonly ResourceFavoriteWire[]) => ResourceFavoriteWire[]): Promise<ResourceFavoriteWire[]> {
  const path = resourceFavoritesPath(dataRoot)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  return withFileLock(path, async () => {
    const next = mutate(await loadResourceFavorites(dataRoot))
    const document: FavoritesDocument = { version: 1, favorites: next }
    await writeJsonDocument(path, document)
    return next
  })
}

/** Append one favorite and return the stored row. */
export async function saveResourceFavorite(dataRoot: string, input: ResourceFavoriteInput): Promise<ResourceFavoriteWire> {
  // Capture the caller's values before any await: the stored row is the snapshot
  // the call was made with, whatever the caller does to its own object after.
  const captured = structuredClone(input)
  const favorite: ResourceFavoriteWire = {
    id: randomUUID(),
    name: captured.name,
    createdAt: new Date().toISOString(),
    surfaces: captured.surfaces,
    offEntries: captured.offEntries
  }
  await mutateFavorites(dataRoot, favorites => [...favorites, favorite])
  return favorite
}

/** Drop one favorite by id; a missing id is a no-op. */
export async function deleteResourceFavorite(dataRoot: string, id: string): Promise<void> {
  await mutateFavorites(dataRoot, favorites => favorites.filter(favorite => favorite.id !== id))
}
