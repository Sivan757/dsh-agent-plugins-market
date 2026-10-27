/**
 * Workspace tab-layout routes: read and replace one workspace's stowed tabs.
 *
 * Its own module so the main route table keeps its size, and its own local
 * request helpers for the same reason every other extra route module has them.
 * A read is a plain GET. A write is a same-origin POST that parses, delegates
 * and serializes, and it is the second line of the clamp: a body that would
 * leave no visible tab is refused here, and a hand-edited file is still clamped
 * by the store.
 * @module routes-tab-layout
 */
import { isTrustedMutation } from './request-trust.js'
import { routeFailurePayload, type RouteLogger } from './route-errors.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { MARKET_ROUTES } from '../../market-contracts/src/contracts/market.js'
import { PINNED_TAB_KEY, WORKSPACE_TAB_KEYS, type TabLayoutWire } from '../../market-contracts/src/contracts/tab-layout.js'

const MAX_BODY_BYTES = 64 * 1024

interface WebHost {
  webServer: { register(route: { kind: 'exact'; path: string; handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void> }): () => void }
  /** Receives a failure's full detail, including the paths the browser never sees. */
  logger?: RouteLogger
}

/** What the tab-layout routes need from the composition root. */
export interface TabLayoutRouteService {
  /** The live layout. */
  currentLayout(): TabLayoutWire
  /** Replace the stow list and resolve with the committed layout. */
  setHidden(hidden: unknown): Promise<TabLayoutWire>
  /** Replace the row order and resolve with the committed layout. */
  setOrder(order: unknown): Promise<TabLayoutWire>
}

/**
 * Mount the tab-layout routes; returns the disposer releasing them.
 * @param hostCtx - the host context carrying the web server.
 * @param service - the live tab-layout owner.
 * @returns the disposer releasing both routes.
 */
export function mountTabLayoutRoutes(hostCtx: unknown, service: TabLayoutRouteService): () => void {
  const host = hostCtx as WebHost
  const disposers: Array<() => void> = []

  disposers.push(
    host.webServer.register({
      kind: 'exact',
      path: MARKET_ROUTES.tabLayout,
      handler: (_request, response) => {
        sendJson(response, 200, service.currentLayout())
      }
    })
  )

  disposers.push(
    host.webServer.register({
      kind: 'exact',
      path: MARKET_ROUTES.setTabLayout,
      handler: (request, response) => {
        if (!isTrustedMutation(request)) {
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
            const layout = await service.setHidden(requestedHidden(body as Record<string, unknown>))
            sendJson(response, 200, { ok: true, hidden: layout.hidden, order: layout.order })
          } catch (error) {
            sendJson(response, 400, routeFailurePayload(error, 'POST ' + MARKET_ROUTES.setTabLayout, host.logger))
          }
        })()
      }
    })
  )

  disposers.push(
    host.webServer.register({
      kind: 'exact',
      path: MARKET_ROUTES.setTabOrder,
      handler: (request, response) => {
        if (!isTrustedMutation(request)) {
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
            const layout = await service.setOrder(requestedOrder(body as Record<string, unknown>))
            sendJson(response, 200, { ok: true, hidden: layout.hidden, order: layout.order })
          } catch (error) {
            sendJson(response, 400, routeFailurePayload(error, 'POST ' + MARKET_ROUTES.setTabOrder, host.logger))
          }
        })()
      }
    })
  )

  return () => {
    for (const dispose of disposers) dispose()
  }
}

/**
 * Read the requested row order out of one body, refusing what it cannot honour.
 *
 * An unknown key is a client this build does not know, and a repeated key is a
 * client that built the array wrong; both would silently produce a row the
 * caller did not ask for. The pinned tab may appear (clients send the whole
 * order) but may not be moved away from the front.
 * @param body - the parsed request body.
 * @returns the requested keys, in the caller's order.
 */
function requestedOrder(body: Record<string, unknown>): string[] {
  const order = body['order']
  if (!Array.isArray(order)) throw new Error('order must be an array of tab keys')
  const requested: string[] = []
  for (const key of order) {
    if (typeof key !== 'string') throw new Error('order must be an array of tab keys')
    if (!(WORKSPACE_TAB_KEYS as readonly string[]).includes(key)) throw new Error(`unknown tab key "${key}"`)
    if (requested.includes(key)) throw new Error(`tab key "${key}" appears twice`)
    requested.push(key)
  }
  if (requested.length > 0 && requested[0] !== PINNED_TAB_KEY) throw new Error(`the "${PINNED_TAB_KEY}" tab stays first`)
  return requested
}

/**
 * Read the requested stow list out of one body, refusing what the row cannot render.
 *
 * An unknown key is a client this build does not know, and silently dropping it
 * would answer with a layout the caller did not ask for. The pinned tab is the
 * one key a caller may not stow: the row is guaranteed to keep a tab because
 * that key is never stowed, so a body naming it is asking for something the
 * workspace cannot do and is told so here rather than silently corrected.
 * @param body - the parsed request body.
 * @returns the requested keys, in the caller's order.
 */
function requestedHidden(body: Record<string, unknown>): string[] {
  const hidden = body['hidden']
  if (!Array.isArray(hidden)) throw new Error('hidden must be an array of tab keys')
  const requested: string[] = []
  for (const key of hidden) {
    if (typeof key !== 'string') throw new Error('hidden must be an array of tab keys')
    if (!(WORKSPACE_TAB_KEYS as readonly string[]).includes(key)) throw new Error(`unknown tab key "${key}"`)
    if (key === PINNED_TAB_KEY) throw new Error(`the "${PINNED_TAB_KEY}" tab cannot be stowed`)
    requested.push(key)
  }
  return requested
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
