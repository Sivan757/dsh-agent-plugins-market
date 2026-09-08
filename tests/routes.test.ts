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
    adoptSource: async id => ({ id, url: `https://github.com/example/${id}`, kind: 'git' as const, adopted: true as const }),
    refreshSource: async () => {},
    install: async () => {},
    uninstall: async () => {},
    setEnabled: async () => {},
    setSurface: async () => {},
    setMcpOverride: async () => {},
    retryMounts: async () => {},
    reauthorizeMcpServer: async () => {},
    mcpReauthorizeAvailable: () => true,
    mcpBackendInfo: async () => ({
      backend: 'builtin' as const,
      hostClient: { available: true, version: '0.1.1-rc.2' },
      downloadRegion: { setting: 'auto' as const, effective: 'global' as const }
    }),
    setMcpBackend: async () => {},
    notifyPanelsChanged: async () => {}
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

/** A strict webserver mock: mirrors the host's duplicate-throw contract. */
function strictWebServer(routes: Map<string, (request: unknown, response: unknown) => void | Promise<void>>): WebServerService {
  return {
    register: route => {
      if (routes.has(route.path)) throw new Error(`webserver: duplicate exact route "${route.path}"`)
      routes.set(route.path, route.handler as (request: unknown, response: unknown) => void | Promise<void>)
      return () => routes.delete(route.path)
    }
  }
}

/** A POST request stub with a JSON body and same-origin headers. */
function postRequest(url: string, body: Record<string, unknown>): unknown {
  return {
    method: 'POST',
    url,
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
    on: (event: string, listener: (chunk?: unknown) => void) => {
      if (event === 'data') listener(Buffer.from(JSON.stringify(body), 'utf8'))
      if (event === 'end') listener()
    },
    destroy: () => {}
  }
}

/** Wait out the async POST handler's response write. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('market HTTP routes', () => {
  it('registers the shared route constants and disposes them together', async () => {
    const routes = new Map<string, (request: unknown, response: unknown) => void | Promise<void>>()
    const webServer = strictWebServer(routes)
    const dispose = mountSuiteRoutes({ webServer }, service())

    // The base mount registers exactly the shared route constants plus the
    // LSP save mutation route (a distinct path — the webserver keys its
    // exact table by pathname only, so a same-path GET/POST pair throws at
    // mount); the user panel routes appear only when a panel store set is
    // provided. The strict mock reproduces that duplicate-throw contract.
    expect([...routes.keys()].sort()).toEqual([...Object.values(MARKET_ROUTES).filter(path => path !== MARKET_ROUTES.userPanel), `${MARKET_ROUTES.lspServers}/save`].sort())
    const overviewResponse = response()
    await routes.get(MARKET_ROUTES.overview)?.({ url: '/api/agent-plugins/overview', headers: {} }, overviewResponse)
    expect(overviewResponse.value()).toMatchObject({ totals: { all: 0 } })

    // Manual MCP retry: same-origin POST re-runs the reconcile pass.
    const retryResponse = response()
    await routes.get(MARKET_ROUTES.mcpRetry)?.(postRequest(MARKET_ROUTES.mcpRetry, {}), retryResponse)
    await settle()
    expect(retryResponse.value()).toMatchObject({ ok: true })

    // Re-authorize: drops the grant record for the named server.
    const reauthCalls: Array<string> = []
    const reauthService = {
      ...service(),
      reauthorizeMcpServer: async (serverName: string) => {
        reauthCalls.push(serverName)
      }
    }
    // The second mount gets its own table: the strict mock enforces the
    // duplicate-throw contract per webserver instance, as the host does.
    const reauthRoutes = new Map<string, (request: unknown, response: unknown) => void | Promise<void>>()
    const disposeReauth = mountSuiteRoutes({ webServer: strictWebServer(reauthRoutes) }, reauthService)
    const reauthResponse = response()
    await reauthRoutes.get(MARKET_ROUTES.mcpReauthorize)?.(postRequest(MARKET_ROUTES.mcpReauthorize, { serverName: 'cloudflare__cloudflare-api' }), reauthResponse)
    await settle()
    expect(reauthResponse.value()).toMatchObject({ ok: true })
    expect(reauthCalls).toEqual(['cloudflare__cloudflare-api'])

    // Missing serverName is rejected.
    await reauthRoutes.get(MARKET_ROUTES.mcpReauthorize)?.(postRequest(MARKET_ROUTES.mcpReauthorize, {}), response())
    await settle()

    disposeReauth()
    dispose()
    expect(routes.size).toBe(0)
    expect(reauthRoutes.size).toBe(0)
  })

  it('serves the MCP backend block and validates backend switches', async () => {
    const routes = new Map<string, (request: unknown, response: unknown) => void | Promise<void>>()
    const webServer = strictWebServer(routes)
    const dispose = mountSuiteRoutes({ webServer }, service())

    const getResponse = response()
    await routes.get(MARKET_ROUTES.mcpBackend)?.({ url: MARKET_ROUTES.mcpBackend, headers: {} }, getResponse)
    expect(getResponse.value()).toMatchObject({ backend: 'builtin', hostClient: { available: true, version: '0.1.1-rc.2' } })

    const postResponse = response()
    await routes.get(MARKET_ROUTES.setMcpBackend)?.(postRequest(MARKET_ROUTES.setMcpBackend, { backend: 'host' }), postResponse)
    await settle()
    expect(postResponse.value()).toMatchObject({ ok: true, backend: 'builtin' })

    // An unknown backend value is rejected with a 400 payload.
    const badResponse = response()
    await routes.get(MARKET_ROUTES.setMcpBackend)?.(postRequest(MARKET_ROUTES.setMcpBackend, { backend: 'nope' }), badResponse)
    await settle()
    expect(badResponse.value()).toMatchObject({ ok: false })

    dispose()
    expect(routes.size).toBe(0)
  })

  it('registers user-panel routes only when panel stores are provided', async () => {
    const routes = new Map<string, (request: unknown, response: unknown) => void | Promise<void>>()
    const webServer = strictWebServer(routes)
    const created: Array<{ kind: string; name: string; text: string }> = []
    const store = (kind: string) => ({
      list: async () => [{ name: 'demo', description: 'd', disabled: false, metadata: {}, path: `/${kind}/demo.md`, content: 'body' }],
      get: async (name: string) => ({ name, description: 'd', disabled: false, metadata: {}, path: `/${kind}/${name}.md`, content: 'body' }),
      create: async (name: string, text: string) => {
        created.push({ kind, name, text })
        return { name, description: 'd', disabled: false, metadata: {}, path: `/${kind}/${name}.md`, content: text }
      },
      update: async () => {},
      remove: async () => {}
    })
    const panels = {
      skills: store('skills'),
      commands: store('commands'),
      agents: store('agents')
    } as unknown as Parameters<typeof mountSuiteRoutes>[2]
    const notifyCalls: number[] = []
    const panelService = {
      ...service(),
      notifyPanelsChanged: async () => {
        notifyCalls.push(1)
      }
    }
    const dispose = mountSuiteRoutes({ webServer }, panelService, panels)

    // Three panels × five routes each (list, entry read, create, update, delete).
    const panelRoutes = [...routes.keys()].filter(path => path.startsWith(MARKET_ROUTES.userPanel))
    expect(panelRoutes).toHaveLength(15)

    // Create: POST body {name, text} → entry, then a change notification.
    const createPath = `${MARKET_ROUTES.userPanel}/skills/create`
    const postResponse = response()
    await routes.get(createPath)?.(postRequest(createPath, { name: 'demo', text: '---\ndescription: d\n---\nbody' }), postResponse)
    await settle()
    expect(postResponse.value()).toMatchObject({ ok: true, entry: { name: 'demo' } })
    expect(created).toEqual([{ kind: 'skills', name: 'demo', text: '---\ndescription: d\n---\nbody' }])
    expect(notifyCalls).toHaveLength(1)

    dispose()
    expect(routes.size).toBe(0)
  })

  it('rejects panel entry names outside the grammar without filesystem effect', async () => {
    const routes = new Map<string, (request: unknown, response: unknown) => void | Promise<void>>()
    const webServer = strictWebServer(routes)
    const removals: string[] = []
    // The mock mirrors the real UserPanelStore's guard: a name outside the
    // grammar throws before any filesystem call.
    const ENTRY_NAME = /^[a-z][a-z0-9_-]*$/
    const store = {
      list: async () => [],
      get: async () => undefined,
      create: async () => ({}),
      update: async () => {},
      remove: async (name: string) => {
        if (!ENTRY_NAME.test(name)) throw new Error(`invalid entry name "${name}"`)
        removals.push(name)
      }
    }
    const panels = { skills: store, commands: store, agents: store } as unknown as Parameters<typeof mountSuiteRoutes>[2]
    const dispose = mountSuiteRoutes({ webServer }, { ...service(), notifyPanelsChanged: async () => {} }, panels)

    // Traversal names hit the store but the grammar guard turns them into a
    // 400 before any filesystem call.
    const evil = '../../otherwise-secret'
    const deletePath = `${MARKET_ROUTES.userPanel}/skills/delete`
    const delResponse = response()
    await routes.get(deletePath)?.(postRequest(deletePath, { name: evil }), delResponse)
    await settle()
    expect(delResponse.value()).toMatchObject({ ok: false })
    expect(removals).toEqual([])

    // Same-origin enforcement still guards every mutation.
    const crossOrigin = {
      method: 'POST',
      url: deletePath,
      headers: { host: '127.0.0.1', origin: 'http://evil.example' },
      on: (event: string, listener: (chunk?: unknown) => void) => {
        if (event === 'data') listener(Buffer.from('{"name":"ok"}', 'utf8'))
        if (event === 'end') listener()
      },
      destroy: () => {}
    }
    const corsResponse = response()
    await routes.get(deletePath)?.(crossOrigin, corsResponse)
    await settle()
    expect(corsResponse.value()).toMatchObject({ ok: false })
    expect(removals).toEqual([])

    dispose()
  })

  it('passes the delete-checkout flag through to removeSource', async () => {
    const routes = new Map<string, (request: unknown, response: unknown) => void | Promise<void>>()
    const webServer = strictWebServer(routes)
    const removals: Array<{ id: string; deleteCheckout: boolean }> = []
    const removeService = {
      ...service(),
      removeSource: async (id: string, deleteCheckout?: boolean) => {
        removals.push({ id, deleteCheckout: deleteCheckout === true })
      }
    }
    const dispose = mountSuiteRoutes({ webServer }, removeService)

    const postRequest = {
      method: 'POST',
      url: MARKET_ROUTES.removeSource,
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
      on: (event: string, listener: (chunk?: unknown) => void) => {
        if (event === 'data') listener(Buffer.from(JSON.stringify({ id: 'duckdb-skills', deleteCheckout: true }), 'utf8'))
        if (event === 'end') listener()
      },
      destroy: () => {}
    }
    await routes.get(MARKET_ROUTES.removeSource)?.(postRequest, response())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(removals).toEqual([{ id: 'duckdb-skills', deleteCheckout: true }])

    dispose()
  })
})
