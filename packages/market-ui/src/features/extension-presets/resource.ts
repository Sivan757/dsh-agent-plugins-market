import { CONFIGURATION_PARENT_IDS, EXTENSION_ROUTES, type ExtensionWindowPayload, type ExtensionResource } from '../../../../market-contracts/src/contracts/extension-presets.js'

export type Mutation = Exclude<keyof typeof EXTENSION_ROUTES, 'window'>

/**
 * A failure the route keeps answering, so a retry only spends requests.
 *
 * The extension window polls, and a poll is the right shape for a read that can
 * start working: the host finishes booting, a session settles, a scan completes.
 * It is the wrong shape for a route the server does not serve at all, which is
 * what an older host or a disabled preset surface answers. Measured in a profile
 * where the route was absent, this loop spent 336 reads and 336 console errors on
 * one open session, and would have spent them for as long as the session stayed
 * open.
 */
export class UnavailableRouteError extends Error {
  /** Read structurally by the poll, so a caller never needs this module's class identity. */
  readonly unavailable = true
  /**
   * @param status - the HTTP status that says the route will not answer.
   * @param message - the server's own text, when it sent one.
   */
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'UnavailableRouteError'
  }
}

/**
 * Read one session's extension window.
 * @param sessionId - the session the window describes.
 * @returns the payload the manager renders.
 * @throws UnavailableRouteError when the route itself is missing.
 */
export async function readWindow(sessionId: string): Promise<ExtensionWindowPayload> {
  const response = await fetch(EXTENSION_ROUTES.window + '?sessionId=' + encodeURIComponent(sessionId), { credentials: 'same-origin', signal: AbortSignal.timeout(15000) })
  const data = (await response.json().catch(() => ({}))) as ExtensionWindowPayload & { error?: string }
  // 404 and 405 name a route this host does not serve; anything else may be a
  // boot, a busy scan or a transient fault, and those are worth polling again.
  if (response.status === 404 || response.status === 405) throw new UnavailableRouteError(response.status, data.error ?? String(response.status))
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
  // A follows-suite row mirrors its owner: the preset selects the suite, never
  // the individual hook, so the row reads selected exactly when the suite does.
  if (resource.followsSuite === true) return resource.suiteResourceId !== undefined && ids.includes(resource.suiteResourceId)
  // A child of a configuration parent decides on its own id: the parent has no
  // card, its grant is derived, and no preset carries its id.
  const parentIsConfiguration = resource.suiteResourceId !== undefined && CONFIGURATION_PARENT_IDS.has(resource.suiteResourceId)
  if (parentIsConfiguration) return ids.includes(resource.id)
  return ids.includes(resource.id) && (resource.suiteResourceId === undefined || ids.includes(resource.suiteResourceId))
}
export function toggleResource(resource: ExtensionResource, ids: readonly string[], enabled: boolean): string[] {
  if (resource.control === 'global-only') return [...ids]
  const next = new Set(ids)
  if (enabled) {
    next.add(resource.id)
    // A configuration parent never enters the selection: it has no card and the
    // runtime derives its grant from this very child.
    if (resource.suiteResourceId && !CONFIGURATION_PARENT_IDS.has(resource.suiteResourceId)) next.add(resource.suiteResourceId)
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
