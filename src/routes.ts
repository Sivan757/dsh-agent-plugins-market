/**
 * HTTP routes bridging the market page to the application market service.
 *
 * This layer only parses requests, delegates to the application service, and serializes
 * responses. Mutating routes accept same-origin POSTs exclusively: a
 * cross-site form or fetch cannot trigger a clone, an uninstall, or an
 * enable/disable against a local profile.
 */
import { isAbsolute } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { MARKET_ROUTES } from './contracts/market.js'
import { expandHome } from './catalog/paths.js'
import { sanitizeOverridePatch } from './runtime/mcp-overrides.js'
import type { MarketService } from './application/queries.js'
import type { SuiteSurfaceKey } from './model/types.js'

const MAX_BODY_BYTES = 64 * 1024

export interface WebServerService {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void> }): () => void
}

interface RouteHost {
  webServer: WebServerService
}

/** Mount every route; returns the disposer releasing them all. */
export function mountSuiteRoutes(hostCtx: unknown, manager: MarketService): () => void {
  const host = hostCtx as RouteHost
  const disposers: Array<() => void> = []
  const get = (path: string, handler: RouteHandler) => {
    disposers.push(host.webServer.register({ kind: 'exact', path, handler }))
  }
  const post = (path: string, handler: JsonAction) => {
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
              const value = await handler(body as Record<string, unknown>)
              sendJson(response, 200, { ok: true, ...value })
            } catch (error) {
              sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
            }
          })()
        }
      })
    )
  }

  get(MARKET_ROUTES.overview, async (_request, response) => {
    sendJson(response, 200, await manager.overview())
  })

  get(MARKET_ROUTES.mcpStatus, async (_request, response) => {
    sendJson(response, 200, await manager.mcpStatus())
  })

  get(MARKET_ROUTES.lspStatus, async (_request, response) => {
    sendJson(response, 200, await manager.lspStatus())
  })

  get(MARKET_ROUTES.lspServers, async (_request, response) => {
    sendJson(response, 200, { lspServers: await manager.lspServers() })
  })

  get(MARKET_ROUTES.progress, async (_request, response) => {
    sendJson(response, 200, manager.sourceProgress())
  })

  get(MARKET_ROUTES.config, async (_request, response) => {
    sendJson(response, 200, { sources: manager.sources })
  })

  get(MARKET_ROUTES.suite, async (request, response) => {
    const query = queryOf(request)
    const sourceId = query.get('sourceId')
    const suiteId = query.get('suiteId')
    if (sourceId === null || suiteId === null) {
      sendJson(response, 400, { ok: false, error: 'missing sourceId or suiteId' })
      return
    }
    try {
      sendJson(response, 200, await manager.suiteDetail(sourceId, suiteId))
    } catch (error) {
      sendJson(response, 404, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  get(MARKET_ROUTES.skill, async (request, response) => {
    const query = queryOf(request)
    const sourceId = query.get('sourceId')
    const suiteId = query.get('suiteId')
    const skill = query.get('skill')
    if (sourceId === null || suiteId === null || skill === null) {
      sendJson(response, 400, { ok: false, error: 'missing sourceId, suiteId, or skill' })
      return
    }
    try {
      sendJson(response, 200, await manager.skillContent(sourceId, suiteId, skill))
    } catch (error) {
      sendJson(response, 404, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  post(MARKET_ROUTES.addSource, async body => {
    const url = String(body['url'] ?? '').trim()
    if (url === '') throw new Error('missing source url')
    const local = body['local'] === true
    if (local) {
      const expanded = expandHome(url)
      if (!url.startsWith('~/') && url !== '~' && !isAbsolute(expanded)) throw new Error('local source url must be an absolute path or start with ~/')
    }
    const kind = parseSourceKind(body['kind'])
    if (kind === 'local' && !local) {
      const expanded = expandHome(url)
      if (!url.startsWith('~/') && url !== '~' && !isAbsolute(expanded)) throw new Error('local source url must be an absolute path or start with ~/')
    }
    const branch = body['branch']
    const sha256 = parseSha256(body['sha256'])
    const source = await manager.addSource({
      url: local || kind === 'local' ? expandHome(url) : url,
      ...(typeof branch === 'string' && branch.trim() !== '' ? { branch: branch.trim() } : {}),
      ...(local ? { local: true } : {}),
      ...(kind === undefined ? {} : { kind }),
      ...(sha256 === undefined ? {} : { sha256 })
    })
    return { source }
  })

  post(MARKET_ROUTES.updateSource, async body => {
    const id = body['id']
    if (typeof id !== 'string' || id === '') throw new Error('missing source id')
    const patch: { url?: string; branch?: string; local?: boolean; kind?: 'git' | 'local' | 'archive'; sha256?: string } = {}
    if (body['url'] !== undefined) {
      const url = String(body['url']).trim()
      if (url === '') throw new Error('missing source url')
      patch.url = url
    }
    if (body['branch'] !== undefined) patch.branch = String(body['branch']).trim()
    if (body['local'] !== undefined) patch.local = body['local'] === true
    const kind = parseSourceKind(body['kind'])
    if (kind !== undefined) patch.kind = kind
    const sha256 = parseSha256(body['sha256'])
    if (sha256 !== undefined) patch.sha256 = sha256
    await manager.updateSource(id, patch)
    return {}
  })

  // Register one unmanaged `.sources/` checkout in place — the manual-clone
  // repair path. Nothing is cloned, moved, or deleted.
  post(MARKET_ROUTES.adoptSource, async body => {
    const id = body['id']
    if (typeof id !== 'string' || id === '') throw new Error('missing checkout id')
    const source = await manager.adoptSource(id)
    return { source }
  })

  post(MARKET_ROUTES.removeSource, async body => {
    const id = body['id']
    if (typeof id !== 'string' || id === '') throw new Error('missing source id')
    await manager.removeSource(id)
    return {}
  })

  post(MARKET_ROUTES.refreshSource, async body => {
    const id = body['id']
    await manager.refreshSource(typeof id === 'string' && id !== '' ? id : undefined)
    return {}
  })

  post(MARKET_ROUTES.install, async body => {
    const { sourceId, suiteId } = parseTarget(body)
    await manager.install(sourceId, suiteId)
    return {}
  })

  post(MARKET_ROUTES.uninstall, async body => {
    const { sourceId, suiteId } = parseTarget(body)
    await manager.uninstall(sourceId, suiteId)
    return {}
  })

  post(MARKET_ROUTES.setEnabled, async body => {
    const { sourceId, suiteId } = parseTarget(body)
    const enabled = body['enabled']
    if (typeof enabled !== 'boolean') throw new Error('missing boolean enabled')
    await manager.setEnabled(sourceId, suiteId, enabled)
    return {}
  })

  post(MARKET_ROUTES.setSurface, async body => {
    const { sourceId, suiteId } = parseTarget(body)
    const surface = body['surface']
    const enabled = body['enabled']
    if (typeof surface !== 'string' || surface === '') throw new Error('missing surface')
    if (typeof enabled !== 'boolean') throw new Error('missing boolean enabled')
    await manager.setSurface(sourceId, suiteId, surface as SuiteSurfaceKey, enabled)
    return {}
  })

  get(MARKET_ROUTES.mcpOverrides, async (request, response) => {
    const suiteId = queryOf(request).get('suiteId')
    if (suiteId === null) {
      sendJson(response, 400, { ok: false, error: 'missing suiteId' })
      return
    }
    try {
      sendJson(response, 200, { ok: true, overrides: await manager.mcpOverrides(suiteId) })
    } catch (error) {
      sendJson(response, 404, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  post(MARKET_ROUTES.setMcpOverride, async body => {
    const { sourceId, suiteId } = parseTarget(body)
    const serverKey = body['serverKey']
    if (typeof serverKey !== 'string' || serverKey === '') throw new Error('missing serverKey')
    const override = body['override']
    const sanitized = sanitizeOverridePatch(override)
    if (override !== null && sanitized === undefined) throw new Error('invalid override payload')
    await manager.setMcpOverride(sourceId, suiteId, serverKey, sanitized ?? null)
    return {}
  })

  // Manual MCP reconcile: retries failed mounts and clears residual tools
  // without touching any catalog state.
  post(MARKET_ROUTES.mcpRetry, async () => {
    await manager.retryMounts()
    return {}
  })

  // Drop one server's OAuth grant record: the next mount re-runs the browser
  // authorization, which is how a user widens a too-narrow scope.
  post(MARKET_ROUTES.mcpReauthorize, async body => {
    const serverName = body['serverName']
    if (typeof serverName !== 'string' || serverName === '') throw new Error('serverName is required')
    await manager.reauthorizeMcpServer(serverName)
    return {}
  })

  // The MCP backend block: which client mounts suite servers, and whether the
  // host's dsh-mcp-client is resolvable as the compatibility option.
  get(MARKET_ROUTES.mcpBackend, async (_request, response) => {
    sendJson(response, 200, await manager.mcpBackendInfo())
  })

  post(MARKET_ROUTES.setMcpBackend, async body => {
    const backend = body['backend']
    if (backend !== 'builtin' && backend !== 'host') throw new Error('backend must be "builtin" or "host"')
    await manager.setMcpBackend(backend)
    return await manager.mcpBackendInfo()
  })

  // Validate and persist the user's direct LSP server table; the reconcile
  // pass picks it up and mounts it alongside the suite declarations.
  post(MARKET_ROUTES.lspServers, async body => {
    const servers = await manager.setLspServers(body['lspServers'])
    return { lspServers: servers }
  })

  return () => {
    for (const dispose of disposers) dispose()
  }
}

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
type JsonAction = (body: Record<string, unknown>) => Promise<Record<string, unknown>>

function parseTarget(body: Record<string, unknown>): { sourceId: string; suiteId: string } {
  const sourceId = body['sourceId']
  const suiteId = body['suiteId']
  if (typeof sourceId !== 'string' || sourceId === '') throw new Error('missing sourceId')
  if (typeof suiteId !== 'string' || suiteId === '') throw new Error('missing suiteId')
  return { sourceId, suiteId }
}

/** Parse an optional acquisition-kind field; rejects unknown values. */
function parseSourceKind(raw: unknown): 'git' | 'local' | 'archive' | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (raw === 'git' || raw === 'local' || raw === 'archive') return raw
  throw new Error(`invalid source kind "${String(raw)}"`)
}

/** Parse an optional SHA-256 hex digest; rejects malformed values. */
function parseSha256(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const value = String(raw).trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('sha256 must be a 64-character hex digest')
  return value
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

function readJsonBody(request: IncomingMessage): Promise<unknown | undefined> {
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

/** Parse the query string of one request into a URLSearchParams. */
function queryOf(request: IncomingMessage): URLSearchParams {
  return new URL(request.url ?? '/', 'http://dsh.local').searchParams
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}
