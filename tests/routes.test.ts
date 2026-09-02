import { describe, expect, it } from 'vitest'
import { MARKET_ROUTES } from '../src/contracts/market.js'
import { mountSuiteRoutes, type WebServerService } from '../src/routes.js'
import type { MarketService } from '../src/application/queries.js'

function service(): MarketService {
  return {
    sources: [],
    overview: async () => ({ sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '/user', data: '/data' } }),
    mcpStatus: async () => ({
      entries: [],
      observedAt: '',
      totals: { all: 0, connected: 0, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
      directObservationOnly: true
    }),
    sourceProgress: () => ({ active: false, sourceId: '', step: '' }),
    suiteDetail: async () => {
      throw new Error('not found')
    },
    skillContent: async () => {
      throw new Error('not found')
    },
    addSource: async input => ({ id: 'source', ...input }),
    updateSource: async () => {},
    removeSource: async () => {},
    refreshSource: async () => {},
    install: async () => {},
    uninstall: async () => {},
    setEnabled: async () => {},
    setSurface: async () => {},
    setMcpOverride: async () => {},
    retryMounts: async () => {},
    reauthorizeMcpServer: async () => {},
    mcpReauthorizeAvailable: () => true,
    mcpBackendInfo: async () => ({ backend: 'builtin' as const, hostClient: { available: true, version: '0.1.1-rc.2' } }),
    setMcpBackend: async () => {}
  }
}

function response(): { value: () => unknown; writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void } {
  let body = ''
  return {
    value: () => JSON.parse(body),
    writeHead: () => {},
    end: value => {
      body = value
    }
  }
}

describe('market HTTP routes', () => {
  it('registers the shared route constants and disposes them together', async () => {
    const routes = new Map<string, (request: unknown, response: unknown) => void | Promise<void>>()
    const webServer: WebServerService = {
      register: route => {
        routes.set(route.path, route.handler as (request: unknown, response: unknown) => void | Promise<void>)
        return () => routes.delete(route.path)
      }
    }
    const dispose = mountSuiteRoutes({ webServer }, service())

    expect([...routes.keys()]).toEqual(Object.values(MARKET_ROUTES))
    const overviewResponse = response()
    await routes.get(MARKET_ROUTES.overview)?.({ url: '/api/agent-plugins/overview', headers: {} }, overviewResponse)
    expect(overviewResponse.value()).toMatchObject({ totals: { all: 0 } })

    // Manual MCP retry: same-origin POST re-runs the reconcile pass.
    const retryResponse = response()
    const retryRequest = {
      method: 'POST',
      url: MARKET_ROUTES.mcpRetry,
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
      on: (event: string, listener: (chunk?: unknown) => void) => {
        if (event === 'data') listener(Buffer.from('{}', 'utf8'))
        if (event === 'end') listener()
      },
      destroy: () => {}
    }
    await routes.get(MARKET_ROUTES.mcpRetry)?.(retryRequest, retryResponse)
    // The POST handler writes asynchronously after the body promise settles.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(retryResponse.value()).toMatchObject({ ok: true })

    // Re-authorize: drops the grant record for the named server.
    const reauthCalls: Array<string> = []
    const reauthService = {
      ...service(),
      reauthorizeMcpServer: async (serverName: string) => {
        reauthCalls.push(serverName)
      }
    }
    const disposeReauth = mountSuiteRoutes({ webServer }, reauthService)
    const reauthResponse = response()
    const reauthRequest = {
      method: 'POST',
      url: MARKET_ROUTES.mcpReauthorize,
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
      on: (event: string, listener: (chunk?: unknown) => void) => {
        if (event === 'data') listener(Buffer.from(JSON.stringify({ serverName: 'cloudflare__cloudflare-api' }), 'utf8'))
        if (event === 'end') listener()
      },
      destroy: () => {}
    }
    await routes.get(MARKET_ROUTES.mcpReauthorize)?.(reauthRequest, reauthResponse)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(reauthResponse.value()).toMatchObject({ ok: true })
    expect(reauthCalls).toEqual(['cloudflare__cloudflare-api'])

    // Missing serverName is rejected.
    const badRequest = {
      method: 'POST',
      url: MARKET_ROUTES.mcpReauthorize,
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
      on: (event: string, listener: (chunk?: unknown) => void) => {
        if (event === 'data') listener(Buffer.from('{}', 'utf8'))
        if (event === 'end') listener()
      },
      destroy: () => {}
    }
    await routes.get(MARKET_ROUTES.mcpReauthorize)?.(badRequest, response())
    await new Promise(resolve => setTimeout(resolve, 0))

    disposeReauth()
    dispose()
    expect(routes.size).toBe(0)
  })

  it('serves the MCP backend block and validates backend switches', async () => {
    const routes = new Map<string, (request: unknown, response: unknown) => void | Promise<void>>()
    const webServer: WebServerService = {
      register: route => {
        routes.set(route.path, route.handler as (request: unknown, response: unknown) => void | Promise<void>)
        return () => routes.delete(route.path)
      }
    }
    const dispose = mountSuiteRoutes({ webServer }, service())

    const getResponse = response()
    await routes.get(MARKET_ROUTES.mcpBackend)?.({ url: MARKET_ROUTES.mcpBackend, headers: {} }, getResponse)
    expect(getResponse.value()).toMatchObject({ backend: 'builtin', hostClient: { available: true, version: '0.1.1-rc.2' } })

    const postRequest = {
      method: 'POST',
      url: MARKET_ROUTES.setMcpBackend,
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
      on: (event: string, listener: (chunk?: unknown) => void) => {
        if (event === 'data') listener(Buffer.from(JSON.stringify({ backend: 'host' }), 'utf8'))
        if (event === 'end') listener()
      },
      destroy: () => {}
    }
    const postResponse = response()
    await routes.get(MARKET_ROUTES.setMcpBackend)?.(postRequest, postResponse)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(postResponse.value()).toMatchObject({ ok: true, backend: 'builtin' })

    // An unknown backend value is rejected with a 400 payload.
    const badRequest = {
      method: 'POST',
      url: MARKET_ROUTES.setMcpBackend,
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
      on: (event: string, listener: (chunk?: unknown) => void) => {
        if (event === 'data') listener(Buffer.from(JSON.stringify({ backend: 'nope' }), 'utf8'))
        if (event === 'end') listener()
      },
      destroy: () => {}
    }
    const badResponse = response()
    await routes.get(MARKET_ROUTES.setMcpBackend)?.(badRequest, badResponse)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(badResponse.value()).toMatchObject({ ok: false })

    dispose()
    expect(routes.size).toBe(0)
  })
})
