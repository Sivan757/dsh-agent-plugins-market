/** Typed fetch helpers over the resource-window routes. */
import { RESOURCE_ROUTES } from '../../../contracts/resource-window.js'
import type { ResourceFace, ResourceWindowPayload } from '../../../contracts/resource-window.js'

/** The resource window payload, under the name the client surfaces use. */
export type ResourceWindowData = ResourceWindowPayload

/** Read this workspace's installed inventory with filter and favorite state. */
export async function fetchResourceWindow(): Promise<ResourceWindowData> {
  const response = await fetch(RESOURCE_ROUTES.inventory, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('resource window failed: ' + String(response.status))
  return (await response.json()) as ResourceWindowData
}

interface MutationAnswer {
  window?: ResourceWindowData
  favoriteId?: string
}

/** One same-origin POST returning the refreshed window. */
async function postWindow(path: string, body: Record<string, unknown>): Promise<MutationAnswer> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  const payload = (await response.json()) as { ok?: boolean; error?: string } & MutationAnswer
  if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? 'resource window request failed: ' + String(response.status))
  return payload
}

/** Flip one entry's per-workspace filter and return the refreshed window. */
export async function setResourceEntry(face: ResourceFace, entryId: string, enabled: boolean): Promise<ResourceWindowData> {
  const answer = await postWindow(RESOURCE_ROUTES.setEntry, { face, entryId, enabled })
  if (answer.window === undefined) throw new Error('resource window response carried no window')
  return answer.window
}

/** Apply one favorite's complete snapshot and return the refreshed window. */
export async function applyResourceFavorite(id: string): Promise<ResourceWindowData> {
  const answer = await postWindow(RESOURCE_ROUTES.applyFavorite, { id })
  if (answer.window === undefined) throw new Error('resource window response carried no window')
  return answer.window
}

/** Save the current workspace state as a named favorite; returns the refreshed window and the new id. */
export async function saveResourceFavorite(name: string): Promise<{ window: ResourceWindowData; favoriteId: string }> {
  const answer = await postWindow(RESOURCE_ROUTES.saveFavorite, { name })
  if (answer.window === undefined || answer.favoriteId === undefined) throw new Error('resource window response carried no favorite')
  return { window: answer.window, favoriteId: answer.favoriteId }
}

/** Drop one favorite and return the refreshed window. */
export async function deleteResourceFavorite(id: string): Promise<ResourceWindowData> {
  const answer = await postWindow(RESOURCE_ROUTES.deleteFavorite, { id })
  if (answer.window === undefined) throw new Error('resource window response carried no window')
  return answer.window
}
