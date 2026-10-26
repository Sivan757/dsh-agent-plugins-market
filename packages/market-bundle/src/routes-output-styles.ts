/**
 * HTTP routes for the output-styles page.
 *
 * One read and three writes. The read answers for the session named by the
 * `sessionId` query, so the page shows the selection the session's workspace
 * actually carries; with no session named it answers for the process working
 * directory.
 *
 * A write names a style, a suite or a user style's own fields and never a path.
 * A capture runs a suite's SessionStart hook once, which is why it is a separate
 * request a person makes rather than something a read does.
 *
 * The handlers live here rather than in `routes.ts` so the main table stays
 * readable; the composition root mounts both under one disposer.
 * @module routes-output-styles
 */
import { isAbsolute } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { OUTPUT_STYLE_ROUTES } from '../../market-contracts/src/contracts/output-styles.js'
import type { OutputStyleService } from '../../market-runtime/src/index.js'
import type { SuiteRouteSessionResolver } from './routes.js'

interface WebServerService {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void> }): () => void
}

/** What the output-style routes need from the composition root. */
export interface OutputStyleRouteDeps {
  /** The live selection owner. */
  service: OutputStyleService
  /** The live-session lookup, shared with the market routes. */
  session?: SuiteRouteSessionResolver
}

interface RouteHost {
  webServer: WebServerService
}

const MAX_BODY_BYTES = 64 * 1024

/**
 * Mount the output-style routes; returns the disposer releasing them all.
 * @param hostCtx - the host context carrying the web server.
 * @param deps - the selection owner and the session lookup.
 * @returns the disposer releasing every route.
 */
export function mountOutputStyleRoutes(hostCtx: unknown, deps: OutputStyleRouteDeps): () => void {
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

  /**
   * The workspace one request answers for: the named session's directory, or the
   * process working directory. An unknown session is a diagnostic, never a quiet
   * fallback to another workspace's style.
   */
  const workspaceOf = (request: IncomingMessage): { workspace: string } | { error: string } => {
    const sessionId = queryOf(request).get('sessionId')
    if (sessionId === null || sessionId === '') return { workspace: process.cwd() }
    const agent = deps.session?.agent(sessionId)
    if (agent === undefined) return { error: `no live session "${sessionId}"` }
    const cwd = agent.session.header.cwd
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) return { error: `session "${sessionId}" has no absolute workspace` }
    return { workspace: cwd }
  }

  get(OUTPUT_STYLE_ROUTES.read, async (request, response) => {
    const resolved = workspaceOf(request)
    if ('error' in resolved) {
      sendJson(response, 404, { ok: false, error: resolved.error })
      return
    }
    sendJson(response, 200, await deps.service.payload(resolved.workspace))
  })

  post(OUTPUT_STYLE_ROUTES.select, async (body, request) => {
    const resolved = workspaceOf(request)
    if ('error' in resolved) throw new Error(resolved.error)
    const styleId = body['styleId']
    if (typeof styleId !== 'string' || styleId === '') throw new Error('styleId must be a non-empty string')
    return { ...(await deps.service.select(resolved.workspace, styleId)) }
  })

  post(OUTPUT_STYLE_ROUTES.capture, async (body, request) => {
    const resolved = workspaceOf(request)
    if ('error' in resolved) throw new Error(resolved.error)
    const suiteKey = body['suiteKey']
    if (typeof suiteKey !== 'string' || suiteKey === '') throw new Error('suiteKey must be a non-empty string')
    return { ...(await deps.service.capture(resolved.workspace, suiteKey)) }
  })

  post(OUTPUT_STYLE_ROUTES.saveUser, async (body, request) => {
    const resolved = workspaceOf(request)
    if ('error' in resolved) throw new Error(resolved.error)
    const name = body['name']
    const description = body['description']
    const text = body['body']
    if (typeof name !== 'string' || name === '') throw new Error('name must be a non-empty string')
    if (typeof description !== 'string') throw new Error('description must be a string')
    if (typeof text !== 'string') throw new Error('body must be a string')
    // The name is validated as a file stem inside the writer, which is where the
    // containment rule lives; this route only refuses shapes it cannot parse.
    await deps.service.saveUserStyle(name, description, text)
    return { ...(await deps.service.payload(resolved.workspace)) }
  })

  post(OUTPUT_STYLE_ROUTES.deleteUser, async (body, request) => {
    const resolved = workspaceOf(request)
    if ('error' in resolved) throw new Error(resolved.error)
    const name = body['name']
    if (typeof name !== 'string' || name === '') throw new Error('name must be a non-empty string')
    await deps.service.removeUserStyle(resolved.workspace, name)
    return { ...(await deps.service.payload(resolved.workspace)) }
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

/** Parse the query string of one request into a URLSearchParams. */
function queryOf(request: IncomingMessage): URLSearchParams {
  return new URL(request.url ?? '/', 'http://dsh.local').searchParams
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
