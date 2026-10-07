/**
 * HTTP routes for the project resource window.
 *
 * Same shape as the rest of the market API: reads are plain GETs, every
 * mutation is a same-origin POST that parses, delegates, and serializes. The
 * handlers live in their own module so the main route table stays untouched
 * by the window; the composition root mounts both under one disposer.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { RESOURCE_ROUTES, resolveFavoriteInput } from '../../market-contracts/src/contracts/resource-window.js'
import type { ResourceFace } from '../../market-contracts/src/contracts/resource-window.js'
import { SURFACE_TOGGLE_KEYS } from '../../market-contracts/src/contracts/surface-toggles.js'
import { buildResourceWindow, type ResourceInventoryDeps } from './application/resource-inventory.js'

interface WebServerService {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void> }): () => void
}

/** What the window routes need from the composition root. */
export interface ResourceRouteDeps extends ResourceInventoryDeps {
  /** Flip one entry; the service persists and reconciles. */
  setEntry(face: ResourceFace, entryId: string, enabled: boolean): Promise<unknown>
  /** Apply one favorite's complete snapshot (six switches plus entry filters). */
  applyFavorite(id: string): Promise<void>
  /** Save the current workspace state as one named favorite; returns its id. */
  saveFavorite(name: string): Promise<string>
  /** Drop one favorite by id. */
  deleteFavorite(id: string): Promise<void>
  /** Reset this workspace to the installed default: no entry filters, every surface switch on. */
  resetWorkspace(): Promise<void>
}

interface RouteHost {
  webServer: WebServerService
}

const MAX_BODY_BYTES = 64 * 1024

/** Mount the resource-window routes; returns the disposer releasing them all. */
export function mountResourceRoutes(hostCtx: unknown, deps: ResourceRouteDeps): () => void {
  const host = hostCtx as RouteHost
  const disposers: Array<() => void> = []
  const get = (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => {
    disposers.push(host.webServer.register({ kind: 'exact', path, handler }))
  }
  const post = (path: string, handler: (body: Record<string, unknown>, request: IncomingMessage) => Promise<Record<string, unknown>>) => {
    disposers.push(
      host.webServer.register({
        kind: 'exact',
        path,
        handler: (request, response) => {
          if (!sameOrigin(request)) {
            sendJson(response, 403, { ok: false, error: 'cross-origin request rejected' })
            return
          }
          void (async () => {
            const body = await readJsonBody(request)
            if (body === undefined) {
              sendJson(response, 400, { ok: false, error: 'invalid JSON body' })
              return
            }
            try {
              const value = await handler(body as Record<string, unknown>, request)
              sendJson(response, 200, { ok: true, ...value })
            } catch (error) {
              sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
            }
          })()
        }
      })
    )
  }

  get(RESOURCE_ROUTES.inventory, async (_request, response) => {
    sendJson(response, 200, await buildResourceWindow(deps))
  })

  post(RESOURCE_ROUTES.setEntry, async body => {
    const face = body.face
    if (typeof face !== 'string' || !SURFACE_TOGGLE_KEYS.includes(face as never)) throw new Error('invalid resource face')
    if (typeof body.entryId !== 'string' || body.entryId === '') throw new Error('missing entry id')
    if (typeof body.enabled !== 'boolean') throw new Error('enabled must be a boolean')
    await deps.setEntry(face as ResourceFace, body.entryId, body.enabled)
    return { window: await buildResourceWindow(deps) }
  })

  post(RESOURCE_ROUTES.applyFavorite, async body => {
    if (typeof body.id !== 'string' || body.id === '') throw new Error('missing favorite id')
    await deps.applyFavorite(body.id)
    return { window: await buildResourceWindow(deps) }
  })

  post(RESOURCE_ROUTES.saveFavorite, async body => {
    // The snapshot is read server-side from the live workspace state, so a
    // client cannot store a state it never had.
    const input = resolveFavoriteInput(body)
    if (input === undefined) throw new Error('favorite name is required')
    const favoriteId = await deps.saveFavorite(input.name)
    return { window: await buildResourceWindow(deps), favoriteId }
  })

  post(RESOURCE_ROUTES.deleteFavorite, async body => {
    if (typeof body.id !== 'string' || body.id === '') throw new Error('missing favorite id')
    await deps.deleteFavorite(body.id)
    return { window: await buildResourceWindow(deps) }
  })

  // Follow global: the workspace drops every project-level opinion — no entry
  // filters, all six surface switches back on — and the payload returns the
  // plain installed inventory.
  post(RESOURCE_ROUTES.reset, async () => {
    await deps.resetWorkspace()
    return { window: await buildResourceWindow(deps) }
  })

  return () => {
    for (const dispose of disposers) dispose()
  }
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers['origin']
  if (origin === undefined) return true
  try {
    return new URL(origin).host === request.headers['host']
  } catch {
    return false
  }
}

/** Parses the request body; `undefined` for an oversized, unparsable, or failed read. */
function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise(resolve => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resolve(undefined)
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (size > MAX_BODY_BYTES) return
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(undefined)
      }
    })
    request.on('error', () => resolve(undefined))
  })
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}
