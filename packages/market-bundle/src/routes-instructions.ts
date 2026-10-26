/**
 * HTTP routes for the workspace instructions page.
 *
 * One read and two writes. The read answers for the session named by the
 * `sessionId` query, so the chain it reports is the one that session's model
 * receives; with no session named it answers for the process working directory.
 * Both writes name a candidate (scope, directory, file name) and never a path,
 * so a request can only reach a file the server itself derived from that
 * session's chain.
 *
 * The handlers live here rather than in `routes.ts` so the main table stays
 * readable; the composition root mounts both under one disposer.
 */
import { isAbsolute } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { INSTRUCTION_ROUTES } from '../../market-contracts/src/contracts/instructions.js'
import type { SuiteRouteSessionResolver } from './routes.js'
import { readInstructions, saveInstruction, deleteInstruction, type InstructionLimits } from './application/instructions.js'

interface WebServerService {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void> }): () => void
}

/** What the instruction routes need from the composition root. */
export interface InstructionRouteDeps {
  /** The byte caps the host row is configured with. */
  limits: InstructionLimits
  /**
   * The live-session lookup, shared with the market routes. Absent means every
   * answer is for the process working directory.
   */
  session?: SuiteRouteSessionResolver
}

interface RouteHost {
  webServer: WebServerService
}

const MAX_BODY_BYTES = 64 * 1024

/** Mount the instruction routes; returns the disposer releasing them all. */
export function mountInstructionRoutes(hostCtx: unknown, deps: InstructionRouteDeps): () => void {
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
   * The directory one request answers for: the named session's workspace, or
   * the process working directory when no session is named. An unknown session
   * is a diagnostic, never a quiet fallback to another directory.
   */
  const cwdOf = (request: IncomingMessage): { cwd: string } | { error: string } => {
    const sessionId = queryOf(request).get('sessionId')
    if (sessionId === null || sessionId === '') return { cwd: process.cwd() }
    const agent = deps.session?.agent(sessionId)
    if (agent === undefined) return { error: `no live session "${sessionId}"` }
    const cwd = agent.session.header.cwd
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) return { error: `session "${sessionId}" has no absolute workspace` }
    return { cwd }
  }

  get(INSTRUCTION_ROUTES.read, async (request, response) => {
    const resolved = cwdOf(request)
    if ('error' in resolved) {
      sendJson(response, 404, { ok: false, error: resolved.error })
      return
    }
    sendJson(response, 200, await readInstructions(resolved.cwd, deps.limits))
  })

  post(INSTRUCTION_ROUTES.save, async (body, request) => {
    const resolved = cwdOf(request)
    if ('error' in resolved) throw new Error(resolved.error)
    await saveInstruction(resolved.cwd, body, deps.limits)
    return {}
  })

  post(INSTRUCTION_ROUTES.remove, async (body, request) => {
    const resolved = cwdOf(request)
    if ('error' in resolved) throw new Error(resolved.error)
    const result = await deleteInstruction(resolved.cwd, body, deps.limits)
    return { aliases: result.aliases, targetIsLink: result.targetIsLink }
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
