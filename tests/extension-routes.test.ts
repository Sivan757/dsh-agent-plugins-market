import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountExtensionPresetRoutes, type ExtensionRouteService } from '../packages/market-bundle/src/routes-extension-presets.js'
import { captureExtensionSelection, EXTENSION_ROUTES, type ExtensionWindowPayload } from '../packages/market-contracts/src/contracts/extension-presets.js'

/**
 * The retired adjustment path, spelled out rather than read from EXTENSION_ROUTES:
 * the constant leaves with the route, and this test's whole point is that the path
 * no longer resolves to a handler.
 */
const RETIRED_ADJUST_PATH = '/api/agent-plugins/extension-presets/adjust'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup() {
  const window: ExtensionWindowPayload = {
    sessionId: 'session',
    workspace: '/server/workspace',
    started: false,
    busy: false,
    library: { revision: 1, defaultPresetId: null, presets: [] },
    state: { revision: 1, selection: captureExtensionSelection(null, []) },
    resources: []
  }
  // Typed against the interface itself: the double must be exactly a service, with no
  // adjustment member to reach even if the retired path were somehow still mounted.
  const service = {
    window: vi.fn(async () => window),
    create: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    setDefault: vi.fn(async () => {}),
    select: vi.fn(async () => {})
  } satisfies ExtensionRouteService
  expect(Object.keys(service)).not.toContain('adjust')
  const routes = new Map<string, (request: IncomingMessage, response: ServerResponse) => Promise<void>>()
  const dispose = mountExtensionPresetRoutes(
    {
      webServer: {
        register(route) {
          routes.set(route.path, (request, response) => route.handler(request, response))
          return () => {
            routes.delete(route.path)
          }
        }
      }
    },
    service
  )
  const server = createServer((request, response) => {
    const handler = routes.get(new URL(request.url ?? '/', 'http://localhost').pathname)
    if (!handler) {
      response.writeHead(404)
      response.end()
      return
    }
    void handler(request, response).catch(error => {
      response.destroy(error as Error)
    })
  })
  cleanups.push(async () => {
    dispose()
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()))
      server.closeAllConnections()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected loopback listener')
  const base = 'http://127.0.0.1:' + address.port
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + EXTENSION_ROUTES.select, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return { service, base, post }
}

describe('session extension HTTP boundary', () => {
  it('forwards only session identity and returns the server-authoritative workspace', async () => {
    const { service, post } = await setup()
    const response = await post({ sessionId: 'session', expectedRevision: 1, presetId: null, workspace: '/attacker/path' })
    expect(response.status).toBe(200)
    expect(service.select).toHaveBeenCalledExactlyOnceWith('session', 1, null)
    expect(await response.json()).toMatchObject({ ok: true, window: { workspace: '/server/workspace' } })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('rejects cross-origin mutation before invoking the service', async () => {
    const { service, post } = await setup()
    const response = await post({ sessionId: 'session', expectedRevision: 1, presetId: null }, { origin: 'https://attacker.invalid' })
    expect(response.status).toBe(403)
    expect(service.select).not.toHaveBeenCalled()
    expect(service.window).not.toHaveBeenCalled()
  })
  it('rejects GET on mutation endpoints without changing selection', async () => {
    const { service, base } = await setup()
    expect((await fetch(base + EXTENSION_ROUTES.select)).status).toBe(405)
    expect(service.select).not.toHaveBeenCalled()
  })
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, null, '1'])('rejects invalid revision %s before mutation', async expectedRevision => {
    const { service, post } = await setup()
    expect((await post({ sessionId: 'session', expectedRevision, presetId: null })).status).toBe(400)
    expect(service.select).not.toHaveBeenCalled()
  })
  it.each(['extension-session-busy', 'extension-session-conflict', 'extension-session-not-ready'])('reports %s without publishing a successful window', async code => {
    const { service, post } = await setup()
    vi.mocked(service.select).mockRejectedValueOnce(Object.assign(new Error(code), { code }))
    const response = await post({ sessionId: 'session', expectedRevision: 1, presetId: null })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, code })
    expect(service.window).not.toHaveBeenCalled()
  })
  it('does not acknowledge selection until maintenance has completed', async () => {
    const { service, post } = await setup()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    vi.mocked(service.select).mockImplementationOnce(async () => {
      entered.resolve()
      await release.promise
    })
    const response = post({ sessionId: 'session', expectedRevision: 1, presetId: null })
    try {
      await entered.promise
      expect(service.window).not.toHaveBeenCalled()
    } finally {
      release.resolve()
    }
    expect((await response).status).toBe(200)
    expect(service.window).toHaveBeenCalledExactlyOnceWith('session')
  })
  it('rejects mutation bodies above 64 KiB before invoking the service', async () => {
    const { service, post } = await setup()
    const response = await post({ sessionId: 'session', expectedRevision: 1, presetId: null, padding: 'x'.repeat(64 * 1024) })
    expect(response.status).toBe(400)
    expect(service.select).not.toHaveBeenCalled()
  })
  it('retired the adjustment endpoint: the old path answers 404 without touching session state', async () => {
    const { service, base } = await setup()
    const response = await fetch(base + RETIRED_ADJUST_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session', expectedRevision: 1, enabledIds: [] })
    })
    expect(response.status).toBe(404)
    // Nothing may be read or written on the strength of the retired path.
    expect(service.select).not.toHaveBeenCalled()
    expect(service.create).not.toHaveBeenCalled()
    expect(service.window).not.toHaveBeenCalled()
  })
})

describe('sessionless hooks overview route', () => {
  it('answers the hooks rows without resolving any session', async () => {
    const { service, base } = await setup()
    const hooksOverview = vi.fn(async (): Promise<{ rows: unknown[] }> => ({
      rows: [
        {
          id: 'hooks:@user-hooks/user-hooks/PreToolUse/0',
          face: 'hooks',
          name: 'echo guard',
          source: 'user-hooks',
          description: 'PreToolUse',
          suiteResourceId: 'market:@user-hooks/user-hooks',
          available: true,
          globalEnabled: true,
          detail: { kind: 'suite', sourceId: '@user-hooks', suiteId: 'user-hooks' }
        }
      ]
    }))
    ;(service as { hooksOverview?: () => Promise<{ rows: unknown[] }> }).hooksOverview = hooksOverview
    const response = await fetch(base + EXTENSION_ROUTES.hooksOverview)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ rows: [{ id: 'hooks:@user-hooks/user-hooks/PreToolUse/0', face: 'hooks' }] })
    expect(hooksOverview).toHaveBeenCalledExactlyOnceWith()
    // The read is sessionless: no window read happens behind it.
    expect(service.window).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('rejects POST on the overview path and reports an unavailable service', async () => {
    const { service, base } = await setup()
    expect((await fetch(base + EXTENSION_ROUTES.hooksOverview, { method: 'POST' })).status).toBe(405)
    const response = await fetch(base + EXTENSION_ROUTES.hooksOverview)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, code: 'extension-hooks-unavailable' })
    expect(service.window).not.toHaveBeenCalled()
  })
})
