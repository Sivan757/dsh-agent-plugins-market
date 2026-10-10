/** Session-addressed extension APIs. Workspace authority comes from the live Agent, never request paths. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { EXTENSION_ROUTES, parseExtensionIds, parseExtensionName, type ExtensionPresetInput } from '../../market-contracts/src/contracts/extension-presets.js'

import type { ExtensionRouteService } from '../../market-runtime/src/index.js'
export type { ExtensionRouteService } from '../../market-runtime/src/index.js'
interface WebHost {
  webServer: { register(route: { kind: 'exact'; path: string; handler(request: IncomingMessage, response: ServerResponse): Promise<void> }): () => void }
}
function id(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) throw new Error('invalid identifier')
  return value
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('invalid revision')
  return value
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    length += bytes.length
    if (length > 64 * 1024) throw new Error('request too large')
    chunks.push(bytes)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid request body')
  return value as Record<string, unknown>
}
function json(response: ServerResponse, status: number, value: unknown): void {
  const text = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' })
  response.end(text)
}
function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}
/** Mount only after session initialization has an enforcement gate. */
export function mountExtensionPresetRoutes(host: WebHost, service: ExtensionRouteService): () => void {
  const disposers: Array<() => void> = []
  const add = (path: string, method: 'GET' | 'POST', action: (input: Record<string, unknown>) => Promise<string>): void => {
    disposers.push(
      host.webServer.register({
        kind: 'exact',
        path,
        async handler(request, response) {
          if (request.method !== method) {
            json(response, 405, { ok: false, code: 'method-not-allowed', error: 'method not allowed' })
            return
          }
          if (!sameOrigin(request)) {
            json(response, 403, { ok: false, code: 'cross-origin', error: 'cross-origin request rejected' })
            return
          }
          try {
            const input = method === 'GET' ? Object.fromEntries(new URL(request.url ?? '/', 'http://localhost').searchParams) : await body(request)
            const sessionId = await action(input)
            const window = await service.window(sessionId)
            json(response, 200, method === 'GET' ? window : { ok: true, window })
          } catch (error) {
            const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'invalid-extension-request'
            const status = code.includes('conflict') || code.includes('busy') || code.includes('not-ready') ? 409 : code.includes('not-found') ? 404 : 400
            json(response, status, { ok: false, code, error: error instanceof Error ? error.message : String(error) })
          }
        }
      })
    )
  }
  add(EXTENSION_ROUTES.window, 'GET', input => Promise.resolve(id(input.sessionId)))
  // The Hooks overview is sessionless: the route answers the read directly
  // instead of resolving a live Agent, because hook declarations belong to
  // the user Agent layout root, not to any one workspace.
  disposers.push(
    host.webServer.register({
      kind: 'exact',
      path: EXTENSION_ROUTES.hooksOverview,
      async handler(request, response) {
        if (request.method !== 'GET') {
          json(response, 405, { ok: false, code: 'method-not-allowed', error: 'method not allowed' })
          return
        }
        if (!sameOrigin(request)) {
          json(response, 403, { ok: false, code: 'cross-origin', error: 'cross-origin request rejected' })
          return
        }
        try {
          if (!service.hooksOverview) throw Object.assign(new Error('extension hooks overview is unavailable'), { code: 'extension-hooks-unavailable' })
          json(response, 200, await service.hooksOverview())
        } catch (error) {
          const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'invalid-extension-request'
          json(response, code.includes('not-found') ? 404 : 400, { ok: false, code, error: error instanceof Error ? error.message : String(error) })
        }
      }
    })
  )
  // The hook detail modal's dry run. The body names the declaration only: the
  // command is resolved from the scanned catalog, so a caller can never choose
  // what runs, and the working directory is always the server's home directory.
  disposers.push(
    host.webServer.register({
      kind: 'exact',
      path: EXTENSION_ROUTES.hookRun,
      async handler(request, response) {
        if (request.method !== 'POST') {
          json(response, 405, { ok: false, code: 'method-not-allowed', error: 'method not allowed' })
          return
        }
        if (!sameOrigin(request)) {
          json(response, 403, { ok: false, code: 'cross-origin', error: 'cross-origin request rejected' })
          return
        }
        try {
          const hookRun = service.hookRun?.bind(service)
          if (hookRun === undefined) throw Object.assign(new Error('extension hook dry run is unavailable'), { code: 'extension-hook-run-unavailable' })
          const input = await body(request)
          const rawIndex = input.hookIndex
          if (rawIndex !== undefined && (typeof rawIndex !== 'number' || !Number.isSafeInteger(rawIndex) || rawIndex < 0)) throw new Error('invalid hook index')
          const hookIndex = rawIndex
          const sessionId = input.sessionId === undefined ? undefined : id(input.sessionId)
          json(
            response,
            200,
            await hookRun({
              sourceId: id(input.sourceId),
              suiteId: id(input.suiteId),
              event: id(input.event),
              ...(hookIndex === undefined ? {} : { hookIndex }),
              ...(sessionId === undefined ? {} : { sessionId })
            })
          )
        } catch (error) {
          const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'invalid-extension-request'
          json(response, code.includes('not-found') ? 404 : 400, { ok: false, code, error: error instanceof Error ? error.message : String(error) })
        }
      }
    })
  )
  const mutate = (path: string, operation: (session: string, revision: number, input: Record<string, unknown>) => Promise<void>): void => {
    add(path, 'POST', async input => {
      const session = id(input.sessionId)
      await operation(session, revision(input.expectedRevision), input)
      return session
    })
  }
  const preset = (input: Record<string, unknown>): ExtensionPresetInput => ({ name: parseExtensionName(input.name), enabledIds: parseExtensionIds(input.enabledIds) })
  mutate(EXTENSION_ROUTES.create, (session, rev, input) => service.create(session, rev, preset(input)))
  mutate(EXTENSION_ROUTES.update, (session, rev, input) => service.update(session, rev, id(input.id), preset(input)))
  mutate(EXTENSION_ROUTES.delete, (session, rev, input) => service.delete(session, rev, id(input.id)))
  mutate(EXTENSION_ROUTES.default, (session, rev, input) => service.setDefault(session, rev, input.id === null ? null : id(input.id)))
  mutate(EXTENSION_ROUTES.select, (session, rev, input) => service.select(session, rev, input.presetId === null ? null : id(input.presetId)))
  mutate(EXTENSION_ROUTES.recover, async (session, rev) => {
    if (!service.recover) throw new Error('extension recovery is unavailable')
    await service.recover(session, rev)
  })
  return () => {
    for (const dispose of disposers) dispose()
  }
}
