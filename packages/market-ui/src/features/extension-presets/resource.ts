import { EXTENSION_ROUTES, type ExtensionWindowPayload, type ExtensionResource } from '../../../../market-contracts/src/contracts/extension-presets.js'

export type Mutation = Exclude<keyof typeof EXTENSION_ROUTES, 'window'>
export async function readWindow(sessionId: string): Promise<ExtensionWindowPayload> {
  const response = await fetch(EXTENSION_ROUTES.window + '?sessionId=' + encodeURIComponent(sessionId), { credentials: 'same-origin', signal: AbortSignal.timeout(15000) })
  const data = (await response.json()) as ExtensionWindowPayload & { error?: string }
  if (!response.ok) throw new Error(data.error ?? String(response.status))
  return data
}
export async function writeWindow(action: Mutation, sessionId: string, expectedRevision: number, body: Record<string, unknown>): Promise<ExtensionWindowPayload> {
  const response = await fetch(EXTENSION_ROUTES[action], {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, sessionId, expectedRevision }),
    signal: AbortSignal.timeout(15000)
  })
  const answer = (await response.json()) as { ok: boolean; window: ExtensionWindowPayload; error?: string; code?: string }
  if (!response.ok || !answer.ok) throw new Error([answer.code, answer.error ?? response.status].filter(Boolean).join(': '))
  return answer.window
}
export function resourceSelected(resource: ExtensionResource, ids: readonly string[]): boolean {
  if (resource.control === 'global-only') return resource.available
  return ids.includes(resource.id) && (resource.suiteResourceId === undefined || ids.includes(resource.suiteResourceId))
}
export function toggleResource(resource: ExtensionResource, ids: readonly string[], enabled: boolean): string[] {
  if (resource.control === 'global-only') return [...ids]
  const next = new Set(ids)
  if (enabled) {
    next.add(resource.id)
    if (resource.suiteResourceId) next.add(resource.suiteResourceId)
  } else next.delete(resource.id)
  return [...next]
}
export function uniquePresetName(name: string, names: readonly string[]): string {
  let result = name
  for (let suffix = 2; names.includes(result); suffix++) result = name.slice(0, 70) + ' (' + suffix + ')'
  return result
}
/** Serializes revisioned writes; revisions are read only when the previous write has settled. */
export function createWriteQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation)
    tail = result.catch(() => undefined)
    return result
  }
}
